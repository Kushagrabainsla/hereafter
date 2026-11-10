import { type ArenaData, terrainHeight } from "../world/arena";
import {
  targetHit, damageAt, shotRay, makeWeaponPickups, bloomAfterShot, currentBloom, deviateAim, spreadDegrees, carriedMass, fromBehind, knifeDamage, loadEffects, smashShare, strikeDamage, strikeKnock, armSpread, reloadTime, burnSeconds, catchesAt, EXTINGUISHER_RETURN_MS, POWDER_SECONDS, SPRAY_MS, SPRAY_REACH, BURN_DAMAGE, BURN_MS,
  DOUSE_RADIUS, EXPLOSIVE_CATCHES, FIRE_DAMAGE, FIRE_HEAT, FIRE_REACH, FIRE_STEP_MS, FRAG_HEAT, FRAG_LIGHTS, FUEL_HEAT, MAX_FIRES, POOL_MS, POOL_RADIUS, SCRAPS_MS, SCRAPS_RADIUS,
  ARM_WOUND_DAMAGE, BANDAGE_MS, BANDAGES_PER_LIFE, BLEED_DRIP_MS, BLEED_LONGEST_MS, BLEED_MIN_DAMAGE, BLEED_PER_WOUND_MS, LEG_WOUND_DAMAGE,
  EAT_MS, FOOD, FOOD_KINDS, FOOD_RETURN_MS, FULL_HEALTH, KNIFE, MAGAZINES_PER_PICKUP, MAX_SPARE_MAGAZINES, PICKUP_HEIGHT, PICKUP_REACH, WEAPONS,
  type FoodKind, type GunKind, type HitZone, type KnifeStroke, type WeaponKind, type WeaponPickup,
} from "./combatRules";
import { type ShotRay } from "../world/physics";
import { type PlayerPose } from "./playerController";
import { BODY_COST, MATERIALS, PENETRATION, type Material } from "../world/materials";
import { cleanName, NAME_LENGTH } from "../settings";

export interface Vec3 { x: number; y: number; z: number }

export interface CombatPlayer {
  health: number;
  owned: WeaponKind[];
  active: WeaponKind;
  // Rounds in each gun: its magazine, plus one in the chamber after a reload with rounds left.
  ammo: Record<GunKind, number>;
  // Spare magazines carried for each gun, as the rounds left in each.
  mags: Record<GunKind, number[]>;
  grenades: number;
  smokes: number;
  reloadUntil: number;
  respawnAfter: number;
  kills: number;
  deaths: number;
  // The newest intent the coordinator has handled from this player, by its number, so a new
  // coordinator never handles again one the last already did.
  intent: number;
  // What the player calls themself, as cleanName leaves it; empty until they say.
  name: string;
  // The voice they speak with: "hi" for Hindi, "en" for English, "grunts" for no words, or
  // empty until they say, heard as English.
  voice: string;
  // How bad their leg and arm wounds are, 0 to 1, and until when on the coordinator's clock they
  // bleed, 0 if they are not, and from whose hand. Bandages left this life.
  leg: number;
  arm: number;
  bleedUntil: number;
  bleedBy: string;
  bandages: number;
  // Seconds of powder in the fire extinguisher in their hands, 0 if they hold none.
  powder: number;
  // Until when on the coordinator's clock they are on fire, 0 if not, and from whose fire.
  burnUntil: number;
  burnBy: string;
}

// A room plays rounds once two players are in the game: a countdown, then a round of five
// minutes or until someone reaches the kill limit, then the scores stand for a while before the
// next round resets the market and everyone in it. A room with one player warms up.
export type RoundPhase = "warmup" | "countdown" | "live" | "over";
export interface RoundState {
  // Rounds started in this room; 0 before the first.
  number: number;
  phase: RoundPhase;
  // When the countdown, round or wait after it ends, on the coordinator's clock; 0 in warm-up.
  until: number;
  // The player who won the round just over; empty for a draw, or before one ends.
  winner: string;
}
export const ROUND_MS = 5 * 60_000;
export const KILL_LIMIT = 15;
export const COUNTDOWN_MS = 10_000;
export const INTERMISSION_MS = 12_000;
const PHASES: RoundPhase[] = ["warmup", "countdown", "live", "over"];
// Names are kept as cleanName (in settings.ts) leaves them: no control or formatting
// characters, single spaces, and at most NAME_LENGTH characters, only ever shown as text.
export { cleanName, NAME_LENGTH };

// Players in order of the scoreboard: most kills, then fewest deaths.
export function standings(players: Record<string, CombatPlayer>): (CombatPlayer & { id: string })[] {
  return Object.entries(players).map(([id, player]) => ({ ...player, id }))
    .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || (a.id < b.id ? -1 : 1));
}

export type CombatIntent =
  // seen maps each target to the moment of its own pose timeline the shooter was looking at.
  // A knife attack names its stroke and arrives when the blade reaches the target.
  | { kind: "attack"; weapon: WeaponKind; stroke?: KnifeStroke; aim?: { heading: number; pitch: number }; seen?: Record<string, number> }
  | { kind: "pickup"; pickupId: string }
  | { kind: "reload" }
  | { kind: "select"; weapon: WeaponKind }
  | { kind: "respawn" }
  // A frag grenade, or with smoke set, a smoke grenade.
  | { kind: "throw"; aim: { heading: number; pitch: number }; smoke?: boolean }
  // Open or close something the map lets players open, such as a door or a hatch.
  | { kind: "use"; target: string }
  | { kind: "fall"; speed: number }
  // A loose prop this player simulates hit someone (thrown by this player, or else just
  // falling or flung), or stopped so suddenly it may have broken.
  | { kind: "struck"; prop: string; target: string; speed: number; zone: HitZone; thrown: boolean }
  | { kind: "smash"; prop: string; speed: number }
  | { kind: "bandage" }
  // A burst of powder from the extinguisher in hand, and putting it back.
  | { kind: "spray"; aim: { heading: number; pitch: number } }
  | { kind: "stow" }
  // The player's name and voice.
  | { kind: "profile"; name: string; voice: string };
export const VOICES = ["hi", "en", "grunts"];

export type DamageCause = WeaponKind | "grenade" | "fall" | "struck" | "bleed" | "fire";

export interface Impact { x: number; y: number; z: number; nx: number; ny: number; nz: number; material: Material; exit?: boolean }

export interface CombatEvent {
  id: number;
  // A "round" event starts a round: every peer then resets its market and its player.
  kind: "shot" | "hit" | "pickup" | "death" | "respawn" | "throw" | "explode" | "reload" | "drop" | "use" | "vent" | "smoke" | "round" | "bandage" | "spray";
  actor: string;
  target?: string;
  weapon?: WeaponKind;
  cause?: DamageCause;
  damage?: number;
  zone?: HitZone;
  // A hit on the arm rather than the body.
  arm?: boolean;
  shot?: ShotRay;
  impact?: boolean;
  impacts?: Impact[];
  from?: Vec3;
  position?: Vec3;
  velocity?: Vec3;
  fuseMs?: number;
  grenade?: number;
  stroke?: KnifeStroke;
  // A knife stroke into someone's back.
  behind?: boolean;
  // What a pickup was: a gun, spare magazines, something a fallen player dropped, or food.
  item?: "gun" | "magazines" | "drop" | "food" | "extinguisher";
  food?: FoodKind;
  // A reload that threw away an empty magazine.
  dropped?: boolean;
  // The dropped item a "drop" event made.
  drop?: string;
  // The door, hatch or gas cylinder a "use", "vent" or "explode" event concerns.
  entity?: string;
  // Whether a "use" event opened or closed it.
  open?: boolean;
  // A "throw" of a smoke grenade rather than a frag.
  smoke?: boolean;
}

// A gun or magazines a fallen player dropped. It falls from their hands along from and
// velocity to position, where it lies until someone takes it or it expires.
export interface Drop { id: string; weapon: GunKind; gun: boolean; rounds: number; mags: number[]; from: Vec3; velocity: Vec3; position: Vec3; expires: number }

// A grenade in flight or a gas cylinder venting, until it bursts; entity names the cylinder.
// A smoke grenade pops instead, harmlessly.
export interface LiveGrenade { id: number; actor: string; explodeAt: number; position: Vec3; entity?: string; smoke?: boolean }

// Something burning: a world object, named by entity, or a pool of fuel on the ground, which
// burns out at until on the coordinator's clock. by is who started it.
export interface Fire { entity?: string; position: Vec3; radius: number; until: number; by: string }

export interface CombatSnapshot {
  version: 13;
  revision: number;
  eventSeq: number;
  players: Record<string, CombatPlayer>;
  taken: string[];
  pickupReturns: Record<string, number>;
  // Health of world objects that have taken damage; 0 means destroyed.
  entities: Record<string, number>;
  grenades: LiveGrenade[];
  drops: Drop[];
  // Doors and hatches, open or shut; ones not listed are as the map starts them.
  open: Record<string, boolean>;
  fires: Fire[];
  round: RoundState;
  // The most recent events, oldest first; peers play every event newer than the last they saw.
  events: CombatEvent[];
}

// The parts of a state other than players, world objects and events, sent whole when they change.
const SHARED_PARTS = ["taken", "pickupReturns", "grenades", "drops", "open", "fires", "round"] as const;

type StateParts = Partial<Pick<CombatSnapshot, (typeof SHARED_PARTS)[number] | "entities">>;

// What a coordinator sends after the whole state: the fields of each player that changed, the
// world objects whose health changed, those of the shared parts that changed, the players who
// have left and the new events, to apply on top of the state as of revision `base`.
export type CombatDelta = StateParts & {
  base: number;
  revision: number;
  eventSeq: number;
  players?: Record<string, Partial<CombatPlayer>>;
  gone?: string[];
  events: CombatEvent[];
};

// What a coordinator last sent its peers, each field as text, to tell what has changed since.
export interface SentState { revision: number; players: Record<string, Record<string, string>>; entities: Record<string, number>; shared: Record<string, string> }

