import { DataTexture, LinearFilter, RedFormat, UnsignedByteType } from "three/webgpu";
import { dot, exp, float, floor, fract, length, sin, smoothstep, texture, texture3D, uniform, vec2, vec3 } from "three/tsl";
import type { Node } from "three/webgpu";
import { noiseVolume } from "./noiseVolume";

// After the rain: where water stands on the paving and asphalt, the same for the street's
// material, the reflections in it (mapViewer.ts) and the footsteps that splash in it. The
// puddles follow one noise read from the shared noise block (noiseVolume.ts), so the
// game can look the same mask up on the CPU. Indoors stays dry: a top-down mask of the map's
// floors keeps puddles off the shops' and the bar's boards, which sit almost at street level.

// The noise block is laid flat over the ground, one block every PUDDLE_SCALE metres.
const PUDDLE_SCALE = 14;
// How much of the ground the puddles cover: the noise's upper part.
const PUDDLE_FROM = 0.57;
const PUDDLE_TO = 0.75;
// Where on the block's height the ground's slice is taken.
const SLICE = 0.37;

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

// 1 outdoors, 0 over an indoor floor, at a world position.
export function outdoorNode(position: Node<"vec3">): Node<"float"> {
  return texture(outdoors, vec2(position.x.sub(MAP.x0).div(MAP.x1 - MAP.x0), position.z.sub(MAP.z0).div(MAP.z1 - MAP.z0))).r;
}

// How wet the ground is at a world position, from 0 (damp) to 1 (standing water).
export function puddleNode(position: Node<"vec3">): Node<"float"> {
  const n = texture3D(noiseVolume(), vec3(position.x.div(PUDDLE_SCALE), float(SLICE), position.z.div(PUDDLE_SCALE))).b;
  return smoothstep(PUDDLE_FROM, PUDDLE_TO, n).mul(outdoorNode(position));
}

// Rain rings on standing water, as relief for bump mapping: the ground is split into 32 cm cells,
// and in each a ring grows from a random point and fades, at a random moment. Wavelength about
// 3 cm, height half a millimetre.
export function rippleHeight(position: Node<"vec3">): Node<"float"> {
  const p = vec2(position.x, position.z).div(0.32);
  const cell = floor(p);
  const seed = fract(sin(dot(cell, vec2(12.9898, 78.233))).mul(43758.5453));
  const phase = fract(rainTime.mul(1.15).add(seed));
  const centre = vec2(fract(seed.mul(7.31)), fract(seed.mul(3.17))).sub(0.5).mul(0.3);
  const d = length(fract(p).sub(0.5).sub(centre)).sub(phase.mul(0.42));
  return sin(d.mul(60)).mul(exp(d.mul(d).mul(-180))).mul(float(1).sub(phase)).mul(0.0005);
}

// Whether a point is outdoors, on the CPU: for the rain's sound under a roof.
export function outdoorAt(x: number, z: number): boolean {
  const u = Math.floor((x - MAP.x0) / (MAP.x1 - MAP.x0) * MASK), v = Math.floor((z - MAP.z0) / (MAP.z1 - MAP.z0) * MASK);
  return !(u >= 0 && v >= 0 && u < MASK && v < MASK) || outdoorData[v * MASK + u] > 127;
}

// The same mask on the CPU, for footsteps: trilinear like the GPU's read.
export function puddleAt(x: number, z: number): number {
  const block = noiseVolume().image as { data: Uint8Array; width: number };
  const size = block.width, data = block.data;
  const fx = (((x / PUDDLE_SCALE) % 1) + 1) % 1 * size - 0.5, fz = (((z / PUDDLE_SCALE) % 1) + 1) % 1 * size - 0.5, fy = SLICE * size - 0.5;
  const x0 = Math.floor(fx), y0 = Math.floor(fy), z0 = Math.floor(fz), tx = fx - x0, ty = fy - y0, tz = fz - z0;
  const at = (i: number, j: number, k: number): number => data[(((((k % size) + size) % size) * size + (((j % size) + size) % size)) * size + (((i % size) + size) % size)) * 4 + 2] / 255;
  const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
  const plane = (j: number): number => lerp(lerp(at(x0, j, z0), at(x0 + 1, j, z0), tx), lerp(at(x0, j, z0 + 1), at(x0 + 1, j, z0 + 1), tx), tz);
  const n = lerp(plane(y0), plane(y0 + 1), ty);
  const u = Math.floor((x - MAP.x0) / (MAP.x1 - MAP.x0) * MASK), v = Math.floor((z - MAP.z0) / (MAP.z1 - MAP.z0) * MASK);
  const out = u >= 0 && v >= 0 && u < MASK && v < MASK ? outdoorData[v * MASK + u] / 255 : 1;
  const t = Math.max(0, Math.min(1, (n - PUDDLE_FROM) / (PUDDLE_TO - PUDDLE_FROM)));
  return t * t * (3 - 2 * t) * out;
}
