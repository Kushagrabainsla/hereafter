import { AddEquation, CustomBlending, Data3DTexture, InstancedMesh, LinearFilter, MeshBasicNodeMaterial, OneFactor, PlaneGeometry, RGBAFormat, SrcAlphaFactor, UnsignedByteType, Vector3, ZeroFactor, type Object3D, type TextureNode } from "three/webgpu";
import { abs, cameraFar, cameraNear, clamp, cross, dot, float, floor, fract, instanceIndex, length, max, mix, normalize, perspectiveDepthToViewZ, positionLocal, positionView, pow, screenUV, sin, smoothstep, step, texture3D, uniform, uv, vec3 } from "three/tsl";
import { ATMOSPHERE } from "./atmosphere";
import type { Node } from "three/webgpu";
import { outdoorNode, puddleNode, rainTime } from "./wetness";

// Rain falling through the lamplight, and its splashes on the street, worked out on the graphics
// card from each drop's number, so nothing is updated per drop. Each drop has a fixed place in
// the world that repeats every box-width, so walking through the rain does not drag it along. It
// falls at a drop's real speed with a little wind, faces the camera about the vertical, fades out
// near the eye and far away, and is not drawn over an indoor floor. Drops differ in length, width
// and brightness, as real ones catch the light differently.
const BOX = new Vector3(26, 14, 26);
// Metres per second, about a large raindrop's terminal speed.
const SPEED = 8.5;
const WIND = 0.12;
// Splashes on the street round the player: how many, and over what square.
const SPLASHES = 1400;
const SPLASH_BOX = 30;

const hash = (index: Node<"float">, k: number, m: number): Node<"float"> => fract(sin(index.mul(k)).mul(m));

// The lamps' light in the air, worked out once at load on a 1 m grid over the market (as
// ViewLighting lights the hands): what each drop catches where it falls. A drop shows only where a
// lamp lights it, warm under the lamps and almost gone in the dark between them, as rain at night
// does. Stored as light / (1 + light), so the bright spots near a bulb fit in a byte.
const GRID = { x0: -40, y0: 0, z0: -42, nx: 80, ny: 16, nz: 84 };
// How brightly a drop shows the lamp light it catches.
export const RAIN = {
  lamp: uniform(0.6), sky: uniform(1), sun: uniform(2), alpha: uniform(0.35),
  // The view's size of one pixel at 1 m, set each frame (follow).
  pixel: uniform(0.0015),
};
function lampVolume(sources: [number, number, number, number, number, number][]): Data3DTexture {
  const data = new Uint8Array(GRID.nx * GRID.ny * GRID.nz * 4);
  for (let k = 0; k < GRID.nz; k += 1) for (let j = 0; j < GRID.ny; j += 1) for (let i = 0; i < GRID.nx; i += 1) {
    const x = GRID.x0 + i + 0.5, y = GRID.y0 + j + 0.5, z = GRID.z0 + k + 0.5;
    let r = 0, g = 0, b = 0;
    for (const [lx, ly, lz, colour, intensity, distance] of sources) {
      const d = Math.max(0.5, Math.hypot(lx - x, ly - y, lz - z));
      if (d > distance) continue;
      const amount = intensity * Math.max(0, 1 - (d / distance) ** 4) ** 2 / (d * d);
      r += amount * ((colour >> 16) & 255) / 255; g += amount * ((colour >> 8) & 255) / 255; b += amount * (colour & 255) / 255;
    }
    const at = ((k * GRID.ny + j) * GRID.nx + i) * 4;
    data[at] = Math.round(r / (1 + r) * 255); data[at + 1] = Math.round(g / (1 + g) * 255); data[at + 2] = Math.round(b / (1 + b) * 255); data[at + 3] = 255;
  }
  const volume = new Data3DTexture(data, GRID.nx, GRID.ny, GRID.nz);
  volume.format = RGBAFormat;
  volume.type = UnsignedByteType;
  volume.minFilter = volume.magFilter = LinearFilter;
  volume.needsUpdate = true;
  return volume;
}

// Light added to what is behind it, leaving the clouds' coverage (alpha) alone, so the rain never
// darkens the world under it when the clouds' layer is laid over the world.
function rainMaterial(): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, depthTest: false });
  material.blending = CustomBlending;
  material.blendEquation = AddEquation;
  material.blendSrc = SrcAlphaFactor;
  material.blendDst = OneFactor;
  material.blendSrcAlpha = ZeroFactor;
  material.blendDstAlpha = OneFactor;
  return material;
}

