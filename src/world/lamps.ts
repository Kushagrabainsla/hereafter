import { InstancedMesh, Matrix4, type Material as SurfaceMaterial, type Mesh, type MeshStandardMaterial, type Object3D, type PointLight } from "three/webgpu";
import { type Vec3, type WorldEntity } from "./entities";
import { type Material } from "./materials";

// What goes dark when a lamp breaks: one instance of an instanced glow (moved to a matching
// dark mesh), a glowing material (its emissive turned down), a mesh (given dark glass), or a
// whole object (hidden).
export type LampPart =
  | { kind: "instance"; lit: InstancedMesh; dark: InstancedMesh; index: number }
  | { kind: "material"; material: MeshStandardMaterial; base: number }
  | { kind: "mesh"; mesh: Mesh; lit: SurfaceMaterial; dark: SurfaceMaterial }
  | { kind: "object"; object: Object3D };

// One real light and the lamps that feed it: it shines in proportion to how many still do.
interface LightShare { index: number; lamps: string[] }

// A lamp is out when it is broken or the circuit feeding it is.
interface Lamp { parts: LampPart[]; broken: boolean; unpowered: boolean; flicker: number; circuit: string[] }

const HIDDEN = new Matrix4().makeScale(0, 0, 0);
const scratch = new Matrix4();

// Every lamp in the market that a round or a blast can break: string-light runs, lanterns,
// wall lamps, pendants and signs. Each is a one-hit glass entity; breaking it moves its glow
// to a dark copy or turns its sign off, and dims the real light it fed. A broken lamp
// sputters for a moment before it dies.
export class Lamps {
  readonly entities: WorldEntity[] = [];
  private lamps = new Map<string, Lamp>();
  private shares: LightShare[] = [];
  private points: (PointLight | null)[] = [];
  private base: number[] = [];
  // Where the renderer keeps only a few key lights (WebGL), each dims with the lamps near it.
  private keys: { point: PointLight; base: number; near: number[] }[] = [];

  constructor(private sources: [number, number, number, number, number, number][]) {
    this.base = sources.map((source) => source[4]);
  }

  // A lamp with a box or cylinder collider, its glowing parts and the dense lights it feeds.
  // Most are one-hit glass; a breaker box is tougher, and breaking it cuts its circuit.
  add(id: string, center: Vec3, shape: WorldEntity["shape"], yaw: number, parts: LampPart[], lights: number[] = [], options: { material?: Material; maxHealth?: number; circuit?: string[] } = {}): void {
    this.entities.push({ id, kind: "lamp", material: options.material ?? "glass", maxHealth: options.maxHealth ?? 1, yaw, center, shape });
    this.lamps.set(id, { parts, broken: false, unpowered: false, flicker: 0, circuit: options.circuit ?? [] });
    for (const index of lights) {
      const share = this.shares.find((item) => item.index === index);
      if (share) share.lamps.push(id); else this.shares.push({ index, lamps: [id] });
    }
  }

  // The real lights, in the order of the light sources, once the renderer has made them
  // (null where it made none, as on WebGL).
  setLights(points: (PointLight | null)[]): void { this.points = points; this.apply(); }

  // Key lights standing in for many lamps: each follows the lamps within 7 m of it.
  setKeyLights(points: PointLight[]): void {
    this.keys = points.map((point) => ({
      point, base: point.intensity,
      near: this.sources.map((source, index) => [index, Math.hypot(source[0] - point.position.x, source[1] - point.position.y, source[2] - point.position.z)]).filter(([, d]) => d < 7).map(([index]) => index),
    }));
    this.apply();
  }

  setBroken(id: string, broken: boolean): void {
    const lamp = this.lamps.get(id);
    if (!lamp || lamp.broken === broken) return;
    const wasOut = this.out(lamp);
    lamp.broken = broken;
    this.changed(lamp, wasOut);
    for (const fed of lamp.circuit) {
      const other = this.lamps.get(fed);
      if (!other) continue;
      const before = this.out(other);
      other.unpowered = broken;
      this.changed(other, before);
    }
    this.apply();
  }

  private out(lamp: Lamp): boolean { return lamp.broken || lamp.unpowered; }

  // A lamp that just went out sputters first; one that came back shows at once.
  private changed(lamp: Lamp, wasOut: boolean): void {
    const out = this.out(lamp);
    if (out === wasOut) return;
    lamp.flicker = out ? 0.45 : 0;
    if (!out) this.show(lamp, 1);
  }

  broken(id: string): boolean { const lamp = this.lamps.get(id); return !!lamp && this.out(lamp); }

  private show(lamp: Lamp, level: number): void {
    for (const part of lamp.parts) {
      if (part.kind === "instance") {
        const on = level > 0.5;
        part.lit.getMatrixAt(part.index, scratch);
        if (scratch.determinant() === 0) part.dark.getMatrixAt(part.index, scratch);
        part.lit.setMatrixAt(part.index, on ? scratch : HIDDEN);
        part.dark.setMatrixAt(part.index, on ? HIDDEN : scratch);
        part.lit.instanceMatrix.needsUpdate = true;
        part.dark.instanceMatrix.needsUpdate = true;
      } else if (part.kind === "material") part.material.emissiveIntensity = part.base * level;
      else if (part.kind === "mesh") part.mesh.material = level > 0.5 ? part.lit : part.dark;
      else part.object.visible = level > 0.5;
    }
  }

  // Each light shines by the share of its lamps still whole, and so does what the
  // first-person view reads from the light sources.
  private apply(): void {
    for (const share of this.shares) {
      const alive = share.lamps.filter((id) => !this.out(this.lamps.get(id)!)).length / share.lamps.length;
      const intensity = this.base[share.index] * alive;
      this.sources[share.index][4] = intensity;
      const point = this.points[share.index];
      if (point) point.intensity = intensity;
    }
    for (const key of this.keys) {
      if (!key.near.length) continue;
      const lit = key.near.reduce((sum, index) => sum + (this.base[index] ? this.sources[index][4] / this.base[index] : 1), 0) / key.near.length;
      key.point.intensity = key.base * lit;
    }
  }

  // Whether a lamp is dark now, for instanced glows that redraw every frame (lanterns).
  dark(id: string): boolean {
    const lamp = this.lamps.get(id);
    return !!lamp && this.out(lamp) && lamp.flicker <= 0;
  }

  update(seconds: number): void {
    for (const lamp of this.lamps.values()) {
      if (lamp.flicker <= 0) continue;
      lamp.flicker = Math.max(0, lamp.flicker - seconds);
      // A dying lamp sputters: on and off a few times, then out.
      this.show(lamp, lamp.flicker > 0 && Math.random() < 0.45 ? 0.6 + Math.random() * 0.6 : 0);
    }
  }
}

