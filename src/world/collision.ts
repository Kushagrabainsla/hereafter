import { DEFAULT_ARENA, terrainHeight, toLocal, type Arena, type ArenaData, type LayoutBox, type Point } from "./arena";

interface BuildingCollider {
  outline: Point[];
  minEast: number;
  maxEast: number;
  minNorth: number;
  maxNorth: number;
}

export interface SpawnPoint {
  east: number;
  north: number;
  heading: number;
}

export interface StreetFurniture {
  east: number;
  north: number;
  kind: "planter" | "hydrant";
  radius: number;
}

export interface CoverObject {
  east: number;
  north: number;
  yaw: number;
}

function pointInsidePolygon(east: number, north: number, outline: Point[]): boolean {
  let inside = false;
  for (let index = 0, previous = outline.length - 1; index < outline.length; previous = index++) {
    const [ax, az] = outline[index];
    const [bx, bz] = outline[previous];
    if ((az > north) !== (bz > north) && east < (bx - ax) * (north - az) / (bz - az) + ax) inside = !inside;
  }
  return inside;
}

function distanceToSegmentSquared(east: number, north: number, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const lengthSquared = dx * dx + dz * dz;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((east - a[0]) * dx + (north - a[1]) * dz) / lengthSquared));
  const closestEast = a[0] + t * dx;
  const closestNorth = a[1] + t * dz;
  return (east - closestEast) ** 2 + (north - closestNorth) ** 2;
}

export class CollisionWorld {
  private buildings: BuildingCollider[];
  // Upright, unrotated solids of a hand-built map that stand in the way at body height.
  private blocks: LayoutBox[];
  readonly furniture: StreetFurniture[];
  readonly cover: CoverObject[];

  constructor(private data: ArenaData) {
    this.buildings = data.buildings.map(({ outline }) => ({
      outline,
      minEast: Math.min(...outline.map(([east]) => east)),
      maxEast: Math.max(...outline.map(([east]) => east)),
      minNorth: Math.min(...outline.map(([, north]) => north)),
      maxNorth: Math.max(...outline.map(([, north]) => north)),
    }));
    this.blocks = (data.layout?.solids ?? []).filter((solid) => !solid.rotation && solid.material !== "boundary" && solid.center.y - solid.half[1] < 1.8 && solid.center.y + solid.half[1] > 0.3);
    this.furniture = this.makeStreetFurniture();
    this.cover = this.makeCover();
  }

  private makeCover(): CoverObject[] {
    const result: CoverObject[] = [];
    const [centerEast, centerNorth] = toLocal(DEFAULT_ARENA.latitude, DEFAULT_ARENA.longitude);
    for (const road of this.data.roads) {
      if (road.width < 8) continue;
      const [a, b] = road.points;
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const length = Math.hypot(dx, dz);
      if (length < 19) continue;
      for (const [index, fraction] of [0.28, 0.72].entries()) {
        const side = (road.id + index) % 2 ? 1 : -1;
        const offset = Math.min(road.width / 2 - 1.6, 3.8) * side;
        const east = a[0] + dx * fraction - dz / length * offset;
        const north = a[1] + dz * fraction + dx / length * offset;
        if (Math.abs(east - centerEast) > DEFAULT_ARENA.sizeMeters / 2 - 5
          || Math.abs(north - centerNorth) > DEFAULT_ARENA.sizeMeters / 2 - 5
          || this.blockedStructure(east, north, 2)
          || this.furniture.some((item) => Math.hypot(item.east - east, item.north - north) < 3)
          || result.some((item) => Math.hypot(item.east - east, item.north - north) < 9)) continue;
        result.push({ east, north, yaw: Math.atan2(-dz, dx) });
      }
    }
    return result.slice(0, 10);
  }

  private blockedLayout(east: number, north: number, radius: number, height?: number): boolean {
    return this.blocks.some(({ center, half }) => Math.abs(east - center.x) < half[0] + radius && Math.abs(north - center.z) < half[2] + radius
      && (height === undefined || (height > center.y - half[1] && height < center.y + half[1])));
  }

  private blockedStructure(east: number, north: number, radius: number): boolean {
    if (this.blockedLayout(east, north, radius)) return true;
    for (const building of this.buildings) {
      if (east < building.minEast - radius || east > building.maxEast + radius || north < building.minNorth - radius || north > building.maxNorth + radius) continue;
      if (pointInsidePolygon(east, north, building.outline)) return true;
      for (let index = 0; index < building.outline.length; index += 1) {
        if (distanceToSegmentSquared(east, north, building.outline[index], building.outline[(index + 1) % building.outline.length]) < radius * radius) return true;
      }
    }
    for (const [treeEast, treeNorth] of this.data.trees) {
      if ((east - treeEast) ** 2 + (north - treeNorth) ** 2 < (radius + 0.35) ** 2) return true;
    }
    return false;
  }