export class Rain {
  readonly mesh: InstancedMesh;
  readonly splashes: InstancedMesh;
  private eye = uniform(new Vector3());

  // The rain draws in the clouds' own scene (`parent`), laid over the world after its ambient
  // occlusion and reflections. In the world pass it would also write the normal buffer those
  // read, and each streak and splash would draw a dark line or square on what is behind it. With
  // no depth buffer of its own there, it is hidden behind walls by the world's depth (`worldDepth`).
  constructor(parent: Object3D, count: number, worldDepth: TextureNode, lamps: [number, number, number, number, number, number][] = []) {
    const eye = this.eye, box = vec3(BOX.x, BOX.y, BOX.z);
    const volume = lampVolume(lamps);
    // How far in front of the world's surface at this pixel a fragment lies, in metres.
    const clearance = positionView.z.sub(perspectiveDepthToViewZ(worldDepth.sample(screenUV), cameraNear, cameraFar));
    {
      const material = rainMaterial();
      const index = float(instanceIndex);
      const seed = vec3(hash(index, 12.9898, 43758.5453), hash(index, 78.233, 24634.6345), hash(index, 39.425, 15731.743));
      const look = hash(index, 93.989, 28001.8384);
      // Where the drop is: its column repeats every box-width round the eye; it falls through the
      // box's height and starts again at the top. Drops fall at slightly different speeds.
      const speed = look.mul(0.36).add(0.82);
      const fall = fract(seed.y.sub(rainTime.mul(speed).mul(SPEED / BOX.y)));
      const y = eye.y.sub(BOX.y * 0.35).add(fall.mul(box.y));
      const x = eye.x.add(fract(seed.x.sub(eye.x.div(box.x))).sub(0.5).mul(box.x)).add(y.sub(eye.y).mul(WIND));
      const z = eye.z.add(fract(seed.z.sub(eye.z.div(box.z))).sub(0.5).mul(box.z));
      const centre = vec3(x, y, z);
      // A drop is drawn as the short streak it makes while the eye's shutter is open, about 25 cm
      // at its speed, 5 to 9 mm across. It is never drawn thinner than a pixel: a far drop is drawn
      // a pixel wide and fainter by as much as it is too thin, so far rain stays a fine veil and
      // never becomes thick white lines across the view.
      const fallDir = normalize(vec3(float(WIND).negate(), 1, 0));
      const toDrop = centre.sub(eye), distance = length(toDrop);
      const side = normalize(cross(vec3(0, 1, 0), normalize(vec3(eye.x.sub(x), 0, eye.z.sub(z)))));
      const length0 = speed.mul(SPEED * 0.03);
      const thin = hash(index, 3.7, 11.3).mul(0.004).add(0.005);
      const wide = max(thin, distance.mul(RAIN.pixel).mul(0.75));
      material.positionNode = centre.add(fallDir.mul(positionLocal.y.mul(length0))).add(side.mul(positionLocal.x.mul(wide)));
      const fade = smoothstep(0.9, 2.6, distance).mul(float(1).sub(smoothstep(BOX.x * 0.38, BOX.x * 0.5, distance)));
      // What a drop shows: a little of the sky everywhere, the lamps' light where it falls through
      // it, and the sun behind it, which a water drop scatters forward strongly.
      const facing = dot(normalize(toDrop), ATMOSPHERE.toSun);
      const forward = float(1 - 0.72 * 0.72).div(float(12.566).mul(pow(float(1 + 0.72 * 0.72).sub(facing.mul(2 * 0.72)), 1.5)));
      const stored = texture3D(volume, vec3(centre.x.sub(GRID.x0).div(GRID.nx), centre.y.sub(GRID.y0).div(GRID.ny), centre.z.sub(GRID.z0).div(GRID.nz))).rgb;
      const lit = stored.div(max(vec3(1).sub(stored), vec3(0.02)));
      material.colorNode = vec3(0.05, 0.058, 0.07).mul(RAIN.sky).add(lit.mul(RAIN.lamp)).add(ATMOSPHERE.sun.mul(forward).mul(RAIN.sun));
      // Soft at its sides, and tapered at both ends, as a blurred drop is.
      const ends = smoothstep(0, 0.12, uv().y).mul(smoothstep(1, 0.55, uv().y));
      const sides = float(1).sub(abs(uv().x.mul(2).sub(1)));
      material.opacityNode = thin.div(wide).mul(fade).mul(look.mul(0.45).add(0.55)).mul(RAIN.alpha)
        .mul(smoothstep(0.97, 1, outdoorNode(centre))).mul(ends).mul(sides).mul(smoothstep(0, 0.1, clearance));
      this.mesh = new InstancedMesh(new PlaneGeometry(1, 1), material, count);
      this.mesh.frustumCulled = false;
      this.mesh.renderOrder = 10;
      this.mesh.name = "rain";
      parent.add(this.mesh);
    }
    {
      // A splash: a little crown of water standing up off the street that rises and falls in a
      // third of a second, drawn facing the eye. Each lands on a new spot every time, more of them
      // near the player and more in the puddles than on the wet street between.
      const material = rainMaterial();
      const index = float(instanceIndex);
      const period = hash(index, 41.3, 9157.31).mul(0.14).add(0.26);
      const tick = rainTime.div(period).add(hash(index, 71.13, 16180.339).mul(10));
      const cycle = floor(tick), life = fract(tick);
      const rx = hash(index.add(cycle.mul(0.371)), 17.317, 31415.927).sub(0.5), rz = hash(index.add(cycle.mul(0.613)), 53.719, 27182.818).sub(0.5);
      const spread = (r: Node<"float">): Node<"float"> => r.mul(abs(r).mul(1.3).add(0.35)).mul(SPLASH_BOX);
      const centre = vec3(eye.x.add(spread(rx)), 0.01, eye.z.add(spread(rz)));
      const pool = puddleNode(centre);
      const keep = step(hash(index.add(cycle.mul(0.17)), 5.3, 7121.7), mix(float(0.35), float(1), pool));
      const size = hash(index, 29.71, 14142.136).mul(0.04).add(0.04).mul(mix(float(0.65), float(1), pool));
      const across = size.mul(life.mul(1.5).add(0.7)), up = size.mul(sin(life.mul(Math.PI)).mul(1.3).add(0.4));
      const toSplash = centre.sub(eye), distance = length(toSplash);
      const side = normalize(vec3(toSplash.z, 0, toSplash.x.negate()));
      material.positionNode = centre.add(side.mul(positionLocal.x.mul(across).mul(2))).add(vec3(0, positionLocal.y.add(0.5).mul(up).add(0.004), 0));
      const sx = uv().x.sub(0.5).mul(2), sy = uv().y;
      const dome = smoothstep(1, 0.25, length(vec3(sx.mul(1.15), sy.mul(1.5), 0)));
      const crown = dome.mul(smoothstep(0.25, 0.75, length(vec3(sx, sy.mul(1.4), 0))).mul(0.65).add(0.35));
      const core = smoothstep(0.5, 0, length(vec3(sx.mul(1.6), sy.sub(0.25).mul(1.6), 0))).mul(float(1).sub(life));
      const shape = clamp(crown.mul(0.5).add(core.mul(0.8)), 0, 1);
      const stored = texture3D(volume, vec3(centre.x.sub(GRID.x0).div(GRID.nx), float(0.5 / GRID.ny), centre.z.sub(GRID.z0).div(GRID.nz))).rgb;
      const lit = stored.div(max(vec3(1).sub(stored), vec3(0.02)));
      material.colorNode = vec3(0.07, 0.08, 0.095).mul(RAIN.sky).add(lit.mul(RAIN.lamp));
      // A splash stands on the street, so it shows down to just under the surface the world drew there.
      material.opacityNode = shape.mul(float(1).sub(life)).mul(float(1).sub(smoothstep(11, 15, distance))).mul(mix(float(0.5), float(1), pool)).mul(keep)
        .mul(smoothstep(0.97, 1, outdoorNode(centre))).mul(0.6).mul(smoothstep(-0.12, -0.02, clearance));
      this.splashes = new InstancedMesh(new PlaneGeometry(1, 1), material, SPLASHES);
      this.splashes.frustumCulled = false;
      this.splashes.renderOrder = 10;
      this.splashes.name = "rain splashes";
      parent.add(this.splashes);
    }
  }

  // Keeps the rain round the eye; call each frame.
  follow(eye: Vector3, pixel: number): void { this.eye.value.copy(eye); RAIN.pixel.value = pixel; }
}
