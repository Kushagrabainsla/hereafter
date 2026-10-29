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

// Hip-fire spread, as the half-angle of the cone in degrees. Moving, jumping and sliding
// widen it, crouching steadies it, and sustained fire blooms it until the trigger rests.
export interface AimState { moving: boolean; crouching: boolean; airborne: boolean; sliding: boolean }

const SPREAD: Record<Exclude<WeaponKind, "knife">, { base: number; moving: number; airborne: number; sliding: number; crouched: number; bloom: number; bloomMax: number; recovery: number }> = {
  pistol: { base: 0.3, moving: 2.2, airborne: 5, sliding: 3, crouched: 0.6, bloom: 0.35, bloomMax: 1.2, recovery: 3.5 },
  rifle: { base: 0.4, moving: 2.6, airborne: 5, sliding: 3, crouched: 0.6, bloom: 0.2, bloomMax: 1.6, recovery: 2.8 },
};
const BLOOM_HOLD = 0.12;

export function spreadDegrees(weapon: WeaponKind, state: AimState, bloom: number): number {
  if (weapon === "knife") return 0;
  const s = SPREAD[weapon];
  const factor = state.airborne ? s.airborne : state.sliding ? s.sliding : state.moving ? s.moving * (state.crouching ? 0.6 : 1) : state.crouching ? s.crouched : 1;
  return s.base * factor + bloom;
}

// Bloom left from earlier shots once the trigger has rested for this many seconds.
export function currentBloom(weapon: WeaponKind, bloom: number, secondsSinceShot: number): number {
  if (weapon === "knife") return 0;
  return Math.max(0, bloom - Math.max(0, secondsSinceShot - BLOOM_HOLD) * SPREAD[weapon].recovery);
}

export function bloomAfterShot(weapon: WeaponKind, bloom: number, secondsSinceShot: number): number {
  if (weapon === "knife") return 0;
  return Math.min(SPREAD[weapon].bloomMax, currentBloom(weapon, bloom, secondsSinceShot) + SPREAD[weapon].bloom);
}

// Turn an aim by a random direction within the spread cone, uniform over its area.
export function deviateAim(aim: { heading: number; pitch: number }, spread: number, random = Math.random): { heading: number; pitch: number } {
  if (spread <= 0) return aim;
  const radius = spread * Math.sqrt(random()), angle = random() * Math.PI * 2;
  const pitch = Math.max(-80, Math.min(80, aim.pitch + radius * Math.sin(angle)));
  const heading = (aim.heading + radius * Math.cos(angle) / Math.max(0.2, Math.cos(aim.pitch * Math.PI / 180)) + 360) % 360;
  return { heading, pitch };
}

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

export type HitZone = "head" | "torso" | "legs";
export interface TargetHit { distance: number; zone: HitZone; }

export function shotRay(data: ArenaData, pose: PlayerPose, weapon: WeaponKind): ShotRay {
  const yaw = pose.heading * Math.PI / 180, pitch = pose.pitch * Math.PI / 180;
  return { origin: { x: pose.east, y: terrainHeight(data, pose.east, pose.north) + (pose.crouching ? 1.12 : 1.72) + pose.jumpHeight, z: pose.north },
    direction: { x: Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: Math.cos(yaw) * Math.cos(pitch) }, distance: WEAPONS[weapon].range };
}

// Oriented anatomical volumes follow the avatar's heading, crouch scale and jump.
export function targetHit(data: ArenaData, attacker: PlayerPose, target: PlayerPose, weapon: WeaponKind): TargetHit | null {
  const ray = shotRay(data, attacker, weapon);
  const yaw = target.heading * Math.PI / 180, c = Math.cos(yaw), s = Math.sin(yaw);
  const x = ray.origin.x - target.east, z = ray.origin.z - target.north;
  const origin = [c*x-s*z, ray.origin.y-terrainHeight(data,target.east,target.north)-target.jumpHeight, s*x+c*z];
  const direction = [c*ray.direction.x-s*ray.direction.z, ray.direction.y, s*ray.direction.x+c*ray.direction.z];
  const scale = target.crouching ? 0.72 : 1;
  const zones: [HitZone, number, number, number, number][] = [["head", 1.45, 1.98, 0.205, 0.205], ["torso", 0.73, 1.45, 0.29, 0.24], ["legs", 0.02, 0.73, 0.24, 0.19]];
  let closest: TargetHit | null = null;
  for (const [zone, low, high, width, depth] of zones) {
    const padding = weapon === "knife" ? 0.18 : 0;
    const min = [-width-padding, low*scale-padding, -depth-padding];
    const max = [width+padding, high*scale+padding, depth+padding];
    let near = 0, far = ray.distance;
    for (let axis = 0; axis < 3; axis++) {
      if (Math.abs(direction[axis]) < 1e-8) {
        if (origin[axis] < min[axis] || origin[axis] > max[axis]) { far = -1; break; }
      } else {
        const a = (min[axis]-origin[axis])/direction[axis], b = (max[axis]-origin[axis])/direction[axis];
        near = Math.max(near, Math.min(a,b)); far = Math.min(far, Math.max(a,b));
      }
    }
    if (near <= far && far >= 0 && (!closest || near < closest.distance)) closest = { distance: near, zone };
  }
  return closest;
}

export function damageAt(weapon: WeaponKind, hit: TargetHit): number {
  if (weapon === "knife") return WEAPONS.knife.damage;
  const falloffStart = weapon === "pistol" ? 15 : 35;
  const falloff = 1 - 0.45 * Math.max(0, Math.min(1, (hit.distance-falloffStart)/(WEAPONS[weapon].range-falloffStart)));
  return Math.round(WEAPONS[weapon].damage * falloff * (hit.zone === "head" ? 2.5 : hit.zone === "legs" ? 0.7 : 1));
}

export function hitDistance(data: ArenaData, collision: CollisionWorld, attacker: PlayerPose, target: PlayerPose, weapon: WeaponKind, shotClear?: ShotClear): number | null {
  const hit = targetHit(data, attacker, target, weapon);
  if (!hit) return null;
  const ray = shotRay(data, attacker, weapon);
  if (shotClear ? !shotClear({ ...ray, distance: hit.distance }) : !visibleBetween(collision, attacker, target, hit.distance, ray.origin.y, terrainHeight(data,target.east,target.north)+1)) return null;
  return hit.distance;
}