// What the coordinating peer asks of the physical world.
export interface SurfaceHit { distance: number; thickness: number; point: Vec3; normal: Vec3; material: Material; entity?: string }
export interface CombatWorld {
  clearShot(ray: ShotRay): boolean;
  traceBullet(ray: ShotRay): SurfaceHit[];
  // size is how far it reaches sideways from its centre.
  entity(id: string): { kind: string; material: Material; maxHealth: number; center: Vec3; explosive?: boolean; mass?: number; size: number } | null;
  // Whether a wall or other fixed part of the map stands between two points.
  walled(a: Vec3, b: Vec3): boolean;
  entitiesNear(center: Vec3, radius: number): { id: string; distance: number; point: Vec3 }[];
  grenadeRest(origin: Vec3, velocity: Vec3, seconds: number): Vec3;
  push(entity: string, point: Vec3, impulse: Vec3): void;
  // Swings a doorway's leaves open, or shut if they are mostly open; which it was, or null if
  // nothing is left on its hinges.
  swingDoor?(doorway: string): boolean | null;
}

const EVENTS_KEPT = 32;
const DROPS_KEPT = 12;
const DROP_LIFE_MS = 60_000;
const GUN_RETURN_MS = 30_000;
const MAGAZINE_RETURN_MS = 25_000;
const GRENADES_PER_LIFE = 2;
const GRENADE_FUSE_MS = 2600;
// Smoke grenades pop sooner, once they have about come to rest.
const SMOKES_PER_LIFE = 2;
const SMOKE_FUSE_MS = 1800;
const THROW_SPEED = 14;
const THROW_COOLDOWN_MS = 900;
export const BLAST_RADIUS = 7;
const BLAST_DAMAGE = 130;
const BLAST_ENTITY_DAMAGE = 320;
const BLAST_IMPULSE = 140;
const REWIND_LIMIT_MS = 350;
const FALL_SAFE_SPEED = 9;
const FALL_DAMAGE_PER_MS = 9;
const BULLET_IMPULSE = { pistol: 2.5, rifle: 4.5 } as const;
// A front kick: about a 12 kg leg arriving at 6 m/s.
const KICK_IMPULSE = 70;
const MATERIAL_NAMES = Object.keys(MATERIALS);
const EVENT_KINDS = ["shot", "hit", "pickup", "death", "respawn", "throw", "explode", "reload", "drop", "use", "vent", "smoke", "round", "bandage", "spray"];
// A shot gas cylinder vents burning gas for this long, then bursts like a grenade.
const VENT_MS = 1600;
// How far a player can reach to open or close something, from the eyes.
const USE_REACH = 2.3;
const GUNS = ["pistol", "rifle"] as const;
const CAUSES = ["knife", "pistol", "rifle", "grenade", "fall", "struck", "bleed", "fire"];
// What breaks the skin; a fall or a thrown crate bruises instead.
const CUTTING: (DamageCause | undefined)[] = ["knife", "pistol", "rifle", "grenade"];
// One prop hits one player once per impact, and breaks a bit at a time.
const STRUCK_GAP_MS = 500;
const SMASH_GAP_MS = 250;
// How far from the player a prop that hit them can be by the time word of it arrives.
const STRUCK_REACH = 6;

const finite = (...values: unknown[]): boolean => values.every((value) => typeof value === "number" && Number.isFinite(value));
const validVec = (value: Vec3 | undefined): boolean => value === undefined || (!!value && finite(value.x, value.y, value.z) && Math.abs(value.x) < 2000 && Math.abs(value.y) < 2000 && Math.abs(value.z) < 2000);

function validShot(ray: ShotRay): boolean {
  return !!ray.origin && !!ray.direction && [ray.origin.x, ray.origin.y, ray.origin.z, ray.direction.x, ray.direction.y, ray.direction.z, ray.distance].every(Number.isFinite)
    && ray.distance >= 0 && ray.distance <= 95 && Math.abs(Math.hypot(ray.direction.x, ray.direction.y, ray.direction.z) - 1) < 0.01;
}

function validEvent(event: CombatEvent): boolean {
  return !!event && Number.isSafeInteger(event.id) && EVENT_KINDS.includes(event.kind) && typeof event.actor === "string"
    && (event.target === undefined || typeof event.target === "string")
    && (!event.shot || validShot(event.shot))
    && (event.damage === undefined || (finite(event.damage) && event.damage >= 0 && event.damage <= 200))
    && (!event.weapon || ["knife", "pistol", "rifle"].includes(event.weapon))
    && (!event.cause || CAUSES.includes(event.cause))
    && (!event.impacts || (Array.isArray(event.impacts) && event.impacts.length <= 24 && event.impacts.every((impact) => validVec(impact) && finite(impact.nx, impact.ny, impact.nz) && MATERIAL_NAMES.includes(impact.material))))
    && validVec(event.from) && validVec(event.position) && validVec(event.velocity)
    && (event.fuseMs === undefined || (finite(event.fuseMs) && event.fuseMs >= 0 && event.fuseMs <= 10_000))
    && (event.stroke === undefined || event.stroke === "slash" || event.stroke === "stab")
    && (event.item === undefined || ["gun", "magazines", "drop", "food", "extinguisher"].includes(event.item))
    && (event.food === undefined || FOOD_KINDS.includes(event.food))
    && (event.drop === undefined || (typeof event.drop === "string" && event.drop.length < 40))
    && (event.entity === undefined || (typeof event.entity === "string" && event.entity.length < 40))
    && (event.open === undefined || typeof event.open === "boolean")
    && (event.smoke === undefined || typeof event.smoke === "boolean")
    && (event.arm === undefined || typeof event.arm === "boolean");
}

const validMagazines = (gun: GunKind, mags: unknown): boolean => Array.isArray(mags) && mags.length <= MAX_SPARE_MAGAZINES
  && mags.every((rounds) => Number.isInteger(rounds) && rounds > 0 && rounds <= WEAPONS[gun].magazine);

function validDrop(drop: Drop): boolean {
  return !!drop && typeof drop.id === "string" && drop.id.length < 40 && (drop.weapon === "pistol" || drop.weapon === "rifle") && typeof drop.gun === "boolean"
    && Number.isInteger(drop.rounds) && drop.rounds >= 0 && drop.rounds <= WEAPONS[drop.weapon].magazine + 1 && validMagazines(drop.weapon, drop.mags)
    && validVec(drop.from) && validVec(drop.velocity) && validVec(drop.position) && !!drop.from && !!drop.velocity && !!drop.position && finite(drop.expires);
}

// Every life starts with only the knife and grenades: guns and ammunition are found.
function freshPlayer(): CombatPlayer {
  return { health: 100, owned: ["knife"], active: "knife", ammo: { pistol: 0, rifle: 0 }, mags: { pistol: [], rifle: [] }, grenades: GRENADES_PER_LIFE, smokes: SMOKES_PER_LIFE, reloadUntil: 0, respawnAfter: 0, kills: 0, deaths: 0, intent: 0, name: "", voice: "", leg: 0, arm: 0, bleedUntil: 0, bleedBy: "", bandages: BANDAGES_PER_LIFE, powder: 0, burnUntil: 0, burnBy: "" };
}

function validPlayer(player: CombatPlayer): boolean {
  const validWeapon = (weapon: unknown): weapon is WeaponKind => weapon === "knife" || weapon === "pistol" || weapon === "rifle";
  return Number.isInteger(player.health) && player.health >= 0 && player.health <= 100
    && Array.isArray(player.owned) && player.owned.every(validWeapon) && player.owned.includes("knife")
    && validWeapon(player.active) && player.owned.includes(player.active)
    && GUNS.every((gun) => Number.isInteger(player.ammo?.[gun]) && player.ammo[gun] >= 0 && player.ammo[gun] <= WEAPONS[gun].magazine + 1 && validMagazines(gun, player.mags?.[gun]))
    && Number.isInteger(player.grenades) && player.grenades >= 0 && player.grenades <= GRENADES_PER_LIFE
    && Number.isInteger(player.smokes) && player.smokes >= 0 && player.smokes <= SMOKES_PER_LIFE
    && Number.isFinite(player.reloadUntil) && player.reloadUntil >= 0
    && Number.isFinite(player.respawnAfter) && player.respawnAfter >= 0
    && Number.isSafeInteger(player.kills) && player.kills >= 0
    && Number.isSafeInteger(player.deaths) && player.deaths >= 0
    && Number.isSafeInteger(player.intent) && player.intent >= 0
    && typeof player.name === "string" && player.name.length <= 4 * NAME_LENGTH
    && (player.voice === "" || VOICES.includes(player.voice))
    && finite(player.leg, player.arm, player.bleedUntil) && player.leg >= 0 && player.leg <= 1 && player.arm >= 0 && player.arm <= 1 && player.bleedUntil >= 0
    && typeof player.bleedBy === "string" && player.bleedBy.length <= 64
    && Number.isInteger(player.bandages) && player.bandages >= 0 && player.bandages <= BANDAGES_PER_LIFE
    && finite(player.powder, player.burnUntil) && player.powder >= 0 && player.powder <= POWDER_SECONDS && player.burnUntil >= 0
    && typeof player.burnBy === "string" && player.burnBy.length <= 64;
}

const PLAYER_FIELDS = Object.keys(freshPlayer());

const checkEvents = (events: CombatEvent[]): CombatEvent[] => events.filter(validEvent).slice(-EVENTS_KEPT).map((event) => structuredClone(event));

function emptySnapshot(): CombatSnapshot {
  return { version: 13, revision: 0, eventSeq: 0, players: {}, taken: [], pickupReturns: {}, entities: {}, grenades: [], drops: [], open: {}, fires: [], round: { number: 0, phase: "warmup", until: 0, winner: "" }, events: [] };
}

// The fields of value whose text differs from `before`, which is brought up to date; null if none.
function changedFields(value: object, before: Record<string, string>, keys: readonly string[] = Object.keys(value)): Record<string, unknown> | null {
  let fields: Record<string, unknown> | null = null;
  for (const key of keys) {
    const field = (value as Record<string, unknown>)[key], text = JSON.stringify(field);
    if (text === before[key]) continue;
    before[key] = text;
    (fields ??= {})[key] = field;
  }
  return fields;
}

