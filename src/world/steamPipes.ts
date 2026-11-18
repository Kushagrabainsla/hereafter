import { CanvasTexture, Color, DataTexture, DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, LinearFilter, Matrix4, MeshBasicNodeMaterial, Object3D, PlaneGeometry, RepeatWrapping, SRGBColorSpace, Vector3, type Data3DTexture, type Node, type TextureNode } from "three/webgpu";
import { cameraFar, cameraNear, cameraViewMatrix, cameraWorldMatrix, cos, dot, float, instancedBufferAttribute, max, mix, normalize, perspectiveDepthToViewZ, positionGeometry, positionView, screenUV, sin, smoothstep, sqrt, step, texture, uniform, uv, varying, vec2, vec3, vec4 } from "three/tsl";
import { type Vec3, type WorldEntity } from "./entities";
import { ALONG_SIGN, FACE_YAW, wallMatrix, type Face } from "./facades";
import { type KitPlacer } from "./kit";
import { lampLightAt, lampLightNode } from "./rain";

// Lagged steam pipes along a few walls, each with a valve. A round through a pipe bursts it:
// a roaring jet and a thick cloud fill the alley around it for about eleven seconds, hiding
// anyone inside, then it thins to a wisp that keeps leaking until the room resets.
//
// The pipes are plain data shared by every client; the view below draws the steam.

interface SteamPipe { id: string; face: Face; at: number; from: number; to: number; y: number; valve: number }
export const STEAM_PIPES: SteamPipe[] = [
  { id: "pipe:service", face: "px", at: 8.5, from: 5.0, to: 9.4, y: 2.7, valve: 7.2 },
  { id: "pipe:laundry", face: "nx", at: 17, from: -17.4, to: -13.0, y: 2.75, valve: -15.2 },
  { id: "pipe:cut-through", face: "nz", at: 4, from: 1.2, to: 7.8, y: 2.8, valve: 4.4 },
  { id: "pipe:market", face: "nx", at: 0.5, from: -5.6, to: -2.4, y: 3.0, valve: -4.0 },
];
// How far the pipe's axis stands off the wall.
const STAND_OFF = 0.2;

const NORMAL: Record<Face, [number, number]> = { px: [1, 0], nx: [-1, 0], pz: [0, 1], nz: [0, -1] };
function point(pipe: SteamPipe, along: number, out: number, up = 0): Vector3 {
  const [nx, nz] = NORMAL[pipe.face];
  return nx ? new Vector3(pipe.at + nx * out, pipe.y + up, along) : new Vector3(along, pipe.y + up, pipe.at + nz * out);
}

// The whole run is one thin metal target, so a round anywhere along it bursts it.
export const PIPE_ENTITIES: WorldEntity[] = STEAM_PIPES.map((pipe) => {
  const middle = point(pipe, (pipe.from + pipe.to) / 2, STAND_OFF);
  return { id: pipe.id, kind: "pipe", material: "metal-thin", maxHealth: 10, yaw: FACE_YAW[pipe.face], center: { x: middle.x, y: middle.y, z: middle.z }, shape: { type: "box", half: [(pipe.to - pipe.from) / 2 + 0.1, 0.13, 0.13] } };
});

// Lays the pipes out from kit pieces: an elbow into the wall at each end, lagged runs
// stretched to fit, and the valve.
export function placeSteamPipes(placer: KitPlacer): void {
  for (const pipe of STEAM_PIPES) {
    // Work along the piece's own +X, which runs one way or the other along the wall.
    const sign = ALONG_SIGN[pipe.face];
    const u0 = Math.min(pipe.from * sign, pipe.to * sign), u1 = Math.max(pipe.from * sign, pipe.to * sign), uv = pipe.valve * sign;
    const at = (u: number, stretch = 1): Matrix4 => wallMatrix(pipe.face, pipe.at, u * sign, pipe.y, 0, stretch);
    placer.place("steam_end_l", at(u0));
    placer.place("steam_end_r", at(u1));
    placer.place("steam_valve", at(uv));
    for (const [start, end] of [[u0, uv - 0.22], [uv + 0.22, u1]]) {
      const count = Math.max(1, Math.round(end - start)), length = (end - start) / count;
      for (let k = 0; k < count; k += 1) placer.place("steam_run", at(start + k * length, length));
    }
  }
}

