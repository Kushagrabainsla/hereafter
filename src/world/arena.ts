import { type Material } from "./materials";

// The playable square, centred on the map's origin.
export interface Arena {
  sizeMeters: number;
}

export type Point = [east: number, north: number];

// The map: a ground height grid (flat for the night market) and its layout.
export interface ArenaData {
  extentMeters: number;
  elevation: { gridSize: number; meters: number[]; baseMeters: number };
  layout: MapLayout;
}

// A solid box in the map: walls, floors, counters, stairs and railings. Railings use
// the "boundary" material, which blocks players but not bullets. `look` names how it is drawn.
export interface LayoutBox {
  half: [number, number, number];
  center: { x: number; y: number; z: number };
  rotation?: { x: number; y: number; z: number; w: number };
  material: Material;
  look: string;
}

// What every client must agree on for a map: where players start, where weapons
// lie and what is solid. How it looks is built from the same definition (see nightMarket.ts).
export interface MapLayout {
  id: string;
  name: string;
  spawns: { east: number; north: number; heading: number }[];
  pickups: { id: string; weapon: "pistol" | "rifle"; east: number; north: number }[];
  solids: LayoutBox[];
}

export function terrainHeight(data: ArenaData, east: number, north: number): number {
  const { extentMeters: extent, elevation } = data;
  const size = elevation.gridSize;
  const column = (Math.max(-extent, Math.min(extent, east)) + extent) / (extent * 2) * (size - 1);
  const row = (Math.max(-extent, Math.min(extent, north)) + extent) / (extent * 2) * (size - 1);
  const x0 = Math.floor(column);
  const z0 = Math.floor(row);
  const x1 = Math.min(size - 1, x0 + 1);
  const z1 = Math.min(size - 1, z0 + 1);
  const tx = column - x0;
  const tz = row - z0;
  const sample = (x: number, z: number): number => elevation.meters[z * size + x];
  const south = sample(x0, z0) * (1 - tx) + sample(x1, z0) * tx;
  const northValue = sample(x0, z1) * (1 - tx) + sample(x1, z1) * tx;
  return south * (1 - tz) + northValue * tz - elevation.baseMeters;
}