function lerpAngle(a: number, b: number, t: number): number {
  return (a + ((((b - a) % 360) + 540) % 360 - 180) * t + 360) % 360;
}

export class MatchState {
  readonly pickups: WeaponPickup[];
  private snapshot: CombatSnapshot = emptySnapshot();
  private poses = new Map<string, PlayerPose>();
  private poseTimes = new Map<string, number>();
  // Each player's recent poses on their own clock, for rewinding targets to what a shooter saw.
  private history = new Map<string, { time: number; pose: PlayerPose }[]>();
  private equipUntil = new Map<string, number>();
  private lastAttack = new Map<string, number>();
  private lastThrow = new Map<string, number>();
  private bloom = new Map<string, number>();
  private lastStroke = new Map<string, KnifeStroke>();
  private lastUse = new Map<string, number>();
  private lastStruck = new Map<string, number>();
  private lastSmash = new Map<string, number>();
  // When each player bleeding next loses a point, and when a bandage being tied is done.
  private drips = new Map<string, number>();
  private bandaging = new Map<string, number>();
  // How hot each thing near a fire has got, and when fires are next worked out.
  private heat = new Map<string, number>();
  private fireStepAt = 0;
  // Who last lit each stove, which extinguisher each player holds, and how much powder each fire has had.
  private stoveBy = new Map<string, string>();
  private tools = new Map<string, string>();
  private lastSpray = new Map<string, number>();
  private doused = new WeakMap<Fire, number>();
  // Players whose positions have arrived, so they are in the game rather than loading it.
  private present = new Set<string>();
  private now = 0;

  constructor(private data: ArenaData, private onChange: (snapshot: CombatSnapshot) => void, private world?: CombatWorld) {
    this.pickups = makeWeaponPickups(data);
  }

  reset(selfId: string): void {
    this.snapshot = { ...emptySnapshot(), players: { [selfId]: freshPlayer() } };
    this.poses.clear();
    this.poseTimes.clear();
    this.history.clear();
    this.lastAttack.clear();
    this.lastThrow.clear();
    this.bloom.clear();
    this.lastStroke.clear();
    this.equipUntil.clear();
    this.lastStruck.clear();
    this.lastSmash.clear();
    this.drips.clear();
    this.bandaging.clear();
    this.heat.clear();
    this.present.clear();
    this.onChange(this.snapshot);
  }

  getState(): CombatSnapshot { return structuredClone(this.snapshot); }
  // The state to send, without copying it: only the events after `since`, as peers already
  // hold the earlier ones. Serialise it straight away; it shares the live objects.
  view(since = 0): CombatSnapshot { return { ...this.snapshot, events: this.snapshot.events.filter((event) => event.id > since) }; }
  player(id: string): CombatPlayer | undefined { return this.snapshot.players[id]; }
  playerIds(): string[] { return Object.keys(this.snapshot.players); }
  // Every player, live: for reading only.
  players(): Readonly<Record<string, CombatPlayer>> { return this.snapshot.players; }
  round(): RoundState { return this.snapshot.round; }
  burning(id: string): boolean { return this.snapshot.fires.some((fire) => fire.entity === id); }

  // time is the moment on the sender's own clock; the local player uses this clock.
  setPose(id: string, pose: PlayerPose, time = Date.now()): void {
    this.present.add(id);
    this.poses.set(id, pose);
    this.poseTimes.set(id, Date.now());
    const history = this.history.get(id) ?? [];
    if (!history.length || time > history[history.length - 1].time) history.push({ time, pose });
    while (history.length > 2 && history[0].time < time - 3500) history.shift();
    this.history.set(id, history);
  }

  removePose(id: string): void { this.poses.delete(id); this.poseTimes.delete(id); this.history.delete(id); }

  // Where a player was at a moment of their own timeline, interpolated from history and
  // limited to a short rewind so stale claims cannot reach far into the past.
  poseAt(id: string, time?: number): PlayerPose | undefined {
    const latest = this.poses.get(id);
    const history = this.history.get(id);
    if (time === undefined || !latest || !history || history.length < 2) return latest;
    const newest = history[history.length - 1].time;
    const target = Math.max(newest - REWIND_LIMIT_MS, Math.min(newest, time));
    for (let index = history.length - 2; index >= 0; index -= 1) {
      const a = history[index], b = history[index + 1];
      if (a.time > target) continue;
      const t = b.time > a.time ? Math.min(1, (target - a.time) / (b.time - a.time)) : 1;
      return {
        ...a.pose,
        east: a.pose.east + (b.pose.east - a.pose.east) * t,
        north: a.pose.north + (b.pose.north - a.pose.north) * t,
        jumpHeight: a.pose.jumpHeight + (b.pose.jumpHeight - a.pose.jumpHeight) * t,
        heading: lerpAngle(a.pose.heading, b.pose.heading, t),
        pitch: a.pose.pitch + (b.pose.pitch - a.pose.pitch) * t,
        lean: (a.pose.lean ?? 0) + ((b.pose.lean ?? 0) - (a.pose.lean ?? 0)) * t,
      };
    }
    return history[0].pose;
  }

  ensurePlayer(id: string): boolean {
    if (this.snapshot.players[id]) return false;
    this.snapshot.players[id] = freshPlayer();
    this.changed();
    return true;
  }

  // A player who has left the room; the coordinator's next update tells everyone.
  removePlayer(id: string): void {
    this.present.delete(id);
    this.removePose(id);
    if (!this.snapshot.players[id]) return;
    delete this.snapshot.players[id];
    this.changed();
  }

  // Takes a coordinator's whole state. With force it replaces this one whatever their
  // revisions, as when a new coordinator takes over.
  adopt(incoming: CombatSnapshot, force = false): boolean {
    if (!incoming || incoming.version !== 13 || !Number.isSafeInteger(incoming.revision) || incoming.revision < 0 || !Number.isSafeInteger(incoming.eventSeq)
      || !incoming.players || typeof incoming.players !== "object" || !incoming.entities || SHARED_PARTS.some((key) => !incoming[key]) || !Array.isArray(incoming.events)) return false;
    const morePlayers = Object.keys(incoming.players).length > Object.keys(this.snapshot.players).length;
    if (!force && (incoming.revision < this.snapshot.revision || (incoming.revision === this.snapshot.revision && !morePlayers))) return false;
    const players: Record<string, CombatPlayer> = {};
    for (const [id, player] of Object.entries(incoming.players)) {
      if (!player || !validPlayer(player)) return false;
      players[id] = structuredClone(player);
    }
    const parts = this.checkParts(incoming);
    if (!parts) return false;
    this.snapshot = { ...emptySnapshot(), ...parts, revision: incoming.revision, eventSeq: incoming.eventSeq, players, events: checkEvents(incoming.events) };
    this.onChange(this.snapshot);
    return true;
  }

  // Applies a coordinator's changes, checked as adopt checks a whole state. False if this
  // state is older than the one they were made from, or anything in them fails the checks.
  applyDelta(delta: CombatDelta): boolean {
    if (!delta || !Number.isSafeInteger(delta.base) || !Number.isSafeInteger(delta.revision) || delta.revision < delta.base || this.snapshot.revision < delta.base
      || !Number.isSafeInteger(delta.eventSeq) || !Array.isArray(delta.events) || (delta.players !== undefined && (!delta.players || typeof delta.players !== "object"))
      || (delta.gone !== undefined && (!Array.isArray(delta.gone) || delta.gone.length > 64 || !delta.gone.every((id) => typeof id === "string")))) return false;
    const players = { ...this.snapshot.players };
    for (const id of delta.gone ?? []) delete players[id];
    for (const [id, fields] of Object.entries(delta.players ?? {})) {
      if (!fields || typeof fields !== "object" || !Object.keys(fields).every((key) => PLAYER_FIELDS.includes(key))) return false;
      const player = { ...players[id], ...structuredClone(fields) } as CombatPlayer;
      if (!validPlayer(player)) return false;
      players[id] = player;
    }
    const parts = this.checkParts(delta);
    if (!parts) return false;
    this.snapshot = { ...this.snapshot, ...parts, revision: delta.revision, eventSeq: delta.eventSeq, players, entities: { ...this.snapshot.entities, ...parts.entities }, events: checkEvents(delta.events) };
    this.onChange(this.snapshot);
    return true;
  }

  // The state as sent whole, field by field, for delta to compare with.
  sent(): SentState {
    const sent: SentState = { revision: this.snapshot.revision, players: {}, entities: { ...this.snapshot.entities }, shared: {} };
    for (const [id, player] of Object.entries(this.snapshot.players)) changedFields(player, sent.players[id] = {});
    changedFields(this.snapshot, sent.shared, SHARED_PARTS);
    return sent;
  }

  // What has changed since `sent`, which is brought up to date, with the events after
  // `since`; null if nothing has. Like view, it shares the live objects.
  delta(sent: SentState, since: number): CombatDelta | null {
    const delta: CombatDelta = { base: sent.revision, revision: this.snapshot.revision, eventSeq: this.snapshot.eventSeq, events: this.snapshot.events.filter((event) => event.id > since) };
    let changed = delta.events.length > 0;
    for (const [id, player] of Object.entries(this.snapshot.players)) {
      const fields = changedFields(player, sent.players[id] ??= {});
      if (fields) { (delta.players ??= {})[id] = fields as Partial<CombatPlayer>; changed = true; }
    }
    for (const id of Object.keys(sent.players)) {
      if (this.snapshot.players[id]) continue;
      (delta.gone ??= []).push(id);
      delete sent.players[id];
      changed = true;
    }
    for (const [id, health] of Object.entries(this.snapshot.entities)) {
      if (sent.entities[id] !== health) { (delta.entities ??= {})[id] = sent.entities[id] = health; changed = true; }
    }
    const shared = changedFields(this.snapshot, sent.shared, SHARED_PARTS);
    if (shared) { Object.assign(delta, shared); changed = true; }
    if (!changed) return null;
    sent.revision = this.snapshot.revision;
    return delta;
  }

