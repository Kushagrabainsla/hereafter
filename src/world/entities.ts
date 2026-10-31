import { type InstancedMesh } from "three/webgpu";
import { type Material } from "./materials";

export interface Vec3 { x: number; y: number; z: number }

export type EntityShape =
  | { type: "box"; half: [number, number, number] }
  | { type: "cylinder"; halfHeight: number; radius: number };

// A world object that bullets and blasts can hit. Every client builds the same list in the
// same order from the map definition, so ids agree without being sent.
export interface WorldEntity {
  id: string;
  kind: "window" | "prop" | "stall" | "pane" | "tyre" | "tank" | "lamp" | "door" | "boards" | "pipe" | "extinguisher";
  material: Material;
  maxHealth: number;
  center: Vec3;
  yaw: number;
  shape?: EntityShape;
  // Loose objects are simulated by the coordinating peer and pushed by hits and blasts.
  mass?: number;
  prop?: string;
  // Bursts some time after it is destroyed, like a grenade, for gas cylinders.
  explosive?: boolean;
}

// One instance of an instanced mesh, which draws part of an entity.
export interface InstanceRef { mesh: InstancedMesh; index: number }

const WINDOW_HALF = [0.69, 0.88] as const;
const GRID = 6;

export class EntityRegistry {
  private byId = new Map<string, WorldEntity>();
  private windowGrid = new Map<string, WorldEntity[]>();
  private health = new Map<string, number>();
  // Where an entity is now; loose props move, everything else stays at its centre.
  locate: (entity: WorldEntity) => Vec3 = (entity) => entity.center;

  add(entity: WorldEntity): void {
    this.byId.set(entity.id, entity);
    if (entity.kind !== "window") return;
    const key = `${Math.floor(entity.center.x / GRID)}:${Math.floor(entity.center.z / GRID)}`;
    const cell = this.windowGrid.get(key) ?? [];
    cell.push(entity);
    this.windowGrid.set(key, cell);
  }

  get(id: string): WorldEntity | undefined { return this.byId.get(id); }
  all(): IterableIterator<WorldEntity> { return this.byId.values(); }
  healthOf(id: string): number { return this.health.get(id) ?? this.byId.get(id)?.maxHealth ?? 0; }
  destroyed(id: string): boolean { return this.healthOf(id) <= 0; }

  // Applies the coordinating peer's health table; returns entities destroyed by this update.
  applyHealth(table: Record<string, number>): WorldEntity[] {
    const fallen: WorldEntity[] = [];
    for (const [id, health] of Object.entries(table)) {
      const entity = this.byId.get(id);
      if (!entity) continue;
      const before = this.healthOf(id);
      this.health.set(id, health);
      if (before > 0 && health <= 0) fallen.push(entity);
    }
    return fallen;
  }

  resetHealth(): WorldEntity[] {
    const restored = [...this.health.entries()].filter(([, health]) => health <= 0).map(([id]) => this.byId.get(id)!).filter(Boolean);
    this.health.clear();
    return restored;
  }

  // The unbroken window, if any, whose glass contains a point on a building wall.
  windowAt(point: Vec3): WorldEntity | null {
    const cx = Math.floor(point.x / GRID), cz = Math.floor(point.z / GRID);
    for (let dx = -1; dx <= 1; dx += 1) for (let dz = -1; dz <= 1; dz += 1) {
      for (const window of this.windowGrid.get(`${cx + dx}:${cz + dz}`) ?? []) {
        if (this.destroyed(window.id)) continue;
        const ox = point.x - window.center.x, oy = point.y - window.center.y, oz = point.z - window.center.z;
        const along = ox * Math.cos(window.yaw) - oz * Math.sin(window.yaw);
        const depth = ox * Math.sin(window.yaw) + oz * Math.cos(window.yaw);
        if (Math.abs(along) <= WINDOW_HALF[0] && Math.abs(oy) <= WINDOW_HALF[1] && Math.abs(depth) < 0.35) return window;
      }
    }
    return null;
  }

  // Intact entities within a radius of a point, measured to their centres.
  near(center: Vec3, radius: number): { id: string; distance: number; point: Vec3 }[] {
    const found: { id: string; distance: number; point: Vec3 }[] = [];
    for (const entity of this.byId.values()) {
      if (this.destroyed(entity.id)) continue;
      const at = this.locate(entity);
      const distance = Math.hypot(at.x - center.x, at.y - center.y, at.z - center.z);
      if (distance < radius) found.push({ id: entity.id, distance, point: at });
    }
    return found;
  }
}
