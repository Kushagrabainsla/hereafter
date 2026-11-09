import {
  AdditiveBlending, BufferGeometry, CanvasTexture, Color, Euler, Group, InstancedMesh, Matrix4,
  MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, PointLight, Quaternion, Scene, Sprite, SpriteMaterial, SRGBColorSpace, Vector3, type Object3D,
} from "three/webgpu";
import { terrainHeight, type ArenaData } from "./arena";
import { type InstanceRef, type WorldEntity, type Vec3 } from "./entities";
import { MATERIALS, type Material } from "./materials";
import { type GrenadePath } from "./physics";
import { kitObject, type KitPiece } from "./kit";
import { gameAudio } from "../game/gameAudio";

type Style = "dust" | "sparks" | "splinters" | "shards" | "puff" | "blood" | "chunks" | "soil" | "leaves" | "embers";

// Particle looks: colours, size and speed ranges in metres, life in seconds.
const STYLES: Record<Style, { colors: number[]; size: [number, number]; speed: [number, number]; life: [number, number]; gravity: number; stretch?: number; glow?: boolean }> = {
  dust: { colors: [0x9c968a, 0x7f7a70, 0xb5afa3], size: [0.012, 0.035], speed: [1.5, 4], life: [0.5, 1.1], gravity: 9 },
  sparks: { colors: [0xfff1b0, 0xffc860, 0xffe9d0], size: [0.006, 0.012], speed: [4, 9], life: [0.12, 0.3], gravity: 6, stretch: 5, glow: true },
  splinters: { colors: [0x8a6440, 0xb38858, 0x6e4c2e], size: [0.01, 0.025], speed: [1.5, 4], life: [0.6, 1.2], gravity: 9, stretch: 4 },
  shards: { colors: [0xd8eef4, 0xb9d7df, 0xf2fbff], size: [0.015, 0.05], speed: [1, 3.2], life: [0.9, 1.6], gravity: 9.8 },
  puff: { colors: [0xe8e2d6, 0xd2c8b6], size: [0.015, 0.03], speed: [1, 2.5], life: [0.4, 0.8], gravity: 4 },
  blood: { colors: [0x6e1414, 0x8a1c1c], size: [0.01, 0.025], speed: [1, 2.5], life: [0.3, 0.6], gravity: 9 },
  chunks: { colors: [0xa6a398, 0x8f8c82, 0xbdb9ad], size: [0.05, 0.2], speed: [1.5, 5], life: [2.5, 4], gravity: 9.8 },
  soil: { colors: [0x493b2d, 0x5a4836], size: [0.02, 0.06], speed: [1, 3.5], life: [1, 2], gravity: 9.8 },
  leaves: { colors: [0x567452, 0x769169, 0x4e6c4a], size: [0.03, 0.07], speed: [0.8, 2.5], life: [1.5, 2.5], gravity: 2.5 },
  embers: { colors: [0xffb347, 0xff8a2a, 0xffd27a], size: [0.015, 0.035], speed: [3, 9], life: [0.4, 1.1], gravity: 5, glow: true },
};

const IMPACT_STYLE: Record<ReturnType<() => (typeof MATERIALS)[Material]["impact"]>, Style> = { dust: "dust", sparks: "sparks", splinters: "splinters", shards: "shards", puff: "puff", blood: "blood" };

// An instanced mesh that draws only one copy, shrunk to nothing. Drawing it from the first
// frame builds its shaders while the map loads, not at the first shot.
export function hideAll(mesh: InstancedMesh): void {
  mesh.setMatrixAt(0, new Matrix4().makeScale(0, 0, 0));
  mesh.count = 1;
  mesh.instanceMatrix.needsUpdate = true;
}

// The modelled shape (effects.glb) each look of particle is drawn with.
type Shape = "chip" | "splinter" | "shard" | "leaf" | "spark";
const SHAPE: Record<Style, Shape> = { dust: "chip", sparks: "spark", splinters: "splinter", shards: "shard", puff: "chip", blood: "chip", chunks: "chip", soil: "chip", leaves: "leaf", embers: "spark" };

