import { terrainHeight, type ArenaData } from "./arena";
import { CollisionWorld } from "./collision";
import { type Material } from "./materials";

export interface Vec3 { x: number; y: number; z: number }

export type EntityShape =
  | { type: "box"; half: [number, number, number] }
  | { type: "cylinder"; halfHeight: number; radius: number };

// A world object that bullets and blasts can hit. Every client builds the same list in the
// same order from the bundled arena data, so ids agree without being sent.
export interface WorldEntity {
  id: string;
  kind: "cover" | "planter" | "hydrant" | "tree" | "pole" | "lamp" | "window" | "prop";
  material: Material;
  maxHealth: number;
  center: Vec3;
  yaw: number;
  shape?: EntityShape;
  // Loose objects are simulated by the coordinating peer and pushed by hits and blasts.
  mass?: number;
  prop?: string;
}

export interface WindowPlacement { east: number; north: number; height: number; yaw: number }
export interface LightPlacement { east: number; north: number; towardEast: number; towardNorth: number }

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

export function buildEntities(data: ArenaData, windows: WindowPlacement[], lights: LightPlacement[]): WorldEntity[] {
  const collision = new CollisionWorld(data);
  const entities: WorldEntity[] = [];
  const ground = (east: number, north: number): number => terrainHeight(data, east, north);
  // Each cover piece is two barrier segments side by side; each can break on its own.
  collision.cover.forEach((item, index) => {
    for (const [segment, side] of [-1, 1].entries()) {
      const east = item.east + side * 0.78 * Math.cos(item.yaw), north = item.north - side * 0.78 * Math.sin(item.yaw);
      entities.push({ id: `cover:${index}:${segment}`, kind: "cover", material: "concrete", maxHealth: 420, yaw: item.yaw,
        center: { x: east, y: ground(item.east, item.north) + 0.56, z: north }, shape: { type: "box", half: [0.78, 0.56, 0.35] } });
    }
  });
  collision.furniture.forEach((item, index) => {
    const planter = item.kind === "planter";
    const halfHeight = planter ? 0.55 : 0.48;
    entities.push({ id: `furniture:${index}`, kind: planter ? "planter" : "hydrant", material: planter ? "concrete" : "metal-solid", maxHealth: planter ? 240 : Infinity, yaw: 0,
      center: { x: item.east, y: ground(item.east, item.north) + halfHeight, z: item.north }, shape: { type: "cylinder", halfHeight, radius: item.radius } });
  });
  data.trees.forEach(([east, north], index) => {
    entities.push({ id: `tree:${index}`, kind: "tree", material: "timber", maxHealth: Infinity, yaw: 0,
      center: { x: east, y: ground(east, north) + 2.85, z: north }, shape: { type: "cylinder", halfHeight: 2.85, radius: 0.35 } });
  });
  lights.forEach((light, index) => {
    const base = ground(light.east, light.north);
    entities.push({ id: `pole:${index}`, kind: "pole", material: "metal-solid", maxHealth: Infinity, yaw: 0,
      center: { x: light.east, y: base + 3.15, z: light.north }, shape: { type: "cylinder", halfHeight: 3.15, radius: 0.1 } });
    entities.push({ id: `lamp:${index}`, kind: "lamp", material: "glass", maxHealth: 1, yaw: -Math.atan2(light.towardNorth, light.towardEast),
      center: { x: light.east + light.towardEast * 1.05, y: base + 6.18, z: light.north + light.towardNorth * 1.05 }, shape: { type: "box", half: [0.21, 0.05, 0.125] } });
  });
  windows.forEach((window, index) => {
    entities.push({ id: `window:${index}`, kind: "window", material: "glass", maxHealth: 1, yaw: window.yaw,
      center: { x: window.east, y: window.height, z: window.north } });
  });
  return entities;
}