  // Checked copies of whichever parts other than players and events are given; null if one is malformed.
  private checkParts(incoming: StateParts): StateParts | null {
    const parts: StateParts = {};
    const record = (value: unknown): boolean => !!value && typeof value === "object" && !Array.isArray(value);
    if (incoming.taken !== undefined) {
      if (!Array.isArray(incoming.taken)) return null;
      parts.taken = incoming.taken.filter((id) => this.pickups.some((pickup) => pickup.id === id));
    }
    if (incoming.pickupReturns !== undefined) {
      if (!record(incoming.pickupReturns)) return null;
      const pickupReturns: Record<string, number> = parts.pickupReturns = {};
      for (const pickup of this.pickups) {
        const due = incoming.pickupReturns[pickup.id];
        if (Number.isFinite(due) && due >= 0) pickupReturns[pickup.id] = due;
      }
    }
    if (incoming.entities !== undefined) {
      if (!record(incoming.entities)) return null;
      const entities: Record<string, number> = parts.entities = {};
      for (const [id, health] of Object.entries(incoming.entities)) if (id.length < 64 && finite(health) && health >= 0 && health <= 100_000) entities[id] = health;
    }
    if (incoming.grenades !== undefined) {
      if (!Array.isArray(incoming.grenades)) return null;
      parts.grenades = structuredClone(incoming.grenades.filter((grenade) => grenade && Number.isSafeInteger(grenade.id) && typeof grenade.actor === "string" && finite(grenade.explodeAt) && validVec(grenade.position)
        && (grenade.entity === undefined || (typeof grenade.entity === "string" && grenade.entity.length < 40)) && (grenade.smoke === undefined || typeof grenade.smoke === "boolean")).slice(0, 16));
    }
    if (incoming.open !== undefined) {
      if (!record(incoming.open)) return null;
      const open: Record<string, boolean> = parts.open = {};
      for (const toggle of this.data.layout.toggles) if (typeof incoming.open[toggle.id] === "boolean") open[toggle.id] = incoming.open[toggle.id];
    }
    if (incoming.drops !== undefined) {
      if (!Array.isArray(incoming.drops)) return null;
      parts.drops = structuredClone(incoming.drops.filter(validDrop).slice(-DROPS_KEPT));
    }
    if (incoming.fires !== undefined) {
      if (!Array.isArray(incoming.fires)) return null;
      parts.fires = structuredClone(incoming.fires.filter((fire) => fire && !!fire.position && validVec(fire.position) && finite(fire.radius, fire.until) && fire.radius > 0 && fire.radius < 10 && typeof fire.by === "string" && fire.by.length <= 64
        && (fire.entity === undefined || (typeof fire.entity === "string" && fire.entity.length < 40))).slice(0, MAX_FIRES));
    }
    if (incoming.round !== undefined) {
      const round = incoming.round;
      if (!record(round) || !Number.isSafeInteger(round.number) || round.number < 0 || !PHASES.includes(round.phase) || !finite(round.until) || round.until < 0
        || typeof round.winner !== "string" || round.winner.length > 64) return null;
      parts.round = { number: round.number, phase: round.phase, until: round.until, winner: round.winner };
    }
    return parts;
  }

  // Notes the newest intent handled from a player; false if this one was handled already.
  handle(actor: string, sequence: number): boolean {
    const player = this.snapshot.players[actor];
    if (!player || sequence <= player.intent) return false;
    player.intent = sequence;
    this.snapshot.revision += 1;
    return true;
  }

  apply(actor: string, intent: CombatIntent, now = Date.now()): boolean {
    this.now = now;
    const player = this.snapshot.players[actor];
    if (!player) return false;
    if (intent.kind === "profile") {
      const name = cleanName(String(intent.name)), voice = VOICES.includes(intent.voice) ? intent.voice : player.voice;
      if (name === player.name && voice === player.voice) return false;
      player.name = name;
      player.voice = voice;
      this.changed();
      return true;
    }
    if (intent.kind === "respawn") {
      if (player.health > 0 || now < player.respawnAfter) return false;
      const { kills, deaths, intent: handled, name, voice } = player;
      Object.assign(player, freshPlayer(), { kills, deaths, intent: handled, name, voice });
      this.removePose(actor);
      this.emit({ kind: "respawn", actor });
      this.changed();
      return true;
    }
    // What has already been thrown still lands, whatever has become of the thrower.
    if (intent.kind === "struck") return this.struck(actor, intent);
    if (intent.kind === "smash") return this.smash(actor, intent.prop, intent.speed);
    if (player.health <= 0) return false;
    const pose = this.poses.get(actor);
    const fresh = !!pose && now - (this.poseTimes.get(actor) ?? 0) <= 1500;
    if (intent.kind === "pickup") {
      if (!pose || !fresh) return false;
      const feet = pose.jumpHeight;
      const within = (east: number, north: number, height: number): boolean => Math.hypot(pose.east - east, pose.north - north) <= PICKUP_REACH && Math.abs(feet - height) <= PICKUP_HEIGHT;
      const drop = this.snapshot.drops.find((item) => item.id === intent.pickupId);
      if (drop) return within(drop.position.x, drop.position.z, drop.position.y - terrainHeight(this.data, drop.position.x, drop.position.z)) && this.takeDrop(actor, player, drop, now);
      const pickup = this.pickups.find((item) => item.id === intent.pickupId);
      if (!pickup || this.snapshot.taken.includes(pickup.id) || !within(pickup.east, pickup.north, pickup.y)) return false;
      if (pickup.item === "extinguisher") {
        if (player.powder > 0 || player.reloadUntil > now || this.snapshot.entities[pickup.id] === 0) return false;
        player.powder = POWDER_SECONDS;
        this.tools.set(actor, pickup.id);
        this.equipUntil.set(actor, now + 500);
        this.snapshot.taken.push(pickup.id);
        this.snapshot.pickupReturns[pickup.id] = now + EXTINGUISHER_RETURN_MS;
        this.emit({ kind: "pickup", actor, item: "extinguisher" });
        this.changed();
        return true;
      }
      if (pickup.item === "food") {
        const food = FOOD[pickup.food];
        // A healthy player leaves the dumplings for someone who needs them.
        if (food.heal && player.health >= FULL_HEALTH) return false;
        player.health = Math.min(FULL_HEALTH, player.health + food.heal);
        // The hands are busy: the same wait as switching weapons keeps them from firing.
        this.equipUntil.set(actor, Math.max(this.equipUntil.get(actor) ?? 0, now + EAT_MS));
        this.snapshot.taken.push(pickup.id);
        this.snapshot.pickupReturns[pickup.id] = now + FOOD_RETURN_MS;
        this.emit({ kind: "pickup", actor, item: "food", food: pickup.food });
        this.changed();
        return true;
      }
      const gun = pickup.weapon, spares = player.mags[gun];
      if (pickup.item === "magazines") {
        if (spares.length >= MAX_SPARE_MAGAZINES) return false;
        for (let index = 0; index < MAGAZINES_PER_PICKUP && spares.length < MAX_SPARE_MAGAZINES; index += 1) spares.push(WEAPONS[gun].magazine);
      } else if (!player.owned.includes(gun)) {
        // A gun comes with the one magazine that is in it.
        player.owned.push(gun);
        player.ammo[gun] = WEAPONS[gun].magazine;
        this.equip(actor, player, gun, now);
      } else {
        // Another gun of a kind already carried: its magazine is stripped and kept.
        if (spares.length >= MAX_SPARE_MAGAZINES) return false;
        spares.push(WEAPONS[gun].magazine);
      }
      this.snapshot.taken.push(pickup.id);
      this.snapshot.pickupReturns[pickup.id] = now + (pickup.item === "magazines" ? MAGAZINE_RETURN_MS : GUN_RETURN_MS);
      this.emit({ kind: "pickup", actor, weapon: gun, item: pickup.item });
      this.changed();
      return true;
    }
    if (intent.kind === "select") {
      if (!player.owned.includes(intent.weapon) || player.active === intent.weapon || player.reloadUntil > now) return false;
      player.active = intent.weapon;
      this.equipUntil.set(actor, now + 560);
      this.changed();
      return true;
    }
    // A reload swaps in the fullest spare magazine. A magazine with rounds left goes back
    // in the pouch and an empty one is dropped; a round already chambered stays there.
    if (intent.kind === "reload") {
      const gun = player.active;
      if (gun === "knife" || player.reloadUntil > now || !player.mags[gun].length) return false;
      const loaded = player.ammo[gun], chamber = loaded > 0 ? 1 : 0;
      if (Math.max(...player.mags[gun]) + chamber <= loaded) return false;
      player.reloadUntil = now + reloadTime(gun, player.arm);
      this.emit({ kind: "reload", actor, weapon: gun, dropped: loaded - chamber <= 0 });
      this.changed();
      return true;
    }
    if (intent.kind === "fall") return this.fall(actor, intent.speed);
    if (intent.kind === "spray") return !!pose && fresh && this.spray(actor, player, pose, intent.aim, now);
    // Put back with powder left, it is on the wall again almost at once.
    if (intent.kind === "stow") {
      if (player.powder <= 0) return false;
      player.powder = 0;
      const tool = this.tools.get(actor);
      if (tool && this.snapshot.taken.includes(tool)) this.snapshot.pickupReturns[tool] = now + 300;
      this.tools.delete(actor);
      this.changed();
      return true;
    }
    // Tying a bandage keeps the hands busy, and a fresh wound undoes it.
    if (intent.kind === "bandage") {
      if (player.bandages <= 0 || this.bandaging.has(actor) || player.reloadUntil > now || now < (this.equipUntil.get(actor) ?? 0) || (!player.leg && !player.arm && !player.bleedUntil)) return false;
      this.bandaging.set(actor, now + BANDAGE_MS);
      this.equipUntil.set(actor, now + BANDAGE_MS);
      return true;
    }
    if (intent.kind === "use") {
      const toggle = this.data.layout.toggles.find((item) => item.id === intent.target);
      if (!toggle || !pose || !fresh || now - (this.lastUse.get(toggle.id) ?? 0) < 500) return false;
      const eye = shotRay(this.data, pose, "knife").origin;
      if (Math.hypot(eye.x - toggle.at.x, eye.y - toggle.at.y, eye.z - toggle.at.z) > USE_REACH) return false;
      // A door is swung by hand and goes as far as nothing stops it; its leaves' bodies carry
      // where it is, not the shared state.
      if (toggle.id.startsWith("door:") && this.world?.swingDoor) {
        const swung = this.world.swingDoor(toggle.id);
        if (swung === null) return false;
        this.lastUse.set(toggle.id, now);
        this.emit({ kind: "use", actor, entity: toggle.id, open: swung });
        this.changed();
        return true;
      }
      const open = !(this.snapshot.open[toggle.id] ?? toggle.open);
      this.snapshot.open[toggle.id] = open;
      this.lastUse.set(toggle.id, now);
      if (toggle.id.startsWith("stove:")) this.stoveBy.set(toggle.id, actor);
      this.emit({ kind: "use", actor, entity: toggle.id, open });
      this.changed();
      return true;
    }
    // The wait after a round is a ceasefire.
    if ((intent.kind === "throw" || intent.kind === "attack") && this.snapshot.round.phase === "over") return false;
    if (intent.kind === "throw") {
      const aim = intent.aim, smoke = intent.smoke === true, fuse = smoke ? SMOKE_FUSE_MS : GRENADE_FUSE_MS;
      if (!pose || !fresh || (smoke ? player.smokes : player.grenades) <= 0 || now - (this.lastThrow.get(actor) ?? 0) < THROW_COOLDOWN_MS
        || !aim || !finite(aim.heading, aim.pitch) || Math.abs(aim.pitch) > 80) return false;
      this.lastThrow.set(actor, now);
      if (smoke) player.smokes -= 1; else player.grenades -= 1;
      const yaw = aim.heading * Math.PI / 180, pitch = aim.pitch * Math.PI / 180;
      const forward = { x: Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: Math.cos(yaw) * Math.cos(pitch) };
      const eye = shotRay(this.data, pose, "pistol").origin;
      // Released from the right hand, just ahead of and below the eyes.
      const position = { x: eye.x + forward.x * 0.45 - Math.cos(yaw) * 0.18, y: eye.y - 0.12 + forward.y * 0.45, z: eye.z + forward.z * 0.45 + Math.sin(yaw) * 0.18 };
      const velocity = { x: forward.x * THROW_SPEED, y: forward.y * THROW_SPEED + 2.2, z: forward.z * THROW_SPEED };
      const rest = this.world?.grenadeRest(position, velocity, fuse / 1000) ?? position;
      const id = this.emit({ kind: "throw", actor, position, velocity, fuseMs: fuse, ...(smoke ? { smoke } : {}) });
      this.snapshot.events[this.snapshot.events.length - 1].grenade = id;
      this.snapshot.grenades.push({ id, actor, explodeAt: now + fuse, position: rest, ...(smoke ? { smoke } : {}) });
      this.changed();
      return true;
    }
    if (intent.kind === "attack") {
      const weapon = player.active;
      if (now < (this.equipUntil.get(actor) ?? 0) || intent.weapon !== weapon || player.reloadUntil > now) return false;
      const aim = intent.aim;
      if (aim && (!finite(aim.heading, aim.pitch) || Math.abs(aim.pitch) > 80)) return false;
      if (!pose || !fresh || pose.running) return false;
      const last = this.lastAttack.get(actor) ?? 0;
      if (weapon === "knife") {
        // Strokes arrive when the blade lands, so the gap allows for each one's wind-up.
        const stroke = intent.stroke === "stab" ? "stab" : "slash", previous = KNIFE[this.lastStroke.get(actor) ?? "slash"];
        if (now - last < previous.recoveryMs - previous.contactMs + KNIFE[stroke].contactMs - 90) return false;
        this.lastAttack.set(actor, now);
        this.lastStroke.set(actor, stroke);
        this.resolveKnife(actor, stroke, { ...pose, ...(aim ?? {}) }, intent.seen);
        this.changed();
        return true;
      }
      if (now - last < WEAPONS[weapon].cooldownMs || player.ammo[weapon] <= 0) return false;
      // Spread follows how the shooter was moving and how fast they have been firing.
      const sinceLast = (now - last) / 1000;
      const bloom = currentBloom(weapon, this.bloom.get(actor) ?? 0, sinceLast);
      const spread = spreadDegrees(weapon, { moving: pose.moving, crouching: pose.crouching, airborne: !!pose.airborne, sliding: !!pose.sliding, aiming: !!pose.aiming }, bloom) * armSpread(player.arm);
      this.bloom.set(actor, bloomAfterShot(weapon, this.bloom.get(actor) ?? 0, sinceLast));
      const origin = { ...pose, ...deviateAim(aim ?? pose, spread) };
      this.lastAttack.set(actor, now);
      player.ammo[weapon] -= 1;
      this.resolveShot(actor, weapon, origin, intent.seen);
      this.changed();
      return true;
    }
    return false;
  }

