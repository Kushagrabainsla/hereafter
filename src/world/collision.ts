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

// After a fall: the map's spawn whose nearest living enemy is farthest away, so a player does not
// come back in front of the one who just took them down. With no enemies, the first spawn.
export function safestSpawn(data: ArenaData, enemies: { east: number; north: number }[]): SpawnPoint {
  const spawns = data.layout.spawns;
  if (!enemies.length) return { ...spawns[0] };
  const nearest = (spawn: SpawnPoint): number => Math.min(...enemies.map((enemy) => Math.hypot(enemy.east - spawn.east, enemy.north - spawn.north)));
  return { ...spawns.reduce((best, spawn) => (nearest(spawn) > nearest(best) ? spawn : best)) };
}