interface Particle { alive: boolean; shape: Shape; color: Color; position: Vector3; velocity: Vector3; rotation: Euler; spin: Vector3; age: number; life: number; size: number; stretch: number; gravity: number; floor: number }

// Debris in flight, drawn as one instanced mesh per shape that holds only the pieces flying, each
// coloured by its look. Glowing pools (sparks, embers) are drawn unlit.
class ParticlePool {
  readonly group = new Group();
  private meshes = new Map<Shape, InstancedMesh>();
  private particles: Particle[];
  private next = 0;
  private matrix = new Matrix4();
  private quaternion = new Quaternion();
  private scale = new Vector3();

  constructor(glow: boolean, count: number, shapes: Map<Shape, BufferGeometry>) {
    const material = glow ? new MeshBasicMaterial({ color: 0xffffff, toneMapped: false }) : new MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
    for (const [shape, geometry] of shapes) {
      const mesh = new InstancedMesh(geometry, material, count);
      mesh.setColorAt(0, new Color(0xffffff));
      hideAll(mesh);
      mesh.frustumCulled = false;
      this.meshes.set(shape, mesh);
      this.group.add(mesh);
    }
    this.particles = Array.from({ length: count }, () => ({ alive: false, shape: "chip" as Shape, color: new Color(), position: new Vector3(), velocity: new Vector3(), rotation: new Euler(), spin: new Vector3(), age: 0, life: 1, size: 0, stretch: 1, gravity: 9, floor: 0 }));
  }