  // A burst of powder: fires in a widening cone in front of the player take it, unless a wall is
  // in the way. A burning object goes out after three bursts and a pool of fuel after six.
  private spray(actor: string, player: CombatPlayer, pose: PlayerPose, aim: { heading: number; pitch: number }, now: number): boolean {
    if (player.powder <= 0 || now - (this.lastSpray.get(actor) ?? 0) < SPRAY_MS - 70 || !aim || !finite(aim.heading, aim.pitch) || Math.abs(aim.pitch) > 80) return false;
    this.lastSpray.set(actor, now);
    player.powder = Math.max(0, Math.round((player.powder - SPRAY_MS / 1000) * 100) / 100);
    const ray = shotRay(this.data, { ...pose, ...aim }, "pistol"), eye = ray.origin, d = ray.direction;
    // Powder puts out a person as readily as a crate.
    for (const [id, other] of Object.entries(this.snapshot.players)) {
      const at = this.poses.get(id);
      if (!other.burnUntil || !at || id === actor) continue;
      const x = at.east - eye.x, y = terrainHeight(this.data, at.east, at.north) + at.jumpHeight + 1 - eye.y, z = at.north - eye.z, along = x * d.x + y * d.y + z * d.z;
      if (along > 0 && along < SPRAY_REACH && Math.sqrt(Math.max(0, x * x + y * y + z * z - along * along)) < 0.6 + along * 0.35) { other.burnUntil = 0; other.burnBy = ""; }
    }
    for (const fire of [...this.snapshot.fires]) {
      const x = fire.position.x - eye.x, y = fire.position.y - eye.y, z = fire.position.z - eye.z, along = x * d.x + y * d.y + z * d.z;
      if (along <= 0 || along > SPRAY_REACH + fire.radius || Math.sqrt(Math.max(0, x * x + y * y + z * z - along * along)) > fire.radius + 0.3 + along * 0.35 || this.world?.walled(eye, fire.position)) continue;
      const bursts = (this.doused.get(fire) ?? 0) + 1;
      if (bursts < (fire.entity ? 3 : 6)) { this.doused.set(fire, bursts); continue; }
      this.snapshot.fires = this.snapshot.fires.filter((other) => other !== fire);
      for (const near of this.world?.entitiesNear(fire.position, fire.radius + 1.5) ?? []) this.heat.delete(near.id);
    }
    this.emit({ kind: "spray", actor, position: { x: eye.x + d.x * 0.72, y: eye.y - 0.4 + d.y * 0.72, z: eye.z + d.z * 0.72 }, velocity: { ...d } });
    this.changed();
    return true;
  }

  // A loose object hit someone. The peer simulating it says so; it has to be near them here too.
  private struck(actor: string, { prop, target, speed, zone, thrown }: Extract<CombatIntent, { kind: "struck" }>): boolean {
    const info = this.world?.entity(prop), victim = this.snapshot.players[target], pose = this.poses.get(target), key = `${prop}|${target}`;
    if (!info?.mass || !victim || !pose || victim.health <= 0 || this.now - (this.lastStruck.get(key) ?? -Infinity) < STRUCK_GAP_MS) return false;
    const dx = pose.east - info.center.x, dz = pose.north - info.center.z, apart = Math.hypot(dx, dz);
    const damage = strikeDamage(info.mass, speed, info.material, zone);
    if (apart > STRUCK_REACH || damage <= 0) return false;
    this.lastStruck.set(key, this.now);
    const knock = strikeKnock(info.mass, speed) / (apart || 1);
    this.hurt(target, damage, { kind: "hit", actor: thrown ? actor : target, target, cause: "struck", zone, entity: prop, from: info.center, velocity: { x: dx * knock, y: 0, z: dz * knock } });
    this.changed();
    return true;
  }

  // A loose object stopped hard enough to be damaged by it.
  private smash(actor: string, prop: string, speed: number): boolean {
    const info = this.world?.entity(prop);
    if (!info || !Number.isFinite(info.maxHealth) || this.now - (this.lastSmash.get(prop) ?? -Infinity) < SMASH_GAP_MS) return false;
    const share = smashShare(speed, info.material);
    if (share <= 0) return false;
    this.lastSmash.set(prop, this.now);
    this.damageEntity(actor, prop, share * info.maxHealth, info.center, { x: 0, y: 0, z: 0 });
    this.changed();
    return true;
  }

  private equip(actor: string, player: CombatPlayer, weapon: WeaponKind, now: number): void {
    player.active = weapon;
    player.reloadUntil = 0;
    this.equipUntil.set(actor, now + 560);
  }

  // Taking what a fallen player dropped: a gun not yet carried comes with the rounds left in
  // it; otherwise its magazine joins the spares, with any spare magazines it lay with.
  private takeDrop(actor: string, player: CombatPlayer, drop: Drop, now: number): boolean {
    const gun = drop.weapon, spares = player.mags[gun];
    let took = false;
    if (drop.gun && !player.owned.includes(gun)) {
      player.owned.push(gun);
      player.ammo[gun] = drop.rounds;
      this.equip(actor, player, gun, now);
      took = true;
    } else if (drop.gun && drop.rounds > 0 && spares.length < MAX_SPARE_MAGAZINES) {
      spares.push(Math.min(drop.rounds, WEAPONS[gun].magazine));
      took = true;
    }
    for (const rounds of drop.mags) if (spares.length < MAX_SPARE_MAGAZINES) { spares.push(rounds); took = true; }
    if (!took) return false;
    this.snapshot.drops = this.snapshot.drops.filter((item) => item !== drop);
    this.emit({ kind: "pickup", actor, weapon: gun, item: "drop", drop: drop.id });
    this.changed();
    return true;
  }

