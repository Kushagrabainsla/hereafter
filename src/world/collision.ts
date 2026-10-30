import { type ArenaData } from "./arena";

export interface SpawnPoint {
  east: number;
  north: number;
  heading: number;
}

// Each room member starts at the map's spawn for their slot; slots wrap around the list.
export function spawnPoint(data: ArenaData, slot = 0): SpawnPoint {
  const spawns = data.layout.spawns;
  return { ...spawns[Math.max(0, slot) % spawns.length] };
}
