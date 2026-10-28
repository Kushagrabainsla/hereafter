import { toLocal, type Arena, type ArenaData, type Point } from "./arena";

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

  constructor(private data: ArenaData) {
    this.buildings = data.buildings.map(({ outline }) => ({
      outline,
      minEast: Math.min(...outline.map(([east]) => east)),
      maxEast: Math.max(...outline.map(([east]) => east)),
      minNorth: Math.min(...outline.map(([, north]) => north)),
      maxNorth: Math.max(...outline.map(([, north]) => north)),
    }));
  }

  blocked(east: number, north: number, radius: number): boolean {
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

  insideArena(east: number, north: number, arena: Arena, radius = 0): boolean {
    const [centerEast, centerNorth] = toLocal(arena.latitude, arena.longitude);
    const half = arena.sizeMeters / 2 - radius;
    return Math.abs(east - centerEast) <= half && Math.abs(north - centerNorth) <= half;
  }

  findSpawn(arena: Arena): SpawnPoint {
    const [centerEast, centerNorth] = toLocal(arena.latitude, arena.longitude);
    const broadRoads = this.data.roads.filter((road) => road.width >= 8);
    const candidates = broadRoads.length ? broadRoads : this.data.roads;
    let best: { score: number; spawn: SpawnPoint } | null = null;
    for (const road of candidates) {
      const [a, b] = road.points;
      const east = (a[0] + b[0]) / 2;
      const north = (a[1] + b[1]) / 2;
      if (!this.insideArena(east, north, arena, 2) || this.blocked(east, north, 2)) continue;
      const score = Math.hypot(east - centerEast, north - centerNorth) - road.width * 0.4;
      if (!best || score < best.score) {
        const heading = (Math.atan2(a[0] - east, a[1] - north) * 180 / Math.PI + 360) % 360;
        best = { score, spawn: { east, north, heading } };
      }
    }
    if (best) return best.spawn;
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