  private makeStreetFurniture(): StreetFurniture[] {
    const furniture: StreetFurniture[] = [];
    for (const road of this.data.roads) {
      if (road.width < 8) continue;
      const [a, b] = road.points;
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const length = Math.hypot(dx, dz);
      if (length < 16) continue;
      const side = road.id % 2 === 0 ? 1 : -1;
      const east = (a[0] + b[0]) / 2 - side * dz / length * (road.width / 2 + 1.35);
      const north = (a[1] + b[1]) / 2 + side * dx / length * (road.width / 2 + 1.35);
      if (Math.abs(east) > 330 || Math.abs(north) > 330 || this.blockedStructure(east, north, 0.72)) continue;
      if (furniture.some((item) => Math.hypot(item.east - east, item.north - north) < 13)) continue;
      const kind = road.id % 4 === 0 ? "hydrant" : "planter";
      furniture.push({ east, north, kind, radius: kind === "planter" ? 0.62 : 0.32 });
    }
    return furniture;
  }

  private blockedCover(east: number, north: number, radius: number): boolean {
    return this.cover.some((item) => {
      const dx = east - item.east;
      const dz = north - item.north;
      const along = dx * Math.cos(item.yaw) - dz * Math.sin(item.yaw);
      const across = dx * Math.sin(item.yaw) + dz * Math.cos(item.yaw);
      return Math.abs(along) < 1.65 + radius && Math.abs(across) < 0.35 + radius;
    });
  }

  private blockedFurniture(east: number, north: number, radius: number): boolean {
    return this.furniture.some((item) => (east - item.east) ** 2 + (north - item.north) ** 2 < (radius + item.radius) ** 2);
  }

  blocked(east: number, north: number, radius: number): boolean {
    return this.blockedStructure(east, north, radius)
      || this.blockedFurniture(east, north, radius)
      || this.blockedCover(east, north, radius);
  }

  blocksShot(east: number, north: number, height: number, radius: number): boolean {
    if (this.data.layout) return this.blockedLayout(east, north, radius, height);
    if (this.blockedStructure(east, north, radius)) return true;
    if (height - terrainHeight(this.data, east, north) > 1.13) return false;
    return this.blockedFurniture(east, north, radius) || this.blockedCover(east, north, radius);
  }

  insideArena(east: number, north: number, arena: Arena, radius = 0): boolean {
    const [centerEast, centerNorth] = toLocal(arena.latitude, arena.longitude);
    const half = arena.sizeMeters / 2 - radius;
    return Math.abs(east - centerEast) <= half && Math.abs(north - centerNorth) <= half;
  }

  findSpawn(arena: Arena, slot = 0): SpawnPoint {
    const spawns = this.data.layout?.spawns;
    if (spawns?.length) return { ...spawns[Math.max(0, slot) % spawns.length] };
    const [centerEast, centerNorth] = toLocal(arena.latitude, arena.longitude);
    const broadRoads = this.data.roads.filter((road) => road.width >= 8);
    const candidates = broadRoads.length ? broadRoads : this.data.roads;
    let best: { score: number; spawn: SpawnPoint; alongEast: number; alongNorth: number } | null = null;
    for (const road of candidates) {
      const [a, b] = road.points;
      const east = (a[0] + b[0]) / 2;
      const north = (a[1] + b[1]) / 2;
      if (!this.insideArena(east, north, arena, 2) || this.blocked(east, north, 2)) continue;
      const score = Math.hypot(east - centerEast, north - centerNorth) - road.width * 0.4;
      if (!best || score < best.score) {
        const heading = (Math.atan2(a[0] - east, a[1] - north) * 180 / Math.PI + 360) % 360;
        const dx = b[0] - a[0];
        const dz = b[1] - a[1];
        const length = Math.hypot(dx, dz) || 1;
        best = { score, spawn: { east, north, heading }, alongEast: dx / length, alongNorth: dz / length };
      }
    }
    if (best) {
      if (slot <= 0) return best.spawn;
      const spawns = [best.spawn];
      for (let step = 1; step <= 12 && spawns.length <= slot; step += 1) {
        for (const side of [1, -1]) {
          const east = best.spawn.east + best.alongEast * step * 4 * side;
          const north = best.spawn.north + best.alongNorth * step * 4 * side;
          if (!this.insideArena(east, north, arena, 2) || this.blocked(east, north, 0.8)) continue;
          if (spawns.some((spawn) => Math.hypot(spawn.east - east, spawn.north - north) < 3)) continue;
          spawns.push({ east, north, heading: best.spawn.heading });
          if (spawns.length > slot) return spawns[slot];
        }
      }
      return spawns[slot % spawns.length];
    }
    for (let radius = 0; radius < arena.sizeMeters / 2; radius += 5) {
      for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 8) {
        const east = centerEast + radius * Math.sin(angle);
        const north = centerNorth + radius * Math.cos(angle);
        if (this.insideArena(east, north, arena, 2) && !this.blocked(east, north, 2)) return { east, north, heading: 0 };
      }
    }
    throw new Error("No safe spawn point in the selected arena");
  }
}
