import { type ArenaData, terrainHeight } from "../world/arena";
import { type PlayerPose } from "./playerController";
import { type ShotRay } from "../world/physics";

export type ShotClear = (ray: ShotRay) => boolean;

export type WeaponKind = "knife" | "pistol" | "rifle";
export type GunKind = Exclude<WeaponKind, "knife">;

export interface WeaponDefinition {
  label: string;
  damage: number;
  range: number;
  cooldownMs: number;
  magazine: number;
  reloadMs: number;
}

export const WEAPONS: Record<WeaponKind, WeaponDefinition> = {
  knife: { label: "Field knife", damage: 30, range: 2, cooldownMs: 520, magazine: 0, reloadMs: 0 },
  pistol: { label: "9 mm pistol", damage: 25, range: 55, cooldownMs: 330, magazine: 12, reloadMs: 1200 },
  rifle: { label: "Carbine", damage: 18, range: 95, cooldownMs: 135, magazine: 30, reloadMs: 1700 },
};

export const MAGAZINE_LABEL: Record<GunKind, string> = { pistol: "9 mm magazine", rifle: "carbine magazine" };
// Spare magazines a player can carry of each kind, and how many a magazine pickup holds.
export const MAX_SPARE_MAGAZINES = 6;
export const MAGAZINES_PER_PICKUP = 2;

// The knife has two strokes. A slash sweeps the blade across the body from upper right to
// lower left and stops at the first thing it meets; a stab draws back and drives straight
// in with a short lunge, reaching further and cutting deeper. A stab in the back is fatal.
// The blade lands contactMs after the click, when the swing reaches the target; recoveryMs
// is how long until the next stroke can start.
export type KnifeStroke = "slash" | "stab";
export interface KnifeStrokeRules { reach: number; arc: number; drop: number; damage: Record<HitZone, number>; contactMs: number; recoveryMs: number; impulse: number }
export const KNIFE: Record<KnifeStroke, KnifeStrokeRules> = {
  slash: { reach: 1.7, arc: 70, drop: 22, damage: { head: 45, torso: 30, legs: 22 }, contactMs: 130, recoveryMs: 520, impulse: 3 },
  stab: { reach: 2.05, arc: 4, drop: 0, damage: { head: 100, torso: 55, legs: 35 }, contactMs: 240, recoveryMs: 900, impulse: 6 },
};
export const BACKSTAB_DAMAGE = 100;

// Real masses in kilograms: the guns empty, an empty magazine, one cartridge, and the kit
// every player carries (knife and grenades). Rifle figures are an AKM with steel magazines.
export const MASS = {
  knife: 0.25,
  grenade: 0.4,
  pistol: { gun: 0.72, magazine: 0.07, round: 0.012 },
  rifle: { gun: 3.1, magazine: 0.33, round: 0.0163 },
} as const;

export interface Loadout { owned: WeaponKind[]; ammo: Record<GunKind, number>; mags: Record<GunKind, number[]>; grenades: number }

// Everything a player carries: guns with the magazine in them, spare magazines and rounds.
export function carriedMass(player: Loadout): number {
  let mass = MASS.knife + player.grenades * MASS.grenade;
  for (const gun of ["pistol", "rifle"] as const) {
    const m = MASS[gun];
    if (player.owned.includes(gun)) mass += m.gun + m.magazine + player.ammo[gun] * m.round;
    for (const rounds of player.mags[gun]) mass += m.magazine + rounds * m.round;
  }
  return mass;
}

// What a load does to movement. Walking loses 1.2% of its speed per kilogram beyond the
// basic kit and sprinting 1.8%, to at most a fifth. The same legs launch more mass, so a
// jump starts slower, and a heavier body takes longer to get going and to stop.
export const BODY_MASS = 78;
const BASE_LOAD = MASS.knife + 2 * MASS.grenade;
export function loadEffects(mass: number): { walk: number; sprint: number; jump: number; inertia: number } {
  const extra = Math.max(0, mass - BASE_LOAD);
  return {
    walk: Math.max(0.8, 1 - 0.012 * extra),
    sprint: Math.max(0.8, 1 - 0.018 * extra),
    jump: Math.sqrt((BODY_MASS + BASE_LOAD) / (BODY_MASS + Math.max(mass, BASE_LOAD))),
    inertia: (BODY_MASS + Math.max(mass, BASE_LOAD)) / (BODY_MASS + BASE_LOAD),
  };
}

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