  spawn(at: Vec3, direction: Vec3, count: number, style: Style, floor: number, spread = 0.9): void {
    const look = STYLES[style];
    const range = (pair: [number, number]): number => pair[0] + Math.random() * (pair[1] - pair[0]);
    for (let i = 0; i < count; i += 1) {
      const particle = this.particles[this.next];
      this.next = (this.next + 1) % this.particles.length;
      const speed = range(look.speed);
      const random = new Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).multiplyScalar(spread);
      particle.velocity.set(direction.x, direction.y, direction.z).add(random).normalize().multiplyScalar(speed);
      particle.position.set(at.x, at.y, at.z);
      particle.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      particle.spin.set(Math.random() * 16 - 8, Math.random() * 16 - 8, Math.random() * 16 - 8);
      particle.age = 0;
      particle.life = range(look.life);
      particle.size = range(look.size);
      particle.stretch = look.stretch ?? 1;
      particle.gravity = look.gravity;
      particle.floor = floor;
      particle.shape = SHAPE[style];
      particle.color.set(look.colors[Math.floor(Math.random() * look.colors.length)]);
      particle.alive = true;
    }
  }

  update(seconds: number): void {
    const counts = new Map<Shape, number>();
    for (const particle of this.particles) {
      if (!particle.alive) continue;
      particle.age += seconds;
      if (particle.age >= particle.life) { particle.alive = false; continue; }
      particle.velocity.y -= particle.gravity * seconds;
      particle.position.addScaledVector(particle.velocity, seconds);
      if (particle.position.y < particle.floor) {
        particle.position.y = particle.floor;
        particle.velocity.set(particle.velocity.x * 0.5, -particle.velocity.y * 0.25, particle.velocity.z * 0.5);
        particle.spin.multiplyScalar(0.6);
      }
      particle.rotation.x += particle.spin.x * seconds; particle.rotation.y += particle.spin.y * seconds; particle.rotation.z += particle.spin.z * seconds;
      const mesh = this.meshes.get(particle.shape);
      if (!mesh) continue;
      const fade = Math.min(1, (particle.life - particle.age) / (particle.life * 0.35));
      const size = particle.size * fade, index = counts.get(particle.shape) ?? 0;
      this.quaternion.setFromEuler(particle.rotation);
      mesh.setMatrixAt(index, this.matrix.compose(particle.position, this.quaternion, this.scale.set(size, size * particle.stretch, size)));
      mesh.setColorAt(index, particle.color);
      counts.set(particle.shape, index + 1);
    }
    for (const [shape, mesh] of this.meshes) {
      const count = counts.get(shape) ?? 0;
      if (count === 0) { if (mesh.count !== 1 || mesh.userData.live) { hideAll(mesh); mesh.userData.live = false; } continue; }
      mesh.userData.live = true;
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
}


// Bullet holes kept at once; the oldest goes when another is made.
const DECALS = 260;

interface Smoke { mesh: Sprite; material: SpriteMaterial; age: number; life: number; growth: number; rise: number; base: number }

// A soft round puff with a ragged edge, for smoke, dust clouds and the fireball.
function puffTexture(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const context = canvas.getContext("2d")!;
  for (let i = 0; i < 9; i += 1) {
    const x = 64 + (Math.random() - 0.5) * 34, y = 64 + (Math.random() - 0.5) * 34, r = 30 + Math.random() * 22;
    const gradient = context.createRadialGradient(x, y, 0, x, y, r);
    gradient.addColorStop(0, "rgba(255,255,255,0.55)");
    gradient.addColorStop(0.6, "rgba(255,255,255,0.22)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 128, 128);
  }
  return new CanvasTexture(canvas);
}
interface FlyingGrenade { mesh: Object3D; path: GrenadePath; start: number; bounce: number; linger: number }

// A tongue of flame, for jets from shot drums and things on fire: wide low down, narrowing to
// a tip, white-hot in its core and fading to red and nothing at its edges.
function flameTexture(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64; canvas.height = 128;
  const g = canvas.getContext("2d")!, image = g.createImageData(64, 128);
  const clamp = (value: number): number => Math.max(0, Math.min(1, value));
  for (let row = 0; row < 128; row += 1) for (let column = 0; column < 64; column += 1) {
    const across = Math.abs((column + 0.5) / 32 - 1), up = 1 - (row + 0.5) / 128;
    const half = Math.min(0.92, 2.4 * (1 - up) ** 0.9 * (up + 0.1) ** 0.4);
    const out = across / Math.max(0.001, half), heat = clamp(out * 0.75 + up * 0.55);
    const alpha = clamp(1 - out) ** 1.3 * clamp((1 - up) * 3.5) * clamp(up * 14 + 0.15);
    const index = (row * 64 + column) * 4;
    image.data[index] = 255;
    image.data[index + 1] = 240 - 190 * heat;
    image.data[index + 2] = 190 * clamp(1 - heat * 2.2);
    image.data[index + 3] = 255 * alpha;
  }
  g.putImageData(image, 0, 0);
  const map = new CanvasTexture(canvas);
  map.colorSpace = SRGBColorSpace;
  return map;
}

// Something on fire, as drawn: its base, how far it spreads each way and how tall the flames get.
export interface FlameSpot { x: number; y: number; z: number; wide: number; deep: number; high: number }
// Tongues of flame drawn at once, as one mesh, with no light of their own to pay for.
const FLAME_TONGUES = 170;
const FLAME_UP = new Vector3(0, 1, 0);
const noise = (seed: number): number => { const value = Math.sin(seed * 12.9898) * 43758.5453; return value - Math.floor(value); };

// Visual effects of combat on the world: impacts, bullet holes, breaking objects,
// explosions and grenades in flight. Nothing here affects the game state.
export class WorldEffects {
  private solid: ParticlePool;
  private glow: ParticlePool;
  private decals: InstancedMesh;
  private nextDecal = 0;
  private hidden = new Map<string, { ref: InstanceRef; matrix: Matrix4 }[]>();
  private smoke: Smoke[] = [];
  private flash = new PointLight(0xffb070, 0, 22, 1.6);
  private fireball: Sprite;
  private puffMap = puffTexture();
  private fireAge = 9;
  // Burning jets from shot fuel drums, following the drum until they run out.
  private jets: { sprite: Sprite; follow: () => Vec3 | null; until: number }[] = [];
  private jetMap = flameTexture();
  private flames: InstancedMesh;
  private flameSpots: FlameSpot[] = [];
  private nextBurnSound = 0;
  private grenades = new Map<number, FlyingGrenade>();
  private matrix = new Matrix4();
  private quaternion = new Quaternion();
  private flameAt = new Vector3();
  private flameSize = new Vector3();
  shake = 0;

  // `groups` holds plain objects drawn for an entity (hand-built maps), hidden while it is destroyed.
  constructor(private scene: Scene, private data: ArenaData, private refs: Map<string, InstanceRef[]>, private camera: () => Vector3, private groups = new Map<string, Object3D[]>(), private pieces = new Map<string, KitPiece>()) {
    // Debris and bullet holes are modelled pieces (effects.glb); a missing piece is not drawn.
    const shape = (name: string): BufferGeometry => pieces.get(name)?.parts[0]?.geometry ?? new BufferGeometry();
    const shapes = (names: Shape[]): Map<Shape, BufferGeometry> => new Map(names.map((name) => [name, shape(`debris_${name}`)]));
    this.solid = new ParticlePool(false, 700, shapes(["chip", "splinter", "shard", "leaf"]));
    this.glow = new ParticlePool(true, 260, shapes(["spark"]));
    scene.add(this.solid.group, this.glow.group, this.flash);
    // A hole is a crater with a scorched ring and a spalled rim, its rim tinted by the surface.
    this.decals = new InstancedMesh(shape("bullet_hole"), new MeshStandardMaterial({ vertexColors: true, roughness: 1, polygonOffset: true, polygonOffsetFactor: -4 }), DECALS);
    this.decals.setColorAt(0, new Color(0xffffff));
    hideAll(this.decals);
    this.decals.frustumCulled = false;
    scene.add(this.decals);
    this.fireball = new Sprite(new SpriteMaterial({ map: this.puffMap, color: 0xffa54a, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, toneMapped: false }));
    this.fireball.visible = false;
    scene.add(this.fireball);
    this.flames = new InstancedMesh(new PlaneGeometry(1, 1).translate(0, 0.5, 0), new MeshBasicMaterial({ map: this.jetMap, transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false }), FLAME_TONGUES);
    hideAll(this.flames);
    this.flames.frustumCulled = false;
    scene.add(this.flames);
    for (let i = 0; i < 28; i += 1) {
      const material = new SpriteMaterial({ map: this.puffMap, color: 0x77736c, transparent: true, opacity: 0, depthWrite: false });
      const mesh = new Sprite(material);
      mesh.visible = false;
      scene.add(mesh);
      this.smoke.push({ mesh, material, age: 9, life: 1, growth: 1, rise: 0, base: 0 });
    }
  }

  private floor(at: Vec3): number { return terrainHeight(this.data, at.x, at.z) + 0.02; }

  private decal(at: Vec3, normal: Vec3, size: number, tint = 0xffffff): void {
    const index = this.nextDecal;
    this.nextDecal = (this.nextDecal + 1) % DECALS;
    this.decals.count = Math.max(this.decals.count, index + 1);
    const n = new Vector3(normal.x, normal.y, normal.z).normalize();
    this.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), n);
    this.quaternion.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.random() * Math.PI * 2));
    this.matrix.compose(new Vector3(at.x, at.y, at.z).addScaledVector(n, 0.004), this.quaternion, new Vector3(size, size, size));
    this.decals.setMatrixAt(index, this.matrix);
    this.decals.setColorAt(index, new Color(tint));
    this.decals.instanceMatrix.needsUpdate = true;
    if (this.decals.instanceColor) this.decals.instanceColor.needsUpdate = true;
  }

  private puff(at: Vec3, size: number, life: number, rise: number, color = 0x77736c, opacity = 0.55): void {
    const smoke = this.smoke.reduce((oldest, item) => item.age / item.life > oldest.age / oldest.life ? item : oldest);
    smoke.mesh.position.set(at.x + (Math.random() - 0.5) * size * 0.5, at.y, at.z + (Math.random() - 0.5) * size * 0.5);
    smoke.material.color.set(color);
    smoke.age = 0; smoke.life = life; smoke.growth = size; smoke.rise = rise; smoke.base = opacity;
    smoke.mesh.visible = true;
  }

  // Where a round struck or broke through: particles by material and, on solid surfaces, a hole.
  impact(point: Vec3, normal: Vec3, material: Material, exit = false): void {
    const style = IMPACT_STYLE[MATERIALS[material].impact];
    if (material === "boundary") return;
    const pool = STYLES[style].glow ? this.glow : this.solid;
    pool.spawn(point, normal, style === "sparks" ? 9 : 7, style, this.floor(point), 0.7);
    if (style === "dust") this.solid.spawn(point, normal, 3, "dust", this.floor(point), 1.2);
    if (material === "flesh" || material === "glass") return;
    const size = { wood: 0.05, timber: 0.06, "metal-thin": 0.035, "metal-solid": 0.03, plastic: 0.04, cardboard: 0.045, concrete: 0.07, brick: 0.065, ground: 0.09, rubber: 0.03, masonry: 0.07 }[material as Exclude<Material, "flesh" | "glass" | "boundary">] ?? 0.05;
    this.decal(point, normal, exit ? size * 1.3 : size, material.startsWith("metal") ? 0x9aa0a0 : material === "wood" || material === "timber" ? 0xc8a070 : 0xffffff);
  }

  // A world object breaking apart: hide its instances and throw out matching debris.
  destroy(entity: WorldEntity): void {
    const saved: { ref: InstanceRef; matrix: Matrix4 }[] = [];
    for (const ref of this.refs.get(entity.id) ?? []) {
      const matrix = new Matrix4();
      ref.mesh.getMatrixAt(ref.index, matrix);
      saved.push({ ref, matrix });
      ref.mesh.setMatrixAt(ref.index, new Matrix4().makeScale(0, 0, 0));
      ref.mesh.instanceMatrix.needsUpdate = true;
      if (ref.mesh.instanceColor) ref.mesh.instanceColor.needsUpdate = true;
    }
    this.hidden.set(entity.id, saved);
    for (const object of this.groups.get(entity.id) ?? []) object.visible = false;
    const at = entity.center, floor = this.floor(at), up = { x: 0, y: 1, z: 0 };
    if (entity.kind === "window" || entity.kind === "pane") {
      const out = { x: Math.sin(entity.yaw), y: -0.2, z: Math.cos(entity.yaw) };
      for (let i = 0; i < 4; i += 1) this.solid.spawn({ x: at.x + Math.cos(entity.yaw) * (Math.random() - 0.5) * 1.2, y: at.y + (Math.random() - 0.5) * 1.5, z: at.z - Math.sin(entity.yaw) * (Math.random() - 0.5) * 1.2 }, out, 8, "shards", floor, 0.8);
      gameAudio.shatter(at);
    } else if (entity.kind === "stall") {
      this.solid.spawn({ ...at, y: at.y + 0.4 }, up, 40, "splinters", floor, 1.3);
      this.solid.spawn(at, up, 22, "chunks", floor, 1.2);
      this.puff(at, 1.2, 1.6, 0.4, 0x8a7a64, 0.4);
      gameAudio.splinter(at);
    } else if (entity.kind === "tyre") {
      // Shredded rubber and a puff of dust as the tyre lets go.
      this.solid.spawn({ ...at, y: at.y + 0.1 }, up, 18, "soil", floor, 1.4);
      this.puff({ ...at, y: at.y + 0.2 }, 0.6, 0.9, 0.3, 0x5a5650, 0.35);
      gameAudio.tyreBurst(at);
    } else if (entity.kind === "lamp") {
      // A bulb or tube bursting: a spray of fine glass and a shower of sparks.
      this.solid.spawn(at, { x: 0, y: -0.5, z: 0 }, entity.material === "glass" ? 10 : 2, "shards", floor, 1.2);
      this.glow.spawn(at, { x: 0, y: -0.3, z: 0 }, entity.material === "glass" ? 10 : 22, "sparks", floor, 1.1);
      if (entity.material === "glass") gameAudio.bulbPop(at); else gameAudio.shortCircuit(at);
    } else if (entity.kind === "door" || entity.kind === "boards") {
      // A leaf blown off its hinges, or planks torn from a window.
      if (entity.material === "wood") {
        this.solid.spawn(at, up, 44, "splinters", floor, 1.4);
        this.solid.spawn(at, up, 18, "chunks", floor, 1.2);
        this.puff(at, 1.1, 1.4, 0.3, 0x8a7a64, 0.35);
        gameAudio.splinter(at);
      } else {
        this.glow.spawn(at, up, 18, "sparks", floor, 1.0);
        this.solid.spawn(at, up, 12, "chunks", floor, 1.0);
        gameAudio.impact(entity.material, at);
      }
    } else if (entity.kind === "wall") {
      // A section of wall coming down: brick flying both ways, then a cloud of dust that hangs.
      this.solid.spawn(at, up, 60, "chunks", floor, 1.5);
      this.solid.spawn(at, up, 50, "dust", floor, 1.6);
      for (let i = 0; i < 5; i += 1) this.puff({ x: at.x, y: 0.4 + i * 0.45, z: at.z + (Math.random() - 0.5) * 1.6 }, 2.2 + Math.random(), 2.6 + Math.random() * 1.4, 0.3, 0x9a9184, 0.7);
      gameAudio.crumble(at);
    } else if (entity.kind === "extinguisher") {
      this.glow.spawn(at, up, 6, "sparks", floor, 0.8);
    } else if (entity.kind === "pipe") {
      // Shreds of lagging; the steam itself is drawn by the pipe.
      this.solid.spawn(at, up, 16, "puff", floor, 1.2);
      this.glow.spawn(at, up, 8, "sparks", floor, 0.8);
    } else if (entity.kind === "tank") {
      this.glow.spawn({ ...at, y: at.y + 0.35 }, up, 14, "sparks", floor, 0.4);
    } else if (entity.kind === "prop") {
      const material = entity.material;
      const style: Style = material === "wood" ? "splinters" : material === "cardboard" ? "puff" : material === "glass" ? "shards" : "dust";
      this.solid.spawn(at, up, 30, style, floor, 1.2);
      if (material === "wood") { this.solid.spawn(at, up, 12, "chunks", floor, 1); gameAudio.splinter(at); }
      else if (material === "glass") gameAudio.shatter(at);
      else gameAudio.impact(material, at);
    }
  }

  // A stall shot to its last half: its awning tears and goods tumble off the counter.
  knock(at: Vec3): void {
    const floor = this.floor(at);
    this.solid.spawn({ ...at, y: at.y + 1.0 }, { x: 0, y: 1, z: 0 }, 14, "chunks", floor, 1.1);
    this.solid.spawn({ ...at, y: at.y + 2.2 }, { x: 0, y: 0.5, z: 0 }, 10, "splinters", floor, 0.9);
  }

  // A drum shot open vents a roaring jet of burning fuel from its top until it bursts.
  vent(follow: () => Vec3 | null, seconds: number): void {
    const sprite = new Sprite(new SpriteMaterial({ map: this.jetMap, color: 0xffffff, transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false }));
    this.scene.add(sprite);
    this.jets.push({ sprite, follow, until: performance.now() + seconds * 1000 });
  }

  setFlames(spots: FlameSpot[]): void { this.flameSpots = spots; }

  // Flames face the viewer, each flickering in its own time. The fire nearest the viewer lights
  // its surroundings with the blast light, so burning costs no extra light, and is the one heard.
  private drawFlames(seconds: number): void {
    const time = performance.now() / 1000, camera = this.camera();
    let drawn = 0, nearest: FlameSpot | null = null, closest = Infinity;
    for (let s = 0; s < this.flameSpots.length; s += 1) {
      const spot = this.flameSpots[s];
      const distance = Math.hypot(spot.x - camera.x, spot.z - camera.z);
      if (distance < closest) { closest = distance; nearest = spot; }
      this.quaternion.setFromAxisAngle(FLAME_UP, Math.atan2(camera.x - spot.x, camera.z - spot.z));
      const tongues = distance > 28 ? 3 : Math.max(3, Math.min(8, Math.ceil(4 * (spot.wide + spot.deep) + 2)));
      for (let k = 0; k < tongues && drawn < FLAME_TONGUES; k += 1, drawn += 1) {
        const seed = s * 7.3 + k * 3.1;
        const flicker = 0.75 + 0.2 * Math.sin(time * (9 + k) + seed) + 0.1 * Math.sin(time * 23 + seed * 2);
        const high = spot.high * (0.55 + 0.45 * noise(seed)) * flicker;
        this.flameAt.set(spot.x + (noise(seed + 1) - 0.5) * 2 * spot.wide, spot.y, spot.z + (noise(seed + 2) - 0.5) * 2 * spot.deep);
        this.flames.setMatrixAt(drawn, this.matrix.compose(this.flameAt, this.quaternion, this.flameSize.set(high * 0.62, high, 1)));
      }
      const top = { x: spot.x, y: spot.y + spot.high, z: spot.z };
      if (Math.random() < seconds * 3) this.glow.spawn(top, { x: 0, y: 1, z: 0 }, 1, "embers", this.floor(top), 0.6);
      if (Math.random() < seconds * 1.1 * Math.min(1, 5 / this.flameSpots.length)) this.puff(top, 1.4 + spot.wide, 2.8, 1.1, 0x38342f, 0.4);
    }
    if (drawn) { this.flames.count = drawn; this.flames.instanceMatrix.needsUpdate = true; this.flames.userData.live = true; }
    else if (this.flames.userData.live) { hideAll(this.flames); this.flames.userData.live = false; }
    if (!nearest || closest > 34) return;
    if (this.flash.intensity < 7) {
      this.flash.position.set(nearest.x, nearest.y + nearest.high * 0.7, nearest.z);
      this.flash.intensity = 5 + Math.sin(time * 17) * 0.8 + Math.sin(time * 41) * 0.6;
    }
    if (time >= this.nextBurnSound) {
      this.nextBurnSound = time + 1;
      gameAudio.fireBurn({ x: nearest.x, y: nearest.y + 0.5, z: nearest.z }, Math.min(1, 0.45 + this.flameSpots.length * 0.08));
    }
  }

  restore(entity: WorldEntity): void {
    for (const { ref, matrix } of this.hidden.get(entity.id) ?? []) {
      ref.mesh.setMatrixAt(ref.index, matrix);
      ref.mesh.instanceMatrix.needsUpdate = true;
      if (ref.mesh.instanceColor) ref.mesh.instanceColor.needsUpdate = true;
    }
    this.hidden.delete(entity.id);
    for (const object of this.groups.get(entity.id) ?? []) object.visible = true;
  }

  explosion(at: Vec3): void {
    const floor = this.floor(at);
    this.flash.position.set(at.x, at.y + 0.6, at.z);
    this.flash.intensity = 90;
    this.fireAge = 0;
    this.fireball.position.set(at.x, at.y + 0.35, at.z);
    this.fireball.visible = true;
    this.glow.spawn({ ...at, y: at.y + 0.2 }, { x: 0, y: 1, z: 0 }, 40, "embers", floor, 1.3);
    this.solid.spawn({ ...at, y: at.y + 0.1 }, { x: 0, y: 1, z: 0 }, 36, "dust", floor, 1.4);
    this.solid.spawn({ ...at, y: at.y + 0.1 }, { x: 0, y: 1, z: 0 }, 14, "chunks", floor, 1.2);
    for (let i = 0; i < 10; i += 1) this.puff({ x: at.x + (Math.random() - 0.5) * 1.6, y: at.y + 0.4 + i * 0.22, z: at.z + (Math.random() - 0.5) * 1.6 }, 2.6 + Math.random() * 2.2, 3 + Math.random() * 1.5, 0.7 + Math.random() * 0.5, i < 3 ? 0x3e3b38 : 0x8a857d, 0.85);
    this.decal({ x: at.x, y: floor, z: at.z }, { x: 0, y: 1, z: 0 }, 2.6, 0x1c1a18);
    const camera = this.camera();
    this.shake = Math.max(this.shake, Math.min(1, 9 / (1 + camera.distanceTo(new Vector3(at.x, at.y, at.z)))));
  }

  // A thrown grenade follows the path the physics world computed, spinning, and clinks
  // when it bounces. The burst replaces it when the explode event arrives. A smoke grenade
  // is a can with a white band, and lies where it stopped while its smoke pours out. Both are
  // modelled in items.glb.
  throwGrenade(id: number, path: GrenadePath, smoke = false): void {
    const mesh = kitObject(this.pieces.get(smoke ? "grenade_smoke" : "grenade_frag"));
    mesh.position.set(path.points[0].x, path.points[0].y, path.points[0].z);
    this.scene.add(mesh);
    this.grenades.set(id, { mesh, path, start: performance.now(), bounce: 0, linger: smoke ? 20 : 1.5 });
  }

  removeGrenade(id: number): void {
    const grenade = this.grenades.get(id);
    if (!grenade) return;
    this.scene.remove(grenade.mesh);
    this.grenades.delete(id);
  }

  update(seconds: number): void {
    const clock = performance.now();
    this.jets = this.jets.filter((jet) => {
      const at = jet.follow(), left = (jet.until - clock) / 1000;
      if (!at || left < -0.25) { jet.sprite.removeFromParent(); jet.sprite.material.dispose(); return false; }
      jet.sprite.position.set(at.x, at.y + 1.15, at.z);
      jet.sprite.scale.set(0.55 + Math.random() * 0.2, 1.3 + Math.random() * 0.6, 1);
      jet.sprite.material.opacity = left > 0 ? 1 : Math.max(0, 1 + left * 4);
      if (Math.random() < seconds * 20) this.glow.spawn({ x: at.x, y: at.y + 0.6, z: at.z }, { x: 0, y: 1, z: 0 }, 1, "embers", this.floor(at), 0.6);
      return true;
    });
    this.solid.update(seconds);
    this.glow.update(seconds);
    this.fireAge += seconds;
    if (this.fireball.visible) {
      const t = this.fireAge / 0.38;
      if (t >= 1) this.fireball.visible = false;
      else {
        this.fireball.scale.setScalar(0.8 + 4.2 * Math.min(1, t * 2.4));
        this.fireball.material.opacity = 1 - t;
      }
    }
    this.flash.intensity *= Math.exp(-seconds * 14);
    if (this.flash.intensity < 0.05) this.flash.intensity = 0;
    this.drawFlames(seconds);
    for (const smoke of this.smoke) {
      if (!smoke.mesh.visible) continue;
      smoke.age += seconds;
      const t = smoke.age / smoke.life;
      if (t >= 1) { smoke.mesh.visible = false; continue; }
      smoke.mesh.scale.setScalar(smoke.growth * (0.45 + 0.75 * Math.sqrt(t)));
      smoke.mesh.position.y += smoke.rise * seconds * (1 - t);
      smoke.material.opacity = smoke.base * (t < 0.1 ? t / 0.1 : 1 - (t - 0.1) / 0.9);
    }
    this.shake *= Math.exp(-seconds * 6);
    const now = performance.now();
    for (const [id, grenade] of this.grenades) {
      const elapsed = (now - grenade.start) / 1000;
      const exact = elapsed / grenade.path.step;
      const index = Math.min(grenade.path.points.length - 1, Math.floor(exact));
      const a = grenade.path.points[index], b = grenade.path.points[Math.min(grenade.path.points.length - 1, index + 1)], t = exact - index;
      grenade.mesh.position.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
      const moving = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) > 0.002;
      if (moving) { grenade.mesh.rotation.x += seconds * 14; grenade.mesh.rotation.z += seconds * 9; }
      while (grenade.bounce < grenade.path.bounces.length && grenade.path.bounces[grenade.bounce].index <= index) {
        gameAudio.grenadeBounce(grenade.mesh.position, grenade.path.bounces[grenade.bounce].speed);
        grenade.bounce += 1;
      }
      if (elapsed > grenade.path.points.length * grenade.path.step + grenade.linger) this.removeGrenade(id);
    }
  }
}
