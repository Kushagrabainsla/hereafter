import { DataTexture, LinearFilter, RedFormat, UnsignedByteType } from "three/webgpu";
import { dot, exp, float, floor, fract, fwidth, length, sin, smoothstep, texture, texture3D, uniform, vec2, vec3 } from "three/tsl";
import type { Node } from "three/webgpu";
import { noiseVolume } from "./noiseVolume";

// After the rain: where water stands on the paving and asphalt, the same for the street's
// material, the reflections in it (mapViewer.ts) and the footsteps that splash in it. The
// puddles follow one noise read from the shared noise block (noiseVolume.ts), so the
// game can look the same mask up on the CPU. Indoors stays dry: a top-down mask of the map's
// floors keeps puddles off the shops' and the bar's boards, which sit almost at street level.

// The noise block is laid flat over the ground, one block every PUDDLE_SCALE metres.
const PUDDLE_SCALE = 14;
// How much of the ground the puddles cover: the noise's upper part. A narrow band, so the water
// ends at a fairly crisp line, as real water does.
const PUDDLE_FROM = 0.58;
const PUDDLE_TO = 0.635;
// Below the water, a ring of damp ground: darker and glossier, but no mirror.
const DAMP_FROM = 0.5;
// Where on the block's height the ground's slice is taken.
const SLICE = 0.37;
// The finer read: one block every FINE_SCALE metres, from another slice, with this share.
const FINE_SCALE = 4.5;
const FINE_SLICE = 0.71;
const FINE_SHARE = 0.4;
// A third read, one block every RAGGED_SCALE metres, shifts the edge back and forth by up to
// RAGGED, so the outlines are ragged and not the smooth, even-width curves of one blurred stamp.
const RAGGED_SCALE = 0.9;
const RAGGED_SLICE = 0.13;
const RAGGED = 0.06;

// The top-down mask: 1 outdoors, 0 on an indoor floor.
const MAP = { x0: -40, x1: 40, z0: -42, z1: 42 };
const MASK = 320;
const outdoorData = new Uint8Array(MASK * MASK).fill(255);
const outdoors = new DataTexture(outdoorData, MASK, MASK, RedFormat, UnsignedByteType);
outdoors.minFilter = outdoors.magFilter = LinearFilter;
outdoors.needsUpdate = true;

export function setIndoors(rects: [number, number, number, number][]): void {
  outdoorData.fill(255);
  for (let j = 0; j < MASK; j += 1) for (let i = 0; i < MASK; i += 1) {
    const x = MAP.x0 + (i + 0.5) / MASK * (MAP.x1 - MAP.x0), z = MAP.z0 + (j + 0.5) / MASK * (MAP.z1 - MAP.z0);
    if (rects.some(([x0, x1, z0, z1]) => x >= x0 && x <= x1 && z >= z0 && z <= z1)) outdoorData[j * MASK + i] = 0;
  }
  outdoors.needsUpdate = true;
}

// Seconds since the rain started, for the ripples; the viewer advances it every frame.
export const rainTime = uniform(0);

// Whether it is raining (dusk) or dry (day): puddles, ripples and wet surfaces follow it. `now` is
// the same for the CPU (footsteps). Set once, before the world is built (timeOfDay.ts).
export const WEATHER = { wet: uniform(1), now: true };
export function setWet(wet: boolean): void { WEATHER.wet.value = wet ? 1 : 0; WEATHER.now = wet; }

// 1 outdoors, 0 over an indoor floor, at a world position.
export function outdoorNode(position: Node<"vec3">): Node<"float"> {
  return texture(outdoors, vec2(position.x.sub(MAP.x0).div(MAP.x1 - MAP.x0), position.z.sub(MAP.z0).div(MAP.z1 - MAP.z0))).r;
}

// How likely water is to stand at a world position: the noise the puddles are cut from. A second,
// finer read breaks the broad wet areas into separate puddles, and a third roughens their edges.
function puddleLevel(position: Node<"vec3">): Node<"float"> {
  const broad = texture3D(noiseVolume(), vec3(position.x.div(PUDDLE_SCALE), float(SLICE), position.z.div(PUDDLE_SCALE))).b;
  const fine = texture3D(noiseVolume(), vec3(position.x.div(FINE_SCALE), float(FINE_SLICE), position.z.div(FINE_SCALE))).b;
  const ragged = texture3D(noiseVolume(), vec3(position.x.div(RAGGED_SCALE), float(RAGGED_SLICE), position.z.div(RAGGED_SCALE))).b;
  return broad.mul(1 - FINE_SHARE).add(fine.mul(FINE_SHARE)).add(ragged.sub(0.5).mul(RAGGED * 2));
}

