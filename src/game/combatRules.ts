import { type Arena, type ArenaData, terrainHeight, toLocal } from "../world/arena";
import { CollisionWorld } from "../world/collision";
import { type PlayerPose } from "./playerController";
import { type ShotRay } from "../world/physics";

export type ShotClear = (ray: ShotRay) => boolean;

export type WeaponKind = "knife" | "pistol" | "rifle";

export interface WeaponDefinition {
  label: string;
  damage: number;
  range: number;
  cooldownMs: number;
  magazine: number;
  reloadMs: number;
}

export const WEAPONS: Record<WeaponKind, WeaponDefinition> = {
  knife: { label: "Field knife", damage: 35, range: 2.7, cooldownMs: 620, magazine: 0, reloadMs: 0 },
  pistol: { label: "9 mm pistol", damage: 25, range: 55, cooldownMs: 330, magazine: 12, reloadMs: 1200 },
  rifle: { label: "Carbine", damage: 18, range: 95, cooldownMs: 135, magazine: 30, reloadMs: 1700 },
};

export interface WeaponPickup {
  id: string;
  weapon: Exclude<WeaponKind, "knife">;
  east: number;
  north: number;
}

export function makeWeaponPickups(data: ArenaData, arena: Arena): WeaponPickup[] {
  const collision = new CollisionWorld(data);
  const origin = collision.findSpawn(arena);
  const [centerEast, centerNorth] = toLocal(arena.latitude, arena.longitude);
  const roads = data.roads.filter((road) => road.width >= 8).map((road) => ({
    east: (road.points[0][0] + road.points[1][0]) / 2,
    north: (road.points[0][1] + road.points[1][1]) / 2,
  })).filter(({ east, north }) => collision.insideArena(east, north, arena, 3) && !collision.blocked(east, north, 1));
  const pickups: WeaponPickup[] = [{ id: "pistol-near", weapon: "pistol", ...collision.findSpawn(arena, 4) }];
  const targets = [
    { id: "rifle-east", weapon: "rifle" as const, radius: 46 },
    { id: "pistol-far", weapon: "pistol" as const, radius: 72 },
    { id: "rifle-far", weapon: "rifle" as const, radius: 96 },
  ];
  for (const target of targets) {
    const best = roads.filter((point) => pickups.every((pickup) => Math.hypot(point.east - pickup.east, point.north - pickup.north) >= 18))
      .sort((a, b) => Math.abs(Math.hypot(a.east - centerEast, a.north - centerNorth) - target.radius)
        - Math.abs(Math.hypot(b.east - centerEast, b.north - centerNorth) - target.radius))[0];
    if (best) pickups.push({ id: target.id, weapon: target.weapon, ...best });
  }
  // Keep the first pickup within a short walk of either spawn side.
  if (Math.hypot(pickups[0].east - origin.east, pickups[0].north - origin.north) < 3) {
    pickups[0] = { id: "pistol-near", weapon: "pistol", ...collision.findSpawn(arena, 6) };
  }
  return pickups;
}

function visibleBetween(collision: CollisionWorld, from: PlayerPose, target: PlayerPose, distance: number, fromY: number, targetY: number): boolean {
  for (let step = 0.9; step < distance - 0.6; step += 0.65) {
    const t = step / distance;
    const east = from.east + (target.east - from.east) * t;
    const north = from.north + (target.north - from.north) * t;
    const height = fromY + (targetY - fromY) * t;
    if (collision.blocksShot(east, north, height, 0.08)) return false;
  }
  return true;
}

export function hitDistance(data: ArenaData, collision: CollisionWorld, attacker: PlayerPose, target: PlayerPose, weapon: WeaponKind, shotClear?: ShotClear): number | null {
  const definition = WEAPONS[weapon];
  const horizontal = Math.hypot(target.east - attacker.east, target.north - attacker.north);
  if (horizontal > definition.range + 0.7 || horizontal < 0.2) return null;
  const heading = attacker.heading * Math.PI / 180;
  const pitch = attacker.pitch * Math.PI / 180;
  const dx = Math.sin(heading) * Math.cos(pitch);
  const dy = Math.sin(pitch);
  const dz = Math.cos(heading) * Math.cos(pitch);
  const eyeY = terrainHeight(data, attacker.east, attacker.north) + (attacker.crouching ? 1.12 : 1.72) + attacker.jumpHeight;
  const targetY = terrainHeight(data, target.east, target.north) + (target.crouching ? 0.7 : 1.1) + target.jumpHeight;
  const vx = target.east - attacker.east;
  const vy = targetY - eyeY;
  const vz = target.north - attacker.north;
  const along = vx * dx + vy * dy + vz * dz;
  if (along <= 0 || along > definition.range) return null;
  const miss = Math.hypot(vx - dx * along, vy - dy * along, vz - dz * along);
  if (miss > (weapon === "knife" ? 0.8 : 0.62)) return null;
  if (shotClear) {
    if (!shotClear({ origin: { x: attacker.east, y: eyeY, z: attacker.north },
      direction: { x: dx, y: dy, z: dz }, distance: Math.max(0, along - 0.28) })) return null;
  } else if (!visibleBetween(collision, attacker, target, horizontal, eyeY, targetY)) return null;
  return along;
}