// A gun lying ready to take, or spare magazines for one. y is the height of the surface
// the item rests on, for the ones on tables, the fire escape and the bar's upper floor.
export interface WeaponPickup {
  id: string;
  weapon: GunKind;
  item: "gun" | "magazines";
  east: number;
  north: number;
  y: number;
}

export function makeWeaponPickups(data: ArenaData): WeaponPickup[] {
  return data.layout.pickups.map((pickup) => ({ item: "gun", y: 0, ...pickup }));
}

// How far a player can reach to pick something up: across, and up or down.
export const PICKUP_REACH = 2.3;
export const PICKUP_HEIGHT = 1.5;

export type HitZone = "head" | "torso" | "legs";
export interface TargetHit { distance: number; zone: HitZone; }

// How far a full lean moves the eyes sideways, and the head and chest with them.
export const LEAN_OFFSET = 0.32;

export function shotRay(data: ArenaData, pose: PlayerPose, weapon: WeaponKind, distance = WEAPONS[weapon].range): ShotRay {
  const yaw = pose.heading * Math.PI / 180, pitch = pose.pitch * Math.PI / 180, lean = pose.lean ?? 0;
  // Screen right for heading h is (-cos h, sin h) in east/north.
  return { origin: { x: pose.east - Math.cos(yaw) * lean * LEAN_OFFSET, y: terrainHeight(data, pose.east, pose.north) + (pose.crouching ? 1.12 : 1.72) + pose.jumpHeight - Math.abs(lean) * 0.04, z: pose.north + Math.sin(yaw) * lean * LEAN_OFFSET },
    direction: { x: Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: Math.cos(yaw) * Math.cos(pitch) }, distance };
}

// Oriented anatomical volumes follow the avatar's heading, crouch scale and jump.
export function targetHit(data: ArenaData, attacker: PlayerPose, target: PlayerPose, weapon: WeaponKind, distance?: number): TargetHit | null {
  const ray = shotRay(data, attacker, weapon, distance);
  const yaw = target.heading * Math.PI / 180, c = Math.cos(yaw), s = Math.sin(yaw);
  const x = ray.origin.x - target.east, z = ray.origin.z - target.north;
  const origin = [c*x-s*z, ray.origin.y-terrainHeight(data,target.east,target.north)-target.jumpHeight, s*x+c*z];
  const direction = [c*ray.direction.x-s*ray.direction.z, ray.direction.y, s*ray.direction.x+c*ray.direction.z];
  const scale = target.crouching ? 0.72 : 1;
  // A leaning target's head and chest move toward its right, which is local -x here.
  const lean = target.lean ?? 0;
  const zones: [HitZone, number, number, number, number, number][] = [["head", 1.45, 1.98, 0.205, 0.205, LEAN_OFFSET], ["torso", 0.73, 1.45, 0.29, 0.24, LEAN_OFFSET * 0.5], ["legs", 0.02, 0.73, 0.24, 0.19, 0]];
  let closest: TargetHit | null = null;
  for (const [zone, low, high, width, depth, shift] of zones) {
    // The blade is a few centimetres wide and the arm swings it, so it catches a little
    // more than a bullet's line would.
    const padding = weapon === "knife" ? 0.06 : 0;
    const offset = -lean * shift;
    const min = [offset-width-padding, low*scale-padding, -depth-padding];
    const max = [offset+width+padding, high*scale+padding, depth+padding];
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

// A stroke lands from behind when the attacker stands in the half-space behind the target,
// more than 60 degrees off its facing.
export function fromBehind(attacker: { east: number; north: number }, target: PlayerPose): boolean {
  const yaw = target.heading * Math.PI / 180, dx = attacker.east - target.east, dz = attacker.north - target.north, length = Math.hypot(dx, dz);
  return length > 0.01 && (Math.sin(yaw) * dx + Math.cos(yaw) * dz) / length < -0.5;
}

export function knifeDamage(stroke: KnifeStroke, zone: HitZone, behind: boolean): number {
  if (behind && stroke === "stab") return BACKSTAB_DAMAGE;
  return Math.round(KNIFE[stroke].damage[zone] * (behind ? 1.25 : 1));
}

export function damageAt(weapon: WeaponKind, hit: TargetHit): number {
  if (weapon === "knife") return KNIFE.slash.damage[hit.zone];
  const falloffStart = weapon === "pistol" ? 15 : 35;
  const falloff = 1 - 0.45 * Math.max(0, Math.min(1, (hit.distance-falloffStart)/(WEAPONS[weapon].range-falloffStart)));
  return Math.round(WEAPONS[weapon].damage * falloff * (hit.zone === "head" ? 2.5 : hit.zone === "legs" ? 0.7 : 1));
}