  // A fallen player's guns and magazines fall from their hands, pushed away from the blow,
  // and come to rest where the physical world puts them.
  private dropLoot(id: string, player: CombatPlayer, from?: Vec3): void {
    const pose = this.poses.get(id);
    let side = 1;
    for (const gun of GUNS) {
      const carried = player.owned.includes(gun);
      if (!pose || (!carried && !player.mags[gun].length)) continue;
      const yaw = pose.heading * Math.PI / 180, ground = terrainHeight(this.data, pose.east, pose.north) + pose.jumpHeight;
      const origin = { x: pose.east + Math.sin(yaw) * 0.3 - Math.cos(yaw) * 0.22 * side, y: ground + (pose.crouching ? 0.75 : 1.1), z: pose.north + Math.cos(yaw) * 0.3 + Math.sin(yaw) * 0.22 * side };
      const away = from ? { x: origin.x - from.x, z: origin.z - from.z } : { x: Math.sin(yaw), z: Math.cos(yaw) };
      const length = Math.hypot(away.x, away.z) || 1;
      const velocity = { x: away.x / length * 1.4 - Math.cos(yaw) * 0.5 * side, y: 1.1, z: away.z / length * 1.4 + Math.sin(yaw) * 0.5 * side };
      const position = this.world?.grenadeRest(origin, velocity, 1.6) ?? { x: origin.x, y: ground + 0.06, z: origin.z };
      const drop: Drop = { id: `drop:${this.snapshot.eventSeq + 1}`, weapon: gun, gun: carried, rounds: carried ? player.ammo[gun] : 0, mags: [...player.mags[gun]], from: origin, velocity, position, expires: this.now + DROP_LIFE_MS };
      this.emit({ kind: "drop", actor: id, weapon: gun, drop: drop.id });
      this.snapshot.drops.push(drop);
      side = -side;
    }
    if (this.snapshot.drops.length > DROPS_KEPT) this.snapshot.drops.splice(0, this.snapshot.drops.length - DROPS_KEPT);
    Object.assign(player, { owned: ["knife"], active: "knife", ammo: { pistol: 0, rifle: 0 }, mags: { pistol: [], rifle: [] } });
  }

  // A knife stroke sweeps the blade along a fan of short rays in the order the arm moves it:
  // across from upper right to lower left for a slash, straight ahead for a stab. The blade
  // stops at the first thing it meets: a body takes the cut, and anything else turns it,
  // taking a little damage and a shove.
  private resolveKnife(actor: string, stroke: KnifeStroke, pose: PlayerPose, seen?: Record<string, number>): void {
    const rules = KNIFE[stroke];
    const count = stroke === "slash" ? 9 : 3;
    const order = stroke === "slash" ? Array.from({ length: count }, (_, index) => index / (count - 1)) : [0.5, 0, 1];
    let center = shotRay(this.data, pose, "knife", rules.reach);
    // Straight into a shut door, the blow kicks it open, even if the swing would clip the frame.
    const ahead = (this.world?.traceBullet(center) ?? []).find((hit) => hit.material !== "boundary");
    if (ahead?.entity && this.kick(actor, ahead.entity, center, ahead.point)) {
      this.emit({ kind: "shot", actor, weapon: "knife", stroke, shot: { ...center, distance: ahead.distance }, impact: false });
      return;
    }
    for (const t of order) {
      // Screen right is lower heading; the swing runs from right to left and high to low.
      const swept = { ...pose, heading: (pose.heading - rules.arc / 2 + rules.arc * t + 360) % 360, pitch: Math.max(-80, Math.min(80, pose.pitch + rules.drop / 2 - rules.drop * t)) };
      const ray = shotRay(this.data, swept, "knife", rules.reach);
      if (t === 0.5) center = ray;
      const surface = (this.world?.traceBullet(ray) ?? []).find((hit) => hit.material !== "boundary");
      let body: { id: string; target: PlayerPose; distance: number; zone: HitZone; arm?: boolean } | null = null;
      for (const id of this.poses.keys()) {
        if (id === actor || (this.snapshot.players[id]?.health ?? 0) <= 0 || this.now - (this.poseTimes.get(id) ?? 0) > 1500) continue;
        const target = this.poseAt(id, seen?.[id]);
        const hit = target && targetHit(this.data, swept, target, "knife", rules.reach);
        if (target && hit && hit.distance <= rules.reach && (!body || hit.distance < body.distance)) body = { id, target, distance: hit.distance, zone: hit.zone, arm: hit.arm };
      }
      if (body && (!surface || body.distance <= surface.distance)) {
        const behind = fromBehind(pose, body.target);
        this.emit({ kind: "shot", actor, weapon: "knife", stroke, shot: { ...ray, distance: body.distance }, impact: false });
        this.hurt(body.id, knifeDamage(stroke, body.zone, behind), { kind: "hit", actor, target: body.id, weapon: "knife", cause: "knife", stroke, behind, zone: body.zone, arm: body.arm, from: ray.origin });
        return;
      }
      if (surface) {
        // A blade driven into a shut door kicks it open instead of cutting it.
        if (surface.entity && this.kick(actor, surface.entity, ray, surface.point)) {
          this.emit({ kind: "shot", actor, weapon: "knife", stroke, shot: { ...ray, distance: surface.distance }, impact: false });
          return;
        }
        if (surface.entity) {
          const push = rules.impulse, d = ray.direction;
          this.damageEntity(actor, surface.entity, rules.damage.torso * MATERIALS[surface.material].bullet, surface.point, { x: d.x * push, y: d.y * push, z: d.z * push });
        }
        this.emit({ kind: "shot", actor, weapon: "knife", stroke, shot: { ...ray, distance: surface.distance }, impact: true,
          impacts: [{ ...surface.point, nx: surface.normal.x, ny: surface.normal.y, nz: surface.normal.z, material: surface.material }] });
        return;
      }
    }
    this.emit({ kind: "shot", actor, weapon: "knife", stroke, shot: center, impact: false });
  }

  // A blade driven into a door is a kick instead: a boot's momentum at the spot struck, enough to
  // burst the latch. Whatever is piled behind the door takes the blow through it, so a heavy
  // barricade holds and a light one gives. False if the entity is no door leaf.
  private kick(actor: string, leaf: string, ray: ShotRay, point: Vec3): boolean {
    const toggle = this.data.layout.toggles.find((item) => item.id.startsWith("door:") && leaf.startsWith(`${item.id}:`));
    if (!toggle) return false;
    if (this.world?.swingDoor) {
      const d = ray.direction, flat = Math.hypot(d.x, d.z) || 1;
      this.world.push(leaf, point, { x: d.x / flat * KICK_IMPULSE, y: 0, z: d.z / flat * KICK_IMPULSE });
    } else {
      if (this.snapshot.open[toggle.id] ?? toggle.open) return false;
      this.snapshot.open[toggle.id] = true;
    }
    this.lastUse.set(toggle.id, this.now);
    this.emit({ kind: "use", actor, entity: toggle.id, open: true, weapon: "knife" });
    return true;
  }

  // A round travels through surfaces and bodies in order, spending penetration power on
  // each and dealing what it has left. Objects it crosses take damage by their material.
  private resolveShot(actor: string, weapon: GunKind, origin: PlayerPose, seen?: Record<string, number>): void {
    const ray = shotRay(this.data, origin, weapon);
    const items: ({ distance: number; surface: SurfaceHit } | { distance: number; body: string; zone: HitZone; arm?: boolean })[] = [];
    for (const surface of this.world?.traceBullet(ray) ?? []) items.push({ distance: surface.distance, surface });
    for (const id of this.poses.keys()) {
      if (id === actor || (this.snapshot.players[id]?.health ?? 0) <= 0 || this.now - (this.poseTimes.get(id) ?? 0) > 1500) continue;
      const target = this.poseAt(id, seen?.[id]);
      const hit = target && targetHit(this.data, origin, target, weapon);
      if (hit && hit.distance <= ray.distance) items.push({ distance: hit.distance, body: id, zone: hit.zone, arm: hit.arm });
    }
    items.sort((a, b) => a.distance - b.distance);
    const full = PENETRATION[weapon];
    let power = PENETRATION[weapon];
    let end = ray.distance, stopped = false;
    const impacts: Impact[] = [];
    const hits: Omit<CombatEvent, "id">[] = [];
    const direction = ray.direction;
    for (const item of items) {
      const share = Math.max(0, power) / full;
      if ("body" in item) {
        const victim = this.snapshot.players[item.body];
        if (!victim || victim.health <= 0) continue;
        const damage = Math.round(damageAt(weapon, { distance: item.distance, zone: item.zone }) * share);
        hits.push({ kind: "hit", actor, target: item.body, weapon, cause: weapon, damage, zone: item.zone, arm: item.arm, from: ray.origin });
        power -= BODY_COST;
        if (power <= 0) { end = item.distance; break; }
        continue;
      }
      const surface = item.surface;
      const rule = MATERIALS[surface.material];
      if (surface.material === "boundary") continue;
      impacts.push({ ...surface.point, nx: surface.normal.x, ny: surface.normal.y, nz: surface.normal.z, material: surface.material });
      if (surface.entity) {
        const strength = BULLET_IMPULSE[weapon] * Math.max(0.3, share);
        this.damageEntity(actor, surface.entity, WEAPONS[weapon].damage * share * rule.bullet, surface.point, { x: direction.x * strength, y: direction.y * strength, z: direction.z * strength });
      }
      const cost = rule.resistance * Math.max(0.02, surface.thickness);
      if (power <= cost) { end = surface.distance; stopped = true; break; }
      power -= cost;
      const exit = surface.distance + surface.thickness;
      impacts.push({ x: ray.origin.x + direction.x * exit, y: ray.origin.y + direction.y * exit, z: ray.origin.z + direction.z * exit, nx: direction.x, ny: direction.y, nz: direction.z, material: surface.material, exit: true });
    }
    this.emit({ kind: "shot", actor, weapon, shot: { ...ray, distance: end }, impact: stopped, impacts: impacts.slice(0, 24) });
    for (const hit of hits) this.hurt(hit.target!, hit.damage ?? 0, hit);
  }

