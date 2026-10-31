import {
  AdditiveBlending, BoxGeometry, CanvasTexture, Color, CylinderGeometry, Euler, Group, InstancedMesh, Matrix4, Mesh,
  MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, PointLight, Quaternion, Scene, SphereGeometry, Sprite, SpriteMaterial, Vector3, type Object3D,
} from "three/webgpu";
import { terrainHeight, type ArenaData } from "./arena";
import { type InstanceRef, type WorldEntity, type Vec3 } from "./entities";
import { MATERIALS, type Material } from "./materials";
import { type GrenadePath } from "./physics";
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

interface Particle { alive: boolean; position: Vector3; velocity: Vector3; rotation: Euler; spin: Vector3; age: number; life: number; size: number; stretch: number; gravity: number; floor: number }

class ParticlePool {
  readonly mesh: InstancedMesh;
  private particles: Particle[];
  private next = 0;
  private matrix = new Matrix4();
  private quaternion = new Quaternion();
  private scale = new Vector3();
  private color = new Color();

  constructor(glow: boolean, count: number) {
    const material = glow ? new MeshBasicMaterial({ color: 0xffffff, toneMapped: false }) : new MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
    this.mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), material, count);
    this.mesh.frustumCulled = false;
    this.particles = Array.from({ length: count }, () => ({ alive: false, position: new Vector3(), velocity: new Vector3(), rotation: new Euler(), spin: new Vector3(), age: 0, life: 1, size: 0, stretch: 1, gravity: 9, floor: 0 }));
    for (let index = 0; index < count; index += 1) { this.mesh.setMatrixAt(index, new Matrix4().makeScale(0, 0, 0)); this.mesh.setColorAt(index, this.color.set(0xffffff)); }
  }

  spawn(at: Vec3, direction: Vec3, count: number, style: Style, floor: number, spread = 0.9): void {
    const look = STYLES[style];
    const range = (pair: [number, number]): number => pair[0] + Math.random() * (pair[1] - pair[0]);
    for (let i = 0; i < count; i += 1) {
      const index = this.next;
      this.next = (this.next + 1) % this.particles.length;
      const particle = this.particles[index];
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
      particle.alive = true;
      this.mesh.setColorAt(index, this.color.set(look.colors[Math.floor(Math.random() * look.colors.length)]));
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  update(seconds: number): void {
    let touched = false;
    this.particles.forEach((particle, index) => {
      if (!particle.alive) return;
      touched = true;
      particle.age += seconds;
      if (particle.age >= particle.life) {
        particle.alive = false;
        this.mesh.setMatrixAt(index, this.matrix.makeScale(0, 0, 0));
        return;
      }
      particle.velocity.y -= particle.gravity * seconds;
      particle.position.addScaledVector(particle.velocity, seconds);
      if (particle.position.y < particle.floor) {
        particle.position.y = particle.floor;
        particle.velocity.set(particle.velocity.x * 0.5, -particle.velocity.y * 0.25, particle.velocity.z * 0.5);
        particle.spin.multiplyScalar(0.6);
      }
      particle.rotation.x += particle.spin.x * seconds; particle.rotation.y += particle.spin.y * seconds; particle.rotation.z += particle.spin.z * seconds;
      const fade = Math.min(1, (particle.life - particle.age) / (particle.life * 0.35));
      const size = particle.size * fade;
      this.quaternion.setFromEuler(particle.rotation);
      this.matrix.compose(particle.position, this.quaternion, this.scale.set(size, size * particle.stretch, size));
      this.mesh.setMatrixAt(index, this.matrix);
    });
    if (touched) this.mesh.instanceMatrix.needsUpdate = true;
  }
}

function holeTexture(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const context = canvas.getContext("2d")!;
  const gradient = context.createRadialGradient(32, 32, 2, 32, 32, 31);
  gradient.addColorStop(0, "rgba(10,10,10,1)");
  gradient.addColorStop(0.28, "rgba(25,23,20,0.95)");
  gradient.addColorStop(0.45, "rgba(70,64,56,0.6)");
  gradient.addColorStop(1, "rgba(120,112,100,0)");
  context.fillStyle = gradient;
  context.beginPath();
  for (let angle = 0; angle < Math.PI * 2; angle += 0.35) {
    const radius = 22 + Math.random() * 9;
    context.lineTo(32 + Math.cos(angle) * radius, 32 + Math.sin(angle) * radius);
  }
  context.fill();
  return new CanvasTexture(canvas);
}

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
interface FlyingGrenade { mesh: Group; path: GrenadePath; start: number; bounce: number }

// Visual effects of combat on the world: impacts, bullet holes, breaking objects,
// explosions and grenades in flight. Nothing here affects the game state.
export class WorldEffects {
  private solid = new ParticlePool(false, 700);
  private glow = new ParticlePool(true, 260);
  private decals: InstancedMesh;
  private nextDecal = 0;
  private hidden = new Map<string, { ref: InstanceRef; matrix: Matrix4 }[]>();
  private smoke: Smoke[] = [];
  private flash = new PointLight(0xffb070, 0, 22, 1.6);
  private fireball: Sprite;
  private puffMap = puffTexture();
  private fireAge = 9;
  private grenades = new Map<number, FlyingGrenade>();
  private grenadeGeometry = { body: new SphereGeometry(0.045, 10, 8), lever: new BoxGeometry(0.012, 0.07, 0.022), cap: new CylinderGeometry(0.018, 0.02, 0.03, 8) };
  private grenadeMaterial = new MeshStandardMaterial({ color: 0x3f4a33, roughness: 0.55, metalness: 0.3 });
  private leverMaterial = new MeshStandardMaterial({ color: 0x9a9c94, roughness: 0.4, metalness: 0.8 });
  private matrix = new Matrix4();
  private quaternion = new Quaternion();
  shake = 0;

  // `groups` holds plain objects drawn for an entity (hand-built maps), hidden while it is destroyed.
  constructor(private scene: Scene, private data: ArenaData, private refs: Map<string, InstanceRef[]>, private camera: () => Vector3, private groups = new Map<string, Object3D[]>()) {
    scene.add(this.solid.mesh, this.glow.mesh, this.flash);
    this.decals = new InstancedMesh(new PlaneGeometry(1, 1), new MeshStandardMaterial({ map: holeTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: 1 }), 260);
    this.decals.frustumCulled = false;
    for (let index = 0; index < 260; index += 1) this.decals.setMatrixAt(index, new Matrix4().makeScale(0, 0, 0));
    scene.add(this.decals);
    this.fireball = new Sprite(new SpriteMaterial({ map: this.puffMap, color: 0xffa54a, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, toneMapped: false }));
    this.fireball.visible = false;
    scene.add(this.fireball);
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
    this.nextDecal = (this.nextDecal + 1) % 260;
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
    const size = { wood: 0.05, timber: 0.06, "metal-thin": 0.035, "metal-solid": 0.03, plastic: 0.04, cardboard: 0.045, concrete: 0.07, brick: 0.065, ground: 0.09, rubber: 0.03 }[material as Exclude<Material, "flesh" | "glass" | "boundary">] ?? 0.05;
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
  // when it bounces. The burst replaces it when the explode event arrives.
  throwGrenade(id: number, path: GrenadePath): void {
    const mesh = new Group();
    const body = new Mesh(this.grenadeGeometry.body, this.grenadeMaterial);
    body.scale.set(1, 1.25, 1);
    const cap = new Mesh(this.grenadeGeometry.cap, this.leverMaterial);
    cap.position.y = 0.062;
    const lever = new Mesh(this.grenadeGeometry.lever, this.leverMaterial);
    lever.position.set(0.035, 0.03, 0);
    mesh.add(body, cap, lever);
    mesh.position.set(path.points[0].x, path.points[0].y, path.points[0].z);
    this.scene.add(mesh);
    this.grenades.set(id, { mesh, path, start: performance.now(), bounce: 0 });
  }

  removeGrenade(id: number): void {
    const grenade = this.grenades.get(id);
    if (!grenade) return;
    this.scene.remove(grenade.mesh);
    this.grenades.delete(id);
  }

  update(seconds: number): void {
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
      if (elapsed > grenade.path.points.length * grenade.path.step + 1.5) this.removeGrenade(id);
    }
  }
}
