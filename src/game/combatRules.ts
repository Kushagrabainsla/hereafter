import { type ArenaData, type FoodKind, terrainHeight } from "../world/arena";
import { type PlayerPose } from "./playerController";
import { type ShotRay } from "../world/physics";
import { type Material } from "../world/materials";

export type ShotClear = (ray: ShotRay) => boolean;

export type WeaponKind = "knife" | "pistol" | "rifle";
export type GunKind = Exclude<WeaponKind, "knife">;
export type { FoodKind };

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
  // A canister smoke grenade, like the M18.
  smoke: 0.54,
  pistol: { gun: 0.72, magazine: 0.07, round: 0.012 },
  rifle: { gun: 3.1, magazine: 0.33, round: 0.0163 },
} as const;

export interface Loadout { owned: WeaponKind[]; ammo: Record<GunKind, number>; mags: Record<GunKind, number[]>; grenades: number; smokes?: number }

// Everything a player carries: guns with the magazine in them, spare magazines and rounds.
export function carriedMass(player: Loadout): number {
  let mass = MASS.knife + player.grenades * MASS.grenade + (player.smokes ?? 0) * MASS.smoke;
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
const BASE_LOAD = MASS.knife + 2 * MASS.grenade + 2 * MASS.smoke;
export function loadEffects(mass: number): { walk: number; sprint: number; jump: number; inertia: number } {
  const extra = Math.max(0, mass - BASE_LOAD);
  return {
    walk: Math.max(0.8, 1 - 0.012 * extra),
    sprint: Math.max(0.8, 1 - 0.018 * extra),
    jump: Math.sqrt((BODY_MASS + BASE_LOAD) / (BODY_MASS + Math.max(mass, BASE_LOAD))),
    inertia: (BODY_MASS + Math.max(mass, BASE_LOAD)) / (BODY_MASS + BASE_LOAD),
  };
}

// Lifting and throwing loose objects: both hands, from within reach of the eyes, up to what a
// player can walk with. Heavier things can only be pushed.
export const CARRY_REACH = 2.2;
export const MAX_CARRY = 25;
export const THROW_CHARGE_MS = 700;
// A throw is a fixed amount of work shared between the object and the arm moving with it, so
// the lightest things are limited by how fast an arm can go and heavy ones barely leave the
// hands: about 15 m/s for a stool, 10 for a chair and 6 for a loaded crate at full effort.
const THROW_WORK = 340;
const ARM_MASS = 2;
export function throwSpeed(mass: number, charge: number): number {
  return Math.sqrt(2 * THROW_WORK * (0.25 + 0.75 * Math.max(0, Math.min(1, charge))) / (mass + ARM_MASS));
}
// What a load in both hands does to the feet, on top of its weight (loadEffects): a slower walk,
// and no sprinting with anything really heavy.
export const carrySpeed = (mass: number): number => Math.max(0.45, 1 - 0.022 * mass);
export const CARRY_SPRINT_LIMIT = 10;

// A flying object hurts by the energy it brings and how hard it is: a thrown chair lands about
// like a pistol round to the chest, a plastic stool barely stings, and a crate dropped from
// the bar's upper floor onto someone's head can kill.
export const STRIKE_SPEED = 3.5;
const HARDNESS: Partial<Record<Material, number>> = { cardboard: 0.15, plastic: 0.35, "metal-thin": 0.9, "metal-solid": 1.3 };
const STRIKE_ZONE: Record<HitZone, number> = { head: 1.6, torso: 1, legs: 0.6 };
export function strikeDamage(mass: number, speed: number, material: Material, zone: HitZone): number {
  return Math.min(100, Math.round(Math.max(0, 0.5 * mass * speed * speed * (HARDNESS[material] ?? 1) - 15) * 0.14 * STRIKE_ZONE[zone]));
}
// How much the same blow knocks a body aside, in m/s: its share of the momentum, made larger
// because a blow lands high on someone balanced on two feet.
export function strikeKnock(mass: number, speed: number): number { return 3 * mass * speed / (mass + BODY_MASS); }

// A stop hurts the object itself by how fast it stopped, not by its weight, since heavy things
// are built to be: a share of its strength per J/kg above what a drop from the hands costs. A
// chair thrown at a wall is half gone, cardboard bursts, and plastic takes a lot of it.
const SAFE_STOP = 20;
const TOUGHNESS: Partial<Record<Material, number>> = { cardboard: 25, wood: 70, plastic: 300, "metal-thin": 400, "metal-solid": 2000 };
export function smashShare(speed: number, material: Material): number {
  return Math.max(0, 0.5 * speed * speed - SAFE_STOP) / (TOUGHNESS[material] ?? 200);
}

// Fire. Things warm up until they catch, by how close they are to something burning; wood takes
// more heat than plastic and plastic more than cardboard. A burning thing wears down over a time
// set by its weight, and a fuel drum or gas tank that gets hot enough goes off. Worked out twice
// a second by the coordinator.
export const FIRE_STEP_MS = 500;
export const MAX_FIRES = 24;
export const FIRE_HEAT = 40;
export const FIRE_REACH = 1.2;
export const FIRE_DAMAGE = 5;
export const EXPLOSIVE_CATCHES = 60;
export const FRAG_HEAT = 60;
export const FUEL_HEAT = 170;
// Burning fuel spreads this far from a burst drum or tank and burns for this long.
export const POOL_RADIUS = 2.2;
export const POOL_MS = 14_000;
// What a blast tears apart while it is burning leaves scraps alight where it stood, for a while.
export const SCRAPS_RADIUS = 0.7;
export const SCRAPS_MS = 9000;
// A frag only sets light to cardboard, and only this close: the share of its blast at that range.
export const FRAG_LIGHTS = 0.55;
// How far a burst extinguisher's powder puts out flames.
export const DOUSE_RADIUS = 4.5;
const BURNS: Partial<Record<Material, { catches: number; pace: number }>> = { cardboard: { catches: 30, pace: 0.5 }, plastic: { catches: 70, pace: 0.8 }, wood: { catches: 100, pace: 1 } };
export const catchesAt = (material: Material): number | undefined => BURNS[material]?.catches;
// How long something takes to burn away; a stall or door has no mass of its own and takes longest.
export const burnSeconds = (material: Material, mass = 25): number => Math.max(8, Math.min(60, (10 + 2 * mass) * (BURNS[material]?.pace ?? 1)));

// A fire extinguisher off the wall: both hands, ten seconds of powder that puts out what it
// reaches, a few metres off in a widening cone. It goes back on the wall in time.
export const POWDER_SECONDS = 10;
export const TOOL_MASS = 4.5;
export const SPRAY_MS = 250;
export const SPRAY_REACH = 5.5;
export const EXTINGUISHER_RETURN_MS = 45_000;

// Hip-fire spread, as the half-angle of the cone in degrees. Moving, jumping and sliding
// widen it, crouching steadies it, and sustained fire blooms it until the trigger rests.
// Aiming down the sights halves it.
export interface AimState { moving: boolean; crouching: boolean; airborne: boolean; sliding: boolean; aiming?: boolean }
export const AIM_SPREAD = 0.5;

const SPREAD: Record<Exclude<WeaponKind, "knife">, { base: number; moving: number; airborne: number; sliding: number; crouched: number; bloom: number; bloomMax: number; recovery: number }> = {
  pistol: { base: 0.3, moving: 2.2, airborne: 5, sliding: 3, crouched: 0.6, bloom: 0.35, bloomMax: 1.2, recovery: 3.5 },
  rifle: { base: 0.4, moving: 2.6, airborne: 5, sliding: 3, crouched: 0.6, bloom: 0.2, bloomMax: 1.6, recovery: 2.8 },
};
const BLOOM_HOLD = 0.12;

export function spreadDegrees(weapon: WeaponKind, state: AimState, bloom: number): number {
  if (weapon === "knife") return 0;
  const s = SPREAD[weapon];
  const factor = state.airborne ? s.airborne : state.sliding ? s.sliding : state.moving ? s.moving * (state.crouching ? 0.6 : 1) : state.crouching ? s.crouched : 1;
  return (s.base * factor + bloom) * (state.aiming ? AIM_SPREAD : 1);
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

// A gun lying ready to take, spare magazines for one, or food on a shop's counter. y is the
// height of the surface the item rests on, for the ones on tables, counters, the fire escape
// and the bar's upper floor.
interface PickupSpot { id: string; east: number; north: number; y: number }
export type WeaponPickup = PickupSpot & ({ item: "gun" | "magazines"; weapon: GunKind } | { item: "food"; food: FoodKind } | { item: "extinguisher" });

export function makeWeaponPickups(data: ArenaData): WeaponPickup[] {
  return data.layout.pickups.map((pickup) => ({ item: "gun", y: 0, ...pickup }) as WeaponPickup);
}

// What the shops serve. Food comes back on the counter after a while and goes back on it at
// the start of a round. Eating or drinking keeps the hands busy for a moment.
export const FULL_HEALTH = 100;
export const FOOD_RETURN_MS = 40_000;
export const EAT_MS = 1000;
// How much faster a sugar rush moves a player. Sprinting while boosted stays within the 10 m/s
// other peers accept (peerRoom.ts).
export const RUSH_SPEED = 1.15;
export const FOOD_KINDS: FoodKind[] = ["dumplings", "pho", "boba"];
export const FOOD: Record<FoodKind, { verb: string; name: string; heal: number; rushSeconds: number }> = {
  dumplings: { verb: "eat", name: "the dumplings", heal: 40, rushSeconds: 0 },
  pho: { verb: "eat", name: "the pho", heal: 40, rushSeconds: 0 },
  boba: { verb: "drink", name: "the boba", heal: 0, rushSeconds: 12 },
};

// How far a player can reach to pick something up: across, and up or down.
export const PICKUP_REACH = 2.3;
export const PICKUP_HEIGHT = 1.5;

export type HitZone = "head" | "torso" | "legs";
// arm marks a hit on the torso's outer edge, where the arms hang.
export interface TargetHit { distance: number; zone: HitZone; arm?: boolean }

// Wounds last until the player bandages them or dies. A leg or arm wound grows with the damage
// that caused it, from 0 to 1: this much damage is a full one.
export const LEG_WOUND_DAMAGE = 40;
export const ARM_WOUND_DAMAGE = 50;
const ARM_EDGE = 0.2;
// A cut or a round that does this much opens a wound, and every further one bleeds for longer:
// a point of health at each drip, up to about 20 points in all.
export const BLEED_MIN_DAMAGE = 15;
export const BLEED_PER_WOUND_MS = 9000;
export const BLEED_LONGEST_MS = 24_000;
export const BLEED_DRIP_MS = 1200;
export const BANDAGES_PER_LIFE = 2;
export const BANDAGE_MS = 2500;
// What a bad leg does: a slower walk and sprint, a lower jump, and past this no sprint at all.
export const NO_SPRINT_LEG = 0.6;
export const legEffects = (leg: number): { walk: number; sprint: number; jump: number } => ({ walk: 1 - 0.4 * leg, sprint: 1 - 0.5 * leg, jump: 1 - 0.3 * leg });
// What a bad arm does: a wider spread, a slower reload, a weaker throw and less it can lift.
export const armSpread = (arm: number): number => 1 + 1.5 * arm;
export const armThrow = (arm: number): number => 1 - 0.3 * arm;
export const armCarry = (arm: number): number => MAX_CARRY * (1 - 0.5 * arm);
export const reloadTime = (weapon: WeaponKind, arm: number): number => Math.round(WEAPONS[weapon].reloadMs * (1 + 0.5 * arm));

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
    if (near <= far && far >= 0 && (!closest || near < closest.distance)) closest = { distance: near, zone, arm: zone === "torso" && Math.abs(origin[0] + direction[0] * near - offset) > ARM_EDGE };
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