  // A destroyed gas cylinder vents, then bursts where it stood; whoever broke it caused the blast.
  private damageEntity(actor: string, id: string, amount: number, point: Vec3, impulse: Vec3): void {
    const info = this.world?.entity(id);
    if (!info) return;
    const current = this.snapshot.entities[id] ?? info.maxHealth;
    if (current <= 0 || this.snapshot.taken.includes(id)) return;
    if (impulse.x || impulse.y || impulse.z) this.world?.push(id, point, impulse);
    if (!Number.isFinite(info.maxHealth) || amount <= 0) return;
    const health = Math.max(0, Math.round((current - amount) * 10) / 10);
    this.snapshot.entities[id] = health;
    if (health <= 0 && info.kind === "extinguisher") this.douse(info.center);
    if (health > 0 || !info.explosive) return;
    const vent = this.emit({ kind: "vent", actor, entity: id, position: info.center, fuseMs: VENT_MS });
    this.snapshot.grenades.push({ id: vent, actor, explodeAt: this.now + VENT_MS, position: info.center, entity: id });
  }

  private hurt(targetId: string, amount: number, event: Omit<CombatEvent, "id">): void {
    if (this.snapshot.round.phase === "over") return;
    const victim = this.snapshot.players[targetId];
    const damage = Math.min(victim?.health ?? 0, Math.max(0, Math.round(amount)));
    if (!victim || damage <= 0) return;
    victim.health -= damage;
    this.bandaging.delete(targetId);
    if (victim.health > 0) this.wound(victim, targetId, damage, event);
    if (victim.health === 0) {
      victim.deaths += 1;
      victim.respawnAfter = this.now + 3000;
      victim.reloadUntil = 0;
      victim.bleedUntil = 0;
      victim.bleedBy = "";
      victim.powder = 0;
      victim.burnUntil = 0;
      victim.burnBy = "";
      this.drips.delete(targetId);
      this.dropLoot(targetId, victim, event.cause === "fall" ? undefined : event.from);
      const killer = this.snapshot.players[event.actor];
      if (killer && event.actor !== targetId) killer.kills += 1;
    }
    this.emit({ ...event, kind: victim.health === 0 ? "death" : "hit", target: targetId, damage });
  }

  // What a blow leaves behind. Legs are hurt by hits to them and by hard landings, arms by hits
  // on the arm, and anything that breaks the skin deeply enough bleeds, for longer with each.
  private wound(victim: CombatPlayer, id: string, damage: number, event: Omit<CombatEvent, "id">): void {
    const worse = (now: number, by: number): number => Math.min(1, Math.round((now + by) * 100) / 100);
    if (event.zone === "legs" || event.cause === "fall") victim.leg = worse(victim.leg, damage / LEG_WOUND_DAMAGE);
    if (event.arm) victim.arm = worse(victim.arm, damage / ARM_WOUND_DAMAGE);
    if (!CUTTING.includes(event.cause) || damage < BLEED_MIN_DAMAGE) return;
    victim.bleedUntil = Math.min(this.now + BLEED_LONGEST_MS, Math.max(victim.bleedUntil, this.now) + BLEED_PER_WOUND_MS);
    victim.bleedBy = event.actor;
    this.drips.set(id, this.drips.get(id) ?? this.now + BLEED_DRIP_MS);
  }

  // Bandages finishing, and wounds losing blood. A bleed is not a blow: it flashes nothing and
  // credits nobody until the last point, which counts as the kill of whoever opened it.
  private tendWounds(now: number): boolean {
    let changed = false;
    for (const [id, player] of Object.entries(this.snapshot.players)) {
      if (now >= (this.bandaging.get(id) ?? Infinity)) {
        this.bandaging.delete(id);
        if (player.health > 0 && player.bandages > 0) {
          const ease = (wound: number): number => (wound < 0.1 ? 0 : Math.round(wound * 50) / 100);
          player.bandages -= 1;
          player.bleedUntil = 0;
          player.bleedBy = "";
          player.leg = ease(player.leg);
          player.arm = ease(player.arm);
          this.drips.delete(id);
          this.emit({ kind: "bandage", actor: id });
          changed = true;
        }
      }
      if (!player.bleedUntil) continue;
      if (player.health <= 0 || now >= player.bleedUntil) {
        player.bleedUntil = 0;
        player.bleedBy = "";
        this.drips.delete(id);
        changed = true;
        continue;
      }
      const due = this.drips.get(id);
      if (due === undefined) { this.drips.set(id, now + BLEED_DRIP_MS); continue; }
      if (now < due || this.snapshot.round.phase === "over") continue;
      this.drips.set(id, now + BLEED_DRIP_MS);
      if (player.health > 1) player.health -= 1;
      else this.hurt(id, 1, { kind: "hit", actor: this.snapshot.players[player.bleedBy] ? player.bleedBy : id, target: id, cause: "bleed" });
      changed = true;
    }
    return changed;
  }

  // Landing faster than a safe speed hurts. The drop has to show in the player's recent
  // pose history, so a client cannot claim a fall it never made, or a bigger one.
  private fall(actor: string, claimed: number): boolean {
    if (!finite(claimed) || claimed <= FALL_SAFE_SPEED || claimed > 40) return false;
    const history = this.history.get(actor) ?? [];
    if (!history.length) return false;
    const newest = history[history.length - 1];
    const top = Math.max(...history.filter((entry) => entry.time >= newest.time - 3000).map((entry) => entry.pose.jumpHeight));
    const drop = Math.max(0, top - newest.pose.jumpHeight);
    const speed = Math.min(claimed, Math.sqrt(2 * 14 * (drop + 0.6)) + 1);
    // A heavier landing carries more energy into the legs.
    const player = this.snapshot.players[actor];
    const damage = Math.round((speed - FALL_SAFE_SPEED) * FALL_DAMAGE_PER_MS * (player ? loadEffects(carriedMass(player)).inertia : 1));
    if (damage <= 0) return false;
    this.hurt(actor, damage, { kind: "hit", actor, cause: "fall" });
    this.changed();
    return true;
  }

  // A grenade bursts where it came to rest. Damage falls off with distance and with how
  // much of the body the blast can reach past cover; objects in range take blast damage
  // by material and loose ones are thrown outward.
  private explode(grenade: LiveGrenade): void {
    const center = grenade.position;
    // A smoke grenade only pops; every peer draws the cloud from this event.
    if (grenade.smoke) { this.emit({ kind: "smoke", actor: grenade.actor, position: center, grenade: grenade.id }); return; }
    this.emit({ kind: "explode", actor: grenade.actor, position: center, grenade: grenade.id, entity: grenade.entity });
    const lifted = { x: center.x, y: center.y + 0.2, z: center.z };
    const clear = (to: Vec3): boolean => {
      const dx = to.x - lifted.x, dy = to.y - lifted.y, dz = to.z - lifted.z, distance = Math.hypot(dx, dy, dz);
      return distance < 0.05 || (this.world?.clearShot({ origin: lifted, direction: { x: dx / distance, y: dy / distance, z: dz / distance }, distance: Math.max(0, distance - 0.3) }) ?? true);
    };
    for (const [id, pose] of this.poses) {
      if ((this.snapshot.players[id]?.health ?? 0) <= 0 || this.now - (this.poseTimes.get(id) ?? 0) > 1500) continue;
      const ground = terrainHeight(this.data, pose.east, pose.north) + pose.jumpHeight;
      const chest = { x: pose.east, y: ground + (pose.crouching ? 0.7 : 1.05), z: pose.north };
      const head = { x: pose.east, y: ground + (pose.crouching ? 1.1 : 1.65), z: pose.north };
      const distance = Math.hypot(chest.x - center.x, chest.y - center.y, chest.z - center.z);
      if (distance >= BLAST_RADIUS) continue;
      const exposed = Number(clear(chest)) + Number(clear(head));
      const damage = BLAST_DAMAGE * (1 - distance / BLAST_RADIUS) ** 1.4 * [0.15, 0.65, 1][exposed];
      this.hurt(id, damage, { kind: "hit", actor: grenade.actor, cause: "grenade", from: center });
    }
    for (const entity of this.world?.entitiesNear(center, BLAST_RADIUS) ?? []) {
      const info = this.world?.entity(entity.id);
      if (!info) continue;
      const strength = 1 - entity.distance / BLAST_RADIUS;
      const dx = entity.point.x - center.x, dy = entity.point.y - center.y + 0.4, dz = entity.point.z - center.z, length = Math.hypot(dx, dy, dz) || 1;
      const push = BLAST_IMPULSE * strength;
      this.damageEntity(grenade.actor, entity.id, BLAST_ENTITY_DAMAGE * strength * MATERIALS[info.material].blast, entity.point, { x: dx / length * push, y: dy / length * push, z: dz / length * push });
      if (this.snapshot.entities[entity.id] !== 0) this.warm(entity.id, (grenade.entity ? FUEL_HEAT : FRAG_HEAT) * strength, grenade.actor);
      // Burning fuel, or a frag right beside cardboard, leaves what it tore apart alight.
      else if (catchesAt(info.material) && (grenade.entity || (info.material === "cardboard" && strength > FRAG_LIGHTS)) && this.snapshot.fires.length < MAX_FIRES) this.snapshot.fires.push({ position: { ...entity.point }, radius: SCRAPS_RADIUS, until: this.now + SCRAPS_MS, by: grenade.actor });
    }
    // What was in a drum or tank goes everywhere, alight.
    if (grenade.entity && this.snapshot.fires.length < MAX_FIRES) this.snapshot.fires.push({ position: { ...center }, radius: POOL_RADIUS, until: this.now + POOL_MS, by: grenade.actor });
  }