// How wet the ground is at a world position, from 0 (damp) to 1 (standing water).
export function puddleNode(position: Node<"vec3">): Node<"float"> {
  return smoothstep(PUDDLE_FROM, PUDDLE_TO, puddleLevel(position)).mul(outdoorNode(position)).mul(WEATHER.wet);
}

// The damp ground round the puddles and the water itself, from 0 to 1: where the water has only
// just drained away or soaked in.
export function dampNode(position: Node<"vec3">): Node<"float"> {
  return smoothstep(DAMP_FROM, PUDDLE_FROM, puddleLevel(position)).mul(outdoorNode(position)).mul(WEATHER.wet);
}

// Rain rings on standing water, as relief for bump mapping: the ground is split into 32 cm cells,
// and in each a ring grows from a random point and fades, at a random moment. Wavelength about
// 3 cm, height half a millimetre. Each ring fades in as it opens, so it never shows as a dot at its
// centre, and the rings fade out with distance once a pixel covers more than about a centimetre
// of water, where they could only show as specks.
export function rippleHeight(position: Node<"vec3">): Node<"float"> {
  const p = vec2(position.x, position.z).div(0.32);
  const cell = floor(p);
  const seed = fract(sin(dot(cell, vec2(12.9898, 78.233))).mul(43758.5453));
  const phase = fract(rainTime.mul(1.15).add(seed));
  const centre = vec2(fract(seed.mul(7.31)), fract(seed.mul(3.17))).sub(0.5).mul(0.3);
  const d = length(fract(p).sub(0.5).sub(centre)).sub(phase.mul(0.42));
  const footprint = fwidth(position.x).add(fwidth(position.z));
  const near = float(1).sub(smoothstep(0.012, 0.03, footprint));
  return sin(d.mul(60)).mul(exp(d.mul(d).mul(-180))).mul(float(1).sub(phase)).mul(smoothstep(0, 0.18, phase)).mul(near).mul(0.0005).mul(WEATHER.wet);
}

// Whether a point is outdoors, on the CPU: for the rain's sound under a roof.
export function outdoorAt(x: number, z: number): boolean {
  const u = Math.floor((x - MAP.x0) / (MAP.x1 - MAP.x0) * MASK), v = Math.floor((z - MAP.z0) / (MAP.z1 - MAP.z0) * MASK);
  return !(u >= 0 && v >= 0 && u < MASK && v < MASK) || outdoorData[v * MASK + u] > 127;
}

// The same mask on the CPU, for footsteps: trilinear like the GPU's read.
function noiseAt(x: number, z: number, scale: number, slice: number): number {
  const block = noiseVolume().image as { data: Uint8Array; width: number };
  const size = block.width, data = block.data;
  const fx = (((x / scale) % 1) + 1) % 1 * size - 0.5, fz = (((z / scale) % 1) + 1) % 1 * size - 0.5, fy = slice * size - 0.5;
  const x0 = Math.floor(fx), y0 = Math.floor(fy), z0 = Math.floor(fz), tx = fx - x0, ty = fy - y0, tz = fz - z0;
  const at = (i: number, j: number, k: number): number => data[(((((k % size) + size) % size) * size + (((j % size) + size) % size)) * size + (((i % size) + size) % size)) * 4 + 2] / 255;
  const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
  const plane = (j: number): number => lerp(lerp(at(x0, j, z0), at(x0 + 1, j, z0), tx), lerp(at(x0, j, z0 + 1), at(x0 + 1, j, z0 + 1), tx), tz);
  return lerp(plane(y0), plane(y0 + 1), ty);
}

export function puddleAt(x: number, z: number): number {
  if (!WEATHER.now) return 0;
  const n = noiseAt(x, z, PUDDLE_SCALE, SLICE) * (1 - FINE_SHARE) + noiseAt(x, z, FINE_SCALE, FINE_SLICE) * FINE_SHARE + (noiseAt(x, z, RAGGED_SCALE, RAGGED_SLICE) - 0.5) * RAGGED * 2;
  const u = Math.floor((x - MAP.x0) / (MAP.x1 - MAP.x0) * MASK), v = Math.floor((z - MAP.z0) / (MAP.z1 - MAP.z0) * MASK);
  const out = u >= 0 && v >= 0 && u < MASK && v < MASK ? outdoorData[v * MASK + u] / 255 : 1;
  const t = Math.max(0, Math.min(1, (n - PUDDLE_FROM) / (PUDDLE_TO - PUDDLE_FROM)));
  return t * t * (3 - 2 * t) * out;
}