// A lumpy puff: overlapping soft blobs, so the cloud reads as billows rather than a disc.
function puffTexture(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const g = canvas.getContext("2d")!;
  let seed = 7;
  const random = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 26; i += 1) {
    const angle = random() * Math.PI * 2, distance = random() * 30, x = 64 + Math.cos(angle) * distance, y = 64 + Math.sin(angle) * distance, r = 16 + random() * 22;
    const gradient = g.createRadialGradient(x, y, 0, x, y, r);
    gradient.addColorStop(0, `rgba(255,255,255,${0.2 + random() * 0.18})`);
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gradient;
    g.fillRect(0, 0, 128, 128);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

// The grain of a billow: smooth noise of three sizes (2, 4 and 8 bumps across), which repeats at
// its edges. Each billow reads its own part of it. A flat picture is used, not the block of noise
// the surfaces read (noiseVolume.ts): a cloud draws every pixel many times over, and reading the
// block for each of them cost about 2 frames a second with a cloud across the view.
//
// Red is the grain. Green is broad noise (2 and 4 bumps across) that pushes a billow's rim in and
// out, so its outline is a few uneven lobes and not a circle.
function grainTexture(): DataTexture {
  const SIZE = 128, data = new Uint8Array(SIZE * SIZE * 4).fill(255);
  let seed = 4127;
  const random = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const ease = (t: number): number => t * t * (3 - 2 * t);
  // One channel: a sum of noise layers [bumps across, weight], stretched to lie between `from` and `to`.
  const fill = (channel: number, sizes: [number, number][], from: number, to: number): void => {
    const layers = sizes.map(([period, weight]) => ({ period, weight, grid: Array.from({ length: period * period }, random) }));
    let low = 1, high = 0;
    const values = new Float32Array(SIZE * SIZE);
    for (let y = 0; y < SIZE; y += 1) for (let x = 0; x < SIZE; x += 1) {
      let value = 0;
      for (const { period, weight, grid } of layers) {
        const fx = x / SIZE * period, fy = y / SIZE * period, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = ease(fx - x0), ty = ease(fy - y0);
        const at = (i: number, j: number): number => grid[(j % period) * period + (i % period)];
        value += weight * ((at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty);
      }
      values[y * SIZE + x] = value;
      low = Math.min(low, value); high = Math.max(high, value);
    }
    for (let i = 0; i < values.length; i += 1) data[i * 4 + channel] = Math.round((from + (to - from) * (values[i] - low) / (high - low)) * 255);
  };
  // The grain is kept between 0.2 and 0.8: a billow whose noise reaches 1 is eaten away to nothing.
  fill(0, [[2, 0.3], [4, 0.45], [8, 0.25]], 0.2, 0.8);
  fill(1, [[2, 0.6], [4, 0.4]], 0, 1);
  const texture = new DataTexture(data, SIZE, SIZE);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.minFilter = texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

// Where a cloud comes from: the point it blows from, the wall behind it and which way it faces.
interface Source { source: Vector3; wall: Vector3; out: Vector3; style: CloudStyle }
interface Leak extends Source { age: number; spawn: number }
// One billow of a cloud. `scale` and `fade` are its size and opacity now; `sun` is whether the
// sun reaches it (0 or 1), found where it was blown out.
interface Puff { cloud: Leak | null; position: Vector3; velocity: Vector3; age: number; life: number; t: number; lift: number; size: number; scale: number; opacity: number; fade: number; shown: number; albedo: number; turn: number; sun: number; far: number }

// How a cloud behaves: seconds thick and thinning, whether it keeps leaking a wisp after,
// how big its billows grow, how much light they reflect (0 soot to 1 white), how solid each
// billow is (1 for smoke, less for a cloud that light passes through), how wide the split it
// blows from, how hard it jets out, how far it spreads sideways, how fast its billows climb
// (metres per second, each second), and the seconds between its billows while it is thick.
export interface CloudStyle { thick: number; thin: number; leaks: boolean; size: number; albedo: number; dense: number; split: number; jet: number; spread: number; rise: number; every: number }
// A burst pipe blows a thick cloud for 11 s, thins over 4 s and leaks a wisp until the room resets.
// Steam is hot and light passes through it: a soft jet that leaves the pipe and climbs.
const STEAM: CloudStyle = { thick: 11, thin: 4, leaks: true, size: 1.7, albedo: 0.8, dense: 0.42, split: 1.2, jet: 3.4, spread: 0.9, rise: 0.8, every: 0.04 };
// A shot extinguisher sprays a short, pale burst of powder.
export const POWDER: CloudStyle = { thick: 3.5, thin: 2.5, leaks: false, size: 1.6, albedo: 0.86, dense: 0.75, split: 0.2, jet: 3.4, spread: 1, rise: 0.3, every: 0.05 };
// A smoke grenade pours grey smoke out along the ground for 13 s, a wall about 7 m across,
// then thins away over 5 s. Many small billows, so its outline is broken, not one soft disc.
export const SMOKE: CloudStyle = { thick: 13, thin: 5, leaks: false, size: 2.2, albedo: 0.62, dense: 1, split: 0, jet: 1.3, spread: 2.4, rise: 0.5, every: 0.04 };

// How strongly each light shows on the clouds: 1 is as on a matt surface of the cloud's shade.
// The lamps count for less: a lamp lights only the near side of a cloud, not all through it.
export const CLOUD_LIGHT = { sun: uniform(1), sky: uniform(1.3), ground: uniform(1), lamp: uniform(0.45) };

// The light the clouds stand in: the lamps' light in the air (rain.ts), the sun, the sky and the
// ground's bounce (as the scene's own lights), and whether the sun reaches a point.
export interface CloudLight {
  lamps: Data3DTexture;
  sun: { direction: Vector3; color: Color; intensity: number };
  sky: { color: Color; ground: Color; intensity: number };
  sunlit(at: Vector3): boolean;
}

// The billows drawn at once, over all the clouds.
const PUFFS = 420;
// How much of a billow's full width its picture fills (see setStage).
const FIT = 0.85;
const scratch = new Vector3();

// Clouds of steam from burst pipes, of powder from shot extinguishers and of smoke from grenades.
// Every billow of every cloud is one copy of one mesh, drawn facing the eye, far ones first. A
// billow is shaded like a ball of the cloud's own grey: lit by the sun on its sunward side where
// the sun reaches it, by the sky from above, by the ground's bounce from below and by the lamps
// near it. So smoke is bright in the sun, dim blue in a shaded alley and warm under a lamp. Noise
// eats into each billow's edge, so the cloud's outline is ragged.
export class SteamPipes {
  private sources = new Map<string, Source>();
  private leaks = new Map<string, Leak>();
  private map = puffTexture();
  private grain = grainTexture();
  private puffs: Puff[] = Array.from({ length: PUFFS }, () => ({ cloud: null, position: new Vector3(), velocity: new Vector3(), age: 1, life: 1, t: 1, lift: 0, size: 1, scale: 0, opacity: 0, fade: 0, shown: 0, albedo: 0.5, turn: 0, sun: 0, far: 0 }));
  // For each copy drawn: its centre and size, and its opacity, shade, turn and share of sun.
  private places = new InstancedBufferAttribute(new Float32Array(PUFFS * 4), 4);
  private looks = new InstancedBufferAttribute(new Float32Array(PUFFS * 4), 4);
  private order: Puff[] = [];
  private mesh: InstancedMesh | null = null;
  private light: CloudLight | null = null;
  private eye = new Vector3();
  private clock = uniform(0);
  private toSun = uniform(new Vector3(0, 1, 0));
  private sunLight = uniform(new Vector3());
  private skyLight = uniform(new Vector3());
  private groundLight = uniform(new Vector3());

  constructor() {
    this.places.setUsage(DynamicDrawUsage);
    this.looks.setUsage(DynamicDrawUsage);
    for (const pipe of STEAM_PIPES) {
      const [nx, nz] = NORMAL[pipe.face];
      this.sources.set(pipe.id, { source: point(pipe, pipe.valve, STAND_OFF + 0.15), wall: point(pipe, pipe.valve, 0), out: new Vector3(nx, 0, nz), style: STEAM });
    }
  }

  // Draws the clouds in their own scene, fading against the world's depth texture, so they can be
  // laid over the world after its ambient occlusion rather than darkened by it; and gives them
  // the light they stand in.
  setStage(parent: Object3D, worldDepth: TextureNode, light: CloudLight): void {
    this.light = light;
    this.toSun.value.copy(light.sun.direction).normalize();
    this.sunLight.value.set(light.sun.color.r, light.sun.color.g, light.sun.color.b).multiplyScalar(light.sun.intensity);
    this.skyLight.value.set(light.sky.color.r, light.sky.color.g, light.sky.color.b).multiplyScalar(light.sky.intensity);
    this.groundLight.value.set(light.sky.ground.r, light.sky.ground.g, light.sky.ground.b).multiplyScalar(light.sky.intensity);

    const place = instancedBufferAttribute(this.places) as unknown as Node<"vec4">;
    const look = instancedBufferAttribute(this.looks) as unknown as Node<"vec4">;
    const centre = place.xyz, size = place.w;
    // Each copy is a square turned by its own angle and set facing the eye.
    const corner = positionGeometry.xy, c = cos(look.z), s = sin(look.z);
    const off = vec2(corner.x.mul(c).sub(corner.y.mul(s)), corner.x.mul(s).add(corner.y.mul(c)));
    const right = cameraWorldMatrix.mul(vec4(1, 0, 0, 0)).xyz, up = cameraWorldMatrix.mul(vec4(0, 1, 0, 0)).xyz;
    const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, depthTest: false });
    // The square that is drawn is FIT of the billow's full width: the picture is empty outside
    // that, and every pixel of a cloud is drawn many times over, so the unused rim costs a lot.
    material.positionNode = centre.add(right.mul(off.x.mul(size.mul(FIT)))).add(up.mul(off.y.mul(size.mul(FIT))));
    // The last number holds two things: 2 if the sun reaches the billow, plus its age from 0 to 1.
    // The lamps' light is read once for each corner of a billow, at its middle, not for each pixel.
    const edge = varying(off.mul(2 * FIT)), lamps = varying(lampLightNode(light.lamps, centre)), opacity = varying(look.x), albedo = varying(look.y);
    const sun = varying(step(1.5, look.w)), age = varying(look.w.sub(step(1.5, look.w).mul(2)));

    // Noise gives the cloud its grain: folds inside it and a ragged rim. Each billow reads its own
    // part of the noise, which turns with it and drifts slowly.
    const grainAt = varying(uv().mul(0.9).add(vec2(look.z.mul(1.7), look.z.mul(0.9).add(this.clock.mul(0.012)))));
    const grain = texture(this.grain, grainAt), wisp = grain.r, lobes = grain.g;

    // The billow as a ball: which way each point of it faces, as seen from the eye.
    const facing = normalize(vec3(edge.x, edge.y, sqrt(max(float(1).sub(dot(edge, edge)), 0.05))));
    const sunward = dot(facing, normalize(cameraViewMatrix.mul(vec4(this.toSun, 0)).xyz)).mul(0.5).add(0.5);
    const upward = edge.y.mul(0.5).add(0.5).clamp(0, 1);
    const lit = vec3(this.sunLight).mul(sun).mul(sunward.mul(sunward).mul(0.9).add(0.1)).mul(CLOUD_LIGHT.sun)
      .add(vec3(this.skyLight).mul(mix(float(0.22), float(1), upward)).mul(CLOUD_LIGHT.sky))
      .add(vec3(this.groundLight).mul(mix(float(0.6), float(0.1), upward)).mul(CLOUD_LIGHT.ground))
      .add(lamps.mul(CLOUD_LIGHT.lamp));
    // The folds between billows are darker: less light gets into them.
    material.colorNode = lit.mul(albedo).mul(mix(float(1.08), float(0.74), wisp)).div(Math.PI);

    // Its shape: the lumpy picture, eaten into from the rim by the noise, so the middle stays solid
    // and the edge is ragged. An old billow is eaten further, so it breaks into wisps and does not
    // become a wide even veil. It fades over its last 0.6 m in front of whatever is behind it, and
    // is gone behind it, so it needs no depth test of its own. (three's own softParticles helper
    // names a GLSL reserved word, so WebGL cannot compile it.)
    const eaten = wisp.mul(age.mul(age).mul(0.75).add(0.4));
    // A thick billow has a solid middle about half its width and a short, firm rim. A faint one
    // (steam, a cloud that is thinning away, a billow at the end of its life) is soft all the way
    // through: a firm rim round a clear middle looks like a glass disc.
    const solid = smoothstep(0.15, 0.6, opacity);
    // Its rim is pushed in and out by the broad noise, so the outline is a few uneven lobes: a
    // faint billow with an even rim shows as a clean disc. It always ends inside the square.
    const round = smoothstep(1, 0.35, dot(edge, edge).mul(lobes.mul(1.3).add(0.55))).mul(smoothstep(FIT * FIT, FIT * FIT - 0.12, dot(edge, edge)));
    const shape = smoothstep(eaten, eaten.add(mix(float(1), float(0.45), solid)), texture(this.map, uv().sub(0.5).mul(FIT).add(0.5)).a.mul(mix(float(1), float(1.5), solid)).min(1).mul(round));
    const soft = smoothstep(0, 0.6, positionView.z.sub(perspectiveDepthToViewZ(worldDepth.sample(screenUV), cameraNear, cameraFar)));
    material.opacityNode = shape.mul(opacity).mul(soft);

    // One copy at no size is drawn from the first frame, so the shader is built as the map loads.
    this.mesh = new InstancedMesh(new PlaneGeometry(1, 1), material, PUFFS);
    this.mesh.count = 1;
    this.mesh.frustumCulled = false;
    // Drawn after the lamps' glow in the air (lampHaze.ts, 9) and before the rain (10): a cloud
    // hides the glow of the lamps behind it, which is nearly always where a lamp it covers is.
    this.mesh.renderOrder = 9.5;
    this.mesh.name = "clouds";
    this.mesh.geometry.setAttribute("place", this.places);
    this.mesh.geometry.setAttribute("look", this.looks);
    parent.add(this.mesh);
  }

  // Another thing that bursts into a cloud: where it blows from, the wall behind it, which
  // way it faces and how it behaves.
  addSource(id: string, source: Vec3, wall: Vec3, out: Vec3, style: CloudStyle): void {
    this.sources.set(id, { source: new Vector3(source.x, source.y, source.z), wall: new Vector3(wall.x, wall.y, wall.z), out: new Vector3(out.x, out.y, out.z), style });
  }

  // A burst seen as it happens blows the full cloud; one that burst before this peer joined
  // only leaks, if it leaks at all.
  burst(id: string, fresh: boolean): void {
    const origin = this.sources.get(id);
    if (!origin || this.leaks.has(id) || (!fresh && !origin.style.leaks)) return;
    this.leaks.set(id, { ...origin, age: fresh ? 0 : origin.style.thick + origin.style.thin, spawn: 0 });
  }

  restore(id: string): void {
    const leak = this.leaks.get(id);
    if (!leak) return;
    for (const puff of this.puffs) if (puff.cloud === leak) { puff.cloud = null; puff.age = puff.life; }
    this.leaks.delete(id);
  }

  // A cloud from a thrown grenade, which clears itself away once it has thinned out.
  pour(id: string, at: Vec3, style: CloudStyle): void {
    this.addSource(id, { x: at.x, y: at.y + 0.15, z: at.z }, at, { x: 0, y: 1, z: 0 }, style);
    this.burst(id, true);
  }

  // A billow for a cloud to blow out: one that is not in use, or else the oldest one in use.
  private take(): Puff {
    let oldest = this.puffs[0];
    for (const puff of this.puffs) {
      if (!puff.cloud) return puff;
      if (puff.age / puff.life > oldest.age / oldest.life) oldest = puff;
    }
    return oldest;
  }

  // Where the clouds are seen from, so far billows are drawn first.
  watchFrom(eye: Vec3): void { this.eye.set(eye.x, eye.y, eye.z); }

  update(seconds: number): void {
    this.clock.value += seconds;
    for (const [id, leak] of this.leaks) {
      const style = leak.style;
      leak.age += seconds;
      // A cloud that does not leak is done a few seconds after it stops.
      if (!style.leaks && leak.age > style.thick + style.thin + 6) { this.restore(id); if (id.startsWith("smoke:")) this.sources.delete(id); continue; }
      // Thick: a stream of billows that roll out a few metres. Thinning, then a wisp.
      const thick = leak.age < style.thick ? 1 : Math.max(0, 1 - (leak.age - style.thick) / style.thin);
      const interval = thick > 0 ? style.every : 0.5;
      leak.spawn -= seconds;
      while (leak.spawn <= 0 && (thick > 0 || style.leaks)) {
        leak.spawn += interval;
        const puff = this.take();
        const strength = Math.max(0.12, thick);
        // Some puffs shoot out with the jet, most roll along the wall, so the cloud fills the
        // alley from the pipe outward.
        // Most billows stay low and a few climb, so the cloud stands on the ground and is not a
        // ball that floats above it.
        const climb = Math.random() ** 2;
        const spread = new Vector3((Math.random() - 0.5) * 3.2 * style.spread, climb * 1.1, (Math.random() - 0.5) * 3.2 * style.spread);
        puff.velocity.copy(leak.out).multiplyScalar(0.6 + Math.random() * style.jet * strength).add(spread.multiplyScalar(strength));
        // Steam escapes along a split in the pipe, not from a single point.
        puff.position.copy(leak.source).add(new Vector3(-leak.out.z, 0, leak.out.x).multiplyScalar((Math.random() - 0.5) * style.split * strength));
        puff.position.y += (Math.random() - 0.5) * 0.3;
        puff.cloud = leak;
        puff.age = 0;
        puff.life = 1.6 + strength * 3.2 + Math.random();
        // One billow in three is about half the size: small ones break up the outline.
        puff.size = (0.5 + strength * (style.size + Math.random() * 1.3)) * (Math.random() < 0.35 ? 0.55 : 1);
        puff.lift = style.rise * (0.15 + 1.5 * climb);
        puff.turn = Math.random() * Math.PI * 2;
        puff.albedo = style.albedo * (0.88 + Math.random() * 0.24);
        // A thinning cloud's billows grow faint quickly, so they are soft (see `solid`).
        puff.opacity = (0.2 + strength * strength * 0.5) * style.dense;
        puff.sun = this.light?.sunlit(scratch.copy(puff.position).setY(puff.position.y + 0.6)) ? 1 : 0;
      }
    }
    // 0 until the haze round the eye is more than half thick, 1 where it is at its thickest.
    const drawn = this.order, deep = Math.min(1, Math.max(0, (this.fogAt(this.eye) - 0.55) / 0.35));
    drawn.length = 0;
    for (const puff of this.puffs) {
      const leak = puff.cloud;
      if (!leak) continue;
      puff.age += seconds;
      const t = puff.age / puff.life;
      if (t >= 1) { puff.cloud = null; continue; }
      // The jet slows as it spreads, and the warm cloud drifts upward.
      puff.velocity.multiplyScalar(Math.exp(-seconds * 1.8));
      puff.velocity.y += seconds * puff.lift;
      puff.position.addScaledVector(puff.velocity, seconds);
      puff.scale = puff.size * (0.25 + 0.75 * Math.sqrt(t));
      // Billows roll along the wall rather than through it.
      const reach = puff.scale * 0.3, depth = scratch.copy(puff.position).sub(leak.wall).dot(leak.out);
      if (depth < reach) puff.position.addScaledVector(leak.out, reach - depth);
      // It stays thick for the first half of its life, then thins away.
      const late = Math.max(0, (t - 0.45) / 0.55);
      puff.fade = puff.opacity * (t < 0.08 ? t / 0.08 : 1 - late * late * (3 - 2 * late));
      puff.t = t;
      puff.far = puff.position.distanceToSquared(this.eye);
      // A billow that the eye is inside would cover the whole view, and there can be many: they
      // cost the most to draw and show nothing that the view's own haze (fogAt) does not. So a
      // billow fades out as the eye comes into it, and is not drawn at all once the eye is well in.
      // Deep in a cloud, where the haze already covers nearly all the view, the billows nearest
      // the eye are not drawn out to about their own size; the ones beyond still close the view.
      const near = Math.sqrt(puff.far) / puff.scale, shown = puff.fade * Math.min(1, Math.max(0, (near - 0.3 - deep * 0.6) / 0.5));
      puff.shown = shown;
      if (shown > 0.004) drawn.push(puff);
    }
    if (!this.mesh) return;
    // Far billows first, so nearer ones are laid over them.
    drawn.sort((a, b) => b.far - a.far);
    const places = this.places.array as Float32Array, looks = this.looks.array as Float32Array;
    drawn.forEach((puff, i) => {
      places[i * 4] = puff.position.x; places[i * 4 + 1] = puff.position.y; places[i * 4 + 2] = puff.position.z; places[i * 4 + 3] = puff.scale;
      looks[i * 4] = puff.shown; looks[i * 4 + 1] = puff.albedo; looks[i * 4 + 2] = puff.turn; looks[i * 4 + 3] = puff.sun * 2 + Math.min(0.999, puff.t);
    });
    if (!drawn.length) { places[3] = 0; looks[0] = 0; }
    this.mesh.count = Math.max(1, drawn.length);
    this.places.needsUpdate = true;
    this.looks.needsUpdate = true;
  }

  // How thick the clouds are at a point, 0 clear to 0.95: billows around the eye do not
  // cover the view the way a real cloud does, so the view lays this much haze over the world.
  fogAt(point: Vec3): number {
    let sum = 0;
    for (const puff of this.puffs) {
      if (!puff.cloud) continue;
      const r = puff.scale * 0.5, p = puff.position;
      const d = Math.hypot(p.x - point.x, p.y - point.y, p.z - point.z);
      if (d < r) sum += puff.fade * (1 - d / r) ** 2;
    }
    return Math.min(0.95, 1 - Math.exp(-2.2 * sum));
  }

  // Whether the clouds hide one point from another: the line between them passes through as much
  // cloud as 1.4 m of the thickest smoke. So the middle of a cloud hides, and its thin rim does not.
  hides(from: Vec3, to: Vec3): boolean {
    if (!this.leaks.size) return false;
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z, length = Math.hypot(dx, dy, dz);
    const steps = Math.min(48, Math.ceil(length / 0.5)), step = length / Math.max(1, steps);
    let cover = 0;
    for (let i = 0; i < steps; i += 1) {
      const k = (i + 0.5) / steps;
      cover += this.fogAt({ x: from.x + dx * k, y: from.y + dy * k, z: from.z + dz * k }) * step;
      if (cover > 1.4) return true;
    }
    return false;
  }

  // The colour of a cloud seen from inside it at a point, lit as its billows are there: for the
  // haze the view lays over the world.
  colourAt(point: Vec3, albedo = 0.55, target = new Color()): Color {
    const light = this.light;
    if (!light) return target.setScalar(0.2);
    const [r, g, b] = lampLightAt(light.lamps, point.x, point.y, point.z);
    const sun = light.sunlit(scratch.set(point.x, point.y, point.z)) ? 0.45 * light.sun.intensity : 0, sky = 0.7 * light.sky.intensity, ground = 0.4 * light.sky.intensity;
    return target.setRGB(
      (light.sun.color.r * sun + light.sky.color.r * sky + light.sky.ground.r * ground + r) * albedo / Math.PI,
      (light.sun.color.g * sun + light.sky.color.g * sky + light.sky.ground.g * ground + g) * albedo / Math.PI,
      (light.sun.color.b * sun + light.sky.color.b * sky + light.sky.ground.b * ground + b) * albedo / Math.PI,
    );
  }

  dispose(): void {
    for (const id of [...this.leaks.keys()]) this.restore(id);
    this.mesh?.removeFromParent();
    this.mesh?.geometry.dispose();
    (this.mesh?.material as MeshBasicNodeMaterial | undefined)?.dispose();
    this.map.dispose();
    this.grain.dispose();
  }
}