  // Heats something up: past what it can take it catches, or a fuel drum or gas tank goes off.
  private warm(id: string, amount: number, by: string): void {
    const info = this.world?.entity(id);
    if (!info || this.snapshot.entities[id] === 0) return;
    const catches = info.explosive ? EXPLOSIVE_CATCHES : catchesAt(info.material);
    if (!catches || !Number.isFinite(info.maxHealth) || this.burning(id)) return;
    const heat = (this.heat.get(id) ?? 0) + amount;
    if (heat < catches) { this.heat.set(id, heat); return; }
    this.heat.delete(id);
    if (info.explosive) this.damageEntity(by, id, info.maxHealth, info.center, { x: 0, y: 0, z: 0 });
    else if (this.snapshot.fires.length < MAX_FIRES) this.snapshot.fires.push({ entity: id, position: { ...info.center }, radius: info.size + 0.35, until: 0, by });
  }

  // Heat from something burning, into whatever is near it and not behind a wall.
  private radiate(position: Vec3, size: number, self: string | undefined, by: string, seconds: number): void {
    for (const near of this.world?.entitiesNear(position, size + 5) ?? []) {
      const info = near.id === self ? null : this.world?.entity(near.id);
      if (!info) continue;
      const reach = FIRE_REACH + size + info.size;
      if (near.distance < reach && !this.world?.walled(position, near.point)) this.warm(near.id, FIRE_HEAT * seconds * (1 - near.distance / reach), by);
    }
  }

  // A burst extinguisher's powder smothers the flames around it and cools what they had heated.
  private douse(center: Vec3): void {
    this.snapshot.fires = this.snapshot.fires.filter((fire) => Math.hypot(fire.position.x - center.x, fire.position.y - center.y, fire.position.z - center.z) > DOUSE_RADIUS);
    for (const near of this.world?.entitiesNear(center, DOUSE_RADIUS) ?? []) this.heat.delete(near.id);
  }

  // Twice a second: what is burning wears away, warms what is near it and burns whoever is in it.
  private stepFires(now: number): boolean {
    const seconds = FIRE_STEP_MS / 1000;
    const venting = this.snapshot.grenades.filter((grenade) => grenade.entity && !grenade.smoke);
    const stoves = this.data.layout.toggles.filter((toggle) => toggle.id.startsWith("stove:") && (this.snapshot.open[toggle.id] ?? toggle.open));
    const aflame = Object.entries(this.snapshot.players).filter(([, player]) => player.burnUntil > 0);
    if (!this.snapshot.fires.length && !venting.length && !this.heat.size && !stoves.length && !aflame.length) return false;
    const before = this.snapshot.fires.length;
    for (const [id, heat] of this.heat) { if (heat <= 4) this.heat.delete(id); else this.heat.set(id, heat - 4); }
    // A drum or tank venting flame heats what stands around it until it bursts.
    for (const grenade of venting) this.radiate(grenade.position, 0.5, grenade.entity, grenade.actor, seconds);
    // A lit stove reaches only what is put on it.
    for (const stove of stoves) for (const offset of [-0.5, 0, 0.5]) this.radiate({ x: stove.at.x, y: stove.at.y + 0.3, z: stove.at.z + offset * (stove.id === "stove:restaurant" ? 2 : 1) }, -0.6, undefined, this.stoveBy.get(stove.id) ?? "", seconds);
    const burned = new Set<string>();
    for (const fire of [...this.snapshot.fires]) {
      if (fire.entity) {
        const info = this.world?.entity(fire.entity);
        if (!info || this.snapshot.entities[fire.entity] === 0) { this.snapshot.fires = this.snapshot.fires.filter((other) => other !== fire); continue; }
        fire.position = { x: Math.round(info.center.x * 100) / 100, y: Math.round(info.center.y * 100) / 100, z: Math.round(info.center.z * 100) / 100 };
        this.damageEntity(fire.by, fire.entity, info.maxHealth * seconds / burnSeconds(info.material, info.mass), info.center, { x: 0, y: 0, z: 0 });
      } else if (now >= fire.until) { this.snapshot.fires = this.snapshot.fires.filter((other) => other !== fire); continue; }
      this.radiate(fire.position, fire.radius, fire.entity, fire.by, seconds);
      for (const [id, pose] of this.poses) {
        if (burned.has(id) || (this.snapshot.players[id]?.health ?? 0) <= 0 || now - (this.poseTimes.get(id) ?? 0) > 1500) continue;
        const feet = terrainHeight(this.data, pose.east, pose.north) + pose.jumpHeight;
        if (Math.hypot(pose.east - fire.position.x, pose.north - fire.position.z) > fire.radius + 0.3 || feet > fire.position.y + 1.5 || feet + 1.8 < fire.position.y - 1) continue;
        burned.add(id);
        const player = this.snapshot.players[id];
        player.burnUntil = now + BURN_MS;
        player.burnBy = this.snapshot.players[fire.by] ? fire.by : id;
        this.hurt(id, FIRE_DAMAGE, { kind: "hit", actor: player.burnBy, target: id, cause: "fire", from: fire.position });
      }
    }
    // Out of the flames, a burning player goes on burning for a while, and sets light to what
    // they brush against. Getting down low smothers it twice as fast.
    for (const [id, player] of aflame) {
      if (burned.has(id) || player.health <= 0) continue;
      const pose = this.poses.get(id);
      if (pose?.crouching) player.burnUntil -= FIRE_STEP_MS;
      if (now >= player.burnUntil) { player.burnUntil = 0; player.burnBy = ""; continue; }
      if (pose) this.radiate({ x: pose.east, y: terrainHeight(this.data, pose.east, pose.north) + pose.jumpHeight + 0.9, z: pose.north }, -0.7, undefined, player.burnBy, seconds);
      this.hurt(id, BURN_DAMAGE, { kind: "hit", actor: player.burnBy, target: id, cause: "fire" });
    }
    return before > 0 || this.snapshot.fires.length > 0 || venting.length > 0 || aflame.length > 0;
  }

  tick(now = Date.now()): boolean {
    this.now = now;
    let changed = false;
    for (const id of this.snapshot.taken) {
      if (now >= (this.snapshot.pickupReturns[id] ?? Infinity)) {
        this.snapshot.taken = this.snapshot.taken.filter((takenId) => takenId !== id);
        delete this.snapshot.pickupReturns[id];
        changed = true;
      }
    }
    for (const player of Object.values(this.snapshot.players)) {
      if (player.reloadUntil > 0 && now >= player.reloadUntil) {
        player.reloadUntil = 0;
        const gun = player.active;
        if (gun !== "knife" && player.mags[gun].length) {
          const spares = player.mags[gun];
          const fresh = spares.splice(spares.indexOf(Math.max(...spares)), 1)[0];
          const chamber = player.ammo[gun] > 0 ? 1 : 0, left = player.ammo[gun] - chamber;
          if (left > 0) spares.push(left);
          player.ammo[gun] = fresh + chamber;
        }
        changed = true;
      }
    }
    if (this.snapshot.drops.some((drop) => now >= drop.expires)) {
      this.snapshot.drops = this.snapshot.drops.filter((drop) => now < drop.expires);
      changed = true;
    }
    const due = this.snapshot.grenades.filter((grenade) => now >= grenade.explodeAt);
    if (due.length) {
      this.snapshot.grenades = this.snapshot.grenades.filter((grenade) => now < grenade.explodeAt);
      for (const grenade of due) this.explode(grenade);
      changed = true;
    }
    if (this.tendWounds(now)) changed = true;
    if (now >= this.fireStepAt) {
      this.fireStepAt = now + FIRE_STEP_MS;
      if (this.stepFires(now)) changed = true;
    }
    if (this.advanceRound(now)) changed = true;
    if (changed) this.changed();
    return changed;
  }

  // Moves the round on: warm-up to a countdown once two players are in the game, the countdown
  // to a round, a round to the wait after it at the time or kill limit, and that wait to the
  // next round. Fewer than two players in the game puts the room back in warm-up.
  private advanceRound(now: number): boolean {
    const round = this.snapshot.round;
    const playing = Object.keys(this.snapshot.players).filter((id) => this.present.has(id)).length;
    if (playing < 2) {
      if (round.phase === "warmup") return false;
      this.snapshot.round = { ...round, phase: "warmup", until: 0, winner: "" };
      return true;
    }
    if (round.phase === "warmup") {
      this.snapshot.round = { ...round, phase: "countdown", until: now + COUNTDOWN_MS, winner: "" };
      return true;
    }
    if (round.phase === "live") {
      const [first, second] = standings(this.snapshot.players);
      if (now < round.until && (first?.kills ?? 0) < KILL_LIMIT) return false;
      const draw = !first || (!!second && second.kills === first.kills && second.deaths === first.deaths);
      this.snapshot.round = { ...round, phase: "over", until: now + INTERMISSION_MS, winner: draw ? "" : first.id };
      return true;
    }
    if (now < round.until) return false;
    this.startRound(now);
    return true;
  }

  // A new round: everyone starts again with nothing found and no score, and the market is as it
  // was built. Its event tells each peer to reset its own world and player.
  private startRound(now: number): void {
    this.snapshot.round = { number: this.snapshot.round.number + 1, phase: "live", until: now + ROUND_MS, winner: "" };
    for (const [id, player] of Object.entries(this.snapshot.players)) {
      Object.assign(player, freshPlayer(), { intent: player.intent, name: player.name, voice: player.voice });
      this.removePose(id);
    }
    Object.assign(this.snapshot, { taken: [], pickupReturns: {}, entities: {}, grenades: [], drops: [], open: {}, fires: [] });
    this.heat.clear();
    for (const map of [this.lastAttack, this.lastThrow, this.bloom, this.lastStroke, this.equipUntil, this.lastUse, this.lastStruck, this.lastSmash, this.drips, this.bandaging]) map.clear();
    this.emit({ kind: "round", actor: "" });
  }

  private emit(event: Omit<CombatEvent, "id">): number {
    const id = ++this.snapshot.eventSeq;
    this.snapshot.events.push({ ...event, id } as CombatEvent);
    if (this.snapshot.events.length > EVENTS_KEPT) this.snapshot.events.splice(0, this.snapshot.events.length - EVENTS_KEPT);
    return id;
  }

  private changed(): void {
    this.snapshot.revision += 1;
    this.onChange(this.snapshot);
  }
}
