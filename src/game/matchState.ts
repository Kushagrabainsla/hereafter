import { type ArenaData, terrainHeight } from "../world/arena";
import {
  targetHit, damageAt, shotRay, makeWeaponPickups, bloomAfterShot, currentBloom, deviateAim, spreadDegrees, carriedMass, fromBehind, knifeDamage, loadEffects,
  KNIFE, MAGAZINES_PER_PICKUP, MAX_SPARE_MAGAZINES, PICKUP_HEIGHT, PICKUP_REACH, WEAPONS,
  type GunKind, type HitZone, type KnifeStroke, type WeaponKind, type WeaponPickup,
} from "./combatRules";
import { type ShotRay } from "../world/physics";
import { type PlayerPose } from "./playerController";
import { BODY_COST, MATERIALS, PENETRATION, type Material } from "../world/materials";

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
  reloadUntil: number;
  respawnAfter: number;
  kills: number;
  deaths: number;
}

export type CombatIntent =
  // seen maps each target to the moment of its own pose timeline the shooter was looking at.
  // A knife attack names its stroke and arrives when the blade reaches the target.
  | { kind: "attack"; weapon: WeaponKind; stroke?: KnifeStroke; aim?: { heading: number; pitch: number }; seen?: Record<string, number> }
  | { kind: "pickup"; pickupId: string }
  | { kind: "reload" }
  | { kind: "select"; weapon: WeaponKind }
  | { kind: "respawn" }
  | { kind: "throw"; aim: { heading: number; pitch: number } }
  // Open or close something the map lets players open, such as a door or a hatch.
  | { kind: "use"; target: string }
  | { kind: "fall"; speed: number };

export type DamageCause = WeaponKind | "grenade" | "fall";

export interface Impact { x: number; y: number; z: number; nx: number; ny: number; nz: number; material: Material; exit?: boolean }

export interface CombatEvent {
  id: number;
  kind: "shot" | "hit" | "pickup" | "death" | "respawn" | "throw" | "explode" | "reload" | "drop" | "use" | "vent";
  actor: string;
  target?: string;
  weapon?: WeaponKind;
  cause?: DamageCause;
  damage?: number;
  zone?: HitZone;
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
  // What a pickup was: a gun, spare magazines or something a fallen player dropped.
  item?: "gun" | "magazines" | "drop";
  // A reload that threw away an empty magazine.
  dropped?: boolean;
  // The dropped item a "drop" event made.
  drop?: string;
  // The door, hatch or gas cylinder a "use", "vent" or "explode" event concerns.
  entity?: string;
  // Whether a "use" event opened or closed it.
  open?: boolean;
}

// A gun or magazines a fallen player dropped. It falls from their hands along from and
// velocity to position, where it lies until someone takes it or it expires.
export interface Drop { id: string; weapon: GunKind; gun: boolean; rounds: number; mags: number[]; from: Vec3; velocity: Vec3; position: Vec3; expires: number }

// A grenade in flight or a gas cylinder venting, until it bursts; entity names the cylinder.
export interface LiveGrenade { id: number; actor: string; explodeAt: number; position: Vec3; entity?: string }

export interface CombatSnapshot {
  version: 5;
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
  // The most recent events, oldest first; peers play every event newer than the last they saw.
  events: CombatEvent[];
}

// What the coordinating peer asks of the physical world.
export interface SurfaceHit { distance: number; thickness: number; point: Vec3; normal: Vec3; material: Material; entity?: string }
export interface CombatWorld {
  clearShot(ray: ShotRay): boolean;
  traceBullet(ray: ShotRay): SurfaceHit[];
  entity(id: string): { material: Material; maxHealth: number; center: Vec3; explosive?: boolean } | null;
  entitiesNear(center: Vec3, radius: number): { id: string; distance: number; point: Vec3 }[];
  grenadeRest(origin: Vec3, velocity: Vec3, seconds: number): Vec3;
  push(entity: string, point: Vec3, impulse: Vec3): void;
}

const EVENTS_KEPT = 32;
const DROPS_KEPT = 12;
const DROP_LIFE_MS = 60_000;
const GUN_RETURN_MS = 30_000;
const MAGAZINE_RETURN_MS = 25_000;
const GRENADES_PER_LIFE = 2;
const GRENADE_FUSE_MS = 2600;
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
const MATERIAL_NAMES = Object.keys(MATERIALS);
const EVENT_KINDS = ["shot", "hit", "pickup", "death", "respawn", "throw", "explode", "reload", "drop", "use", "vent"];
// A shot gas cylinder vents burning gas for this long, then bursts like a grenade.
const VENT_MS = 1600;
// How far a player can reach to open or close something, from the eyes.
const USE_REACH = 2.3;
const GUNS = ["pistol", "rifle"] as const;
const CAUSES = ["knife", "pistol", "rifle", "grenade", "fall"];

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
    && (event.item === undefined || ["gun", "magazines", "drop"].includes(event.item))
    && (event.drop === undefined || (typeof event.drop === "string" && event.drop.length < 40))
    && (event.entity === undefined || (typeof event.entity === "string" && event.entity.length < 40))
    && (event.open === undefined || typeof event.open === "boolean");
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
  return { health: 100, owned: ["knife"], active: "knife", ammo: { pistol: 0, rifle: 0 }, mags: { pistol: [], rifle: [] }, grenades: GRENADES_PER_LIFE, reloadUntil: 0, respawnAfter: 0, kills: 0, deaths: 0 };
}

function validPlayer(player: CombatPlayer): boolean {
  const validWeapon = (weapon: unknown): weapon is WeaponKind => weapon === "knife" || weapon === "pistol" || weapon === "rifle";
  return Number.isInteger(player.health) && player.health >= 0 && player.health <= 100
    && Array.isArray(player.owned) && player.owned.every(validWeapon) && player.owned.includes("knife")
    && validWeapon(player.active) && player.owned.includes(player.active)
    && GUNS.every((gun) => Number.isInteger(player.ammo?.[gun]) && player.ammo[gun] >= 0 && player.ammo[gun] <= WEAPONS[gun].magazine + 1 && validMagazines(gun, player.mags?.[gun]))
    && Number.isInteger(player.grenades) && player.grenades >= 0 && player.grenades <= GRENADES_PER_LIFE
    && Number.isFinite(player.reloadUntil) && player.reloadUntil >= 0
    && Number.isFinite(player.respawnAfter) && player.respawnAfter >= 0
    && Number.isSafeInteger(player.kills) && player.kills >= 0
    && Number.isSafeInteger(player.deaths) && player.deaths >= 0;
}

function emptySnapshot(): CombatSnapshot {
  return { version: 5, revision: 0, eventSeq: 0, players: {}, taken: [], pickupReturns: {}, entities: {}, grenades: [], drops: [], open: {}, events: [] };
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
    this.onChange(this.snapshot);
  }

  getState(): CombatSnapshot { return structuredClone(this.snapshot); }
  player(id: string): CombatPlayer | undefined { return this.snapshot.players[id]; }

  // time is the moment on the sender's own clock; the local player uses this clock.
  setPose(id: string, pose: PlayerPose, time = Date.now()): void {
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

  adopt(incoming: CombatSnapshot): boolean {
    if (!incoming || incoming.version !== 5 || !Number.isSafeInteger(incoming.revision) || incoming.revision < 0 || !Number.isSafeInteger(incoming.eventSeq)
      || !incoming.players || !Array.isArray(incoming.taken) || !incoming.pickupReturns || typeof incoming.pickupReturns !== "object"
      || !incoming.entities || typeof incoming.entities !== "object" || !Array.isArray(incoming.grenades) || !Array.isArray(incoming.drops) || !Array.isArray(incoming.events)
      || !incoming.open || typeof incoming.open !== "object") return false;
    const morePlayers = Object.keys(incoming.players).length > Object.keys(this.snapshot.players).length;
    if (incoming.revision < this.snapshot.revision || (incoming.revision === this.snapshot.revision && !morePlayers)) return false;
    const players: Record<string, CombatPlayer> = {};
    for (const [id, player] of Object.entries(incoming.players)) {
      if (!player || !validPlayer(player)) return false;
      players[id] = structuredClone(player);
    }
    const pickupReturns: Record<string, number> = {};
    for (const pickup of this.pickups) {
      const due = incoming.pickupReturns[pickup.id];
      if (Number.isFinite(due) && due >= 0) pickupReturns[pickup.id] = due;
    }
    const entities: Record<string, number> = {};
    for (const [id, health] of Object.entries(incoming.entities)) if (id.length < 64 && finite(health) && health >= 0 && health <= 100_000) entities[id] = health;
    const grenades = incoming.grenades.filter((grenade) => grenade && Number.isSafeInteger(grenade.id) && typeof grenade.actor === "string" && finite(grenade.explodeAt) && validVec(grenade.position)
      && (grenade.entity === undefined || (typeof grenade.entity === "string" && grenade.entity.length < 40))).slice(0, 16);
    const open: Record<string, boolean> = {};
    for (const toggle of this.data.layout.toggles) if (typeof incoming.open[toggle.id] === "boolean") open[toggle.id] = incoming.open[toggle.id];
    const drops = incoming.drops.filter(validDrop).slice(-DROPS_KEPT);
    const events = incoming.events.filter(validEvent).slice(-EVENTS_KEPT).map((event) => structuredClone(event));
    this.snapshot = { version: 5, revision: incoming.revision, eventSeq: incoming.eventSeq, players, taken: incoming.taken.filter((id) => this.pickups.some((pickup) => pickup.id === id)), pickupReturns, entities, grenades: structuredClone(grenades), drops: structuredClone(drops), open, events };
    this.onChange(this.snapshot);
    return true;
  }

  apply(actor: string, intent: CombatIntent, now = Date.now()): boolean {
    this.now = now;
    const player = this.snapshot.players[actor];
    if (!player) return false;
    if (intent.kind === "respawn") {
      if (player.health > 0 || now < player.respawnAfter) return false;
      const { kills, deaths } = player;
      Object.assign(player, freshPlayer(), { kills, deaths });
      this.removePose(actor);
      this.emit({ kind: "respawn", actor });
      this.changed();
      return true;
    }
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
      player.reloadUntil = now + WEAPONS[gun].reloadMs;
      this.emit({ kind: "reload", actor, weapon: gun, dropped: loaded - chamber <= 0 });
      this.changed();
      return true;
    }
    if (intent.kind === "fall") return this.fall(actor, intent.speed);
    if (intent.kind === "use") {
      const toggle = this.data.layout.toggles.find((item) => item.id === intent.target);
      if (!toggle || !pose || !fresh || now - (this.lastUse.get(toggle.id) ?? 0) < 500) return false;
      const eye = shotRay(this.data, pose, "knife").origin;
      if (Math.hypot(eye.x - toggle.at.x, eye.y - toggle.at.y, eye.z - toggle.at.z) > USE_REACH) return false;
      const open = !(this.snapshot.open[toggle.id] ?? toggle.open);
      this.snapshot.open[toggle.id] = open;
      this.lastUse.set(toggle.id, now);
      this.emit({ kind: "use", actor, entity: toggle.id, open });
      this.changed();
      return true;
    }
    if (intent.kind === "throw") {
      const aim = intent.aim;
      if (!pose || !fresh || player.grenades <= 0 || now - (this.lastThrow.get(actor) ?? 0) < THROW_COOLDOWN_MS
        || !aim || !finite(aim.heading, aim.pitch) || Math.abs(aim.pitch) > 80) return false;
      this.lastThrow.set(actor, now);
      player.grenades -= 1;
      const yaw = aim.heading * Math.PI / 180, pitch = aim.pitch * Math.PI / 180;
      const forward = { x: Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: Math.cos(yaw) * Math.cos(pitch) };
      const eye = shotRay(this.data, pose, "pistol").origin;
      // Released from the right hand, just ahead of and below the eyes.
      const position = { x: eye.x + forward.x * 0.45 - Math.cos(yaw) * 0.18, y: eye.y - 0.12 + forward.y * 0.45, z: eye.z + forward.z * 0.45 + Math.sin(yaw) * 0.18 };
      const velocity = { x: forward.x * THROW_SPEED, y: forward.y * THROW_SPEED + 2.2, z: forward.z * THROW_SPEED };
      const rest = this.world?.grenadeRest(position, velocity, GRENADE_FUSE_MS / 1000) ?? position;
      const id = this.emit({ kind: "throw", actor, position, velocity, fuseMs: GRENADE_FUSE_MS });
      this.snapshot.events[this.snapshot.events.length - 1].grenade = id;
      this.snapshot.grenades.push({ id, actor, explodeAt: now + GRENADE_FUSE_MS, position: rest });
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
      const spread = spreadDegrees(weapon, { moving: pose.moving, crouching: pose.crouching, airborne: !!pose.airborne, sliding: !!pose.sliding }, bloom);
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
    if (ahead?.entity && this.kick(actor, ahead.entity)) {
      this.emit({ kind: "shot", actor, weapon: "knife", stroke, shot: { ...center, distance: ahead.distance }, impact: false });
      return;
    }
    for (const t of order) {
      // Screen right is lower heading; the swing runs from right to left and high to low.
      const swept = { ...pose, heading: (pose.heading - rules.arc / 2 + rules.arc * t + 360) % 360, pitch: Math.max(-80, Math.min(80, pose.pitch + rules.drop / 2 - rules.drop * t)) };
      const ray = shotRay(this.data, swept, "knife", rules.reach);
      if (t === 0.5) center = ray;
      const surface = (this.world?.traceBullet(ray) ?? []).find((hit) => hit.material !== "boundary");
      let body: { id: string; target: PlayerPose; distance: number; zone: HitZone } | null = null;
      for (const id of this.poses.keys()) {
        if (id === actor || (this.snapshot.players[id]?.health ?? 0) <= 0 || this.now - (this.poseTimes.get(id) ?? 0) > 1500) continue;
        const target = this.poseAt(id, seen?.[id]);
        const hit = target && targetHit(this.data, swept, target, "knife", rules.reach);
        if (target && hit && hit.distance <= rules.reach && (!body || hit.distance < body.distance)) body = { id, target, distance: hit.distance, zone: hit.zone };
      }
      if (body && (!surface || body.distance <= surface.distance)) {
        const behind = fromBehind(pose, body.target);
        this.emit({ kind: "shot", actor, weapon: "knife", stroke, shot: { ...ray, distance: body.distance }, impact: false });
        this.hurt(body.id, knifeDamage(stroke, body.zone, behind), { kind: "hit", actor, target: body.id, weapon: "knife", cause: "knife", stroke, behind, zone: body.zone, from: ray.origin });
        return;
      }
      if (surface) {
        // A blade driven into a shut door kicks it open instead of cutting it.
        if (surface.entity && this.kick(actor, surface.entity)) {
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

  // Opens the shut door a leaf belongs to; false if the entity is no door leaf or it is open.
  private kick(actor: string, leaf: string): boolean {
    const toggle = this.data.layout.toggles.find((item) => leaf.startsWith(`${item.id}:`));
    if (!toggle || (this.snapshot.open[toggle.id] ?? toggle.open)) return false;
    this.snapshot.open[toggle.id] = true;
    this.lastUse.set(toggle.id, this.now);
    this.emit({ kind: "use", actor, entity: toggle.id, open: true, weapon: "knife" });
    return true;
  }

  // A round travels through surfaces and bodies in order, spending penetration power on
  // each and dealing what it has left. Objects it crosses take damage by their material.
  private resolveShot(actor: string, weapon: GunKind, origin: PlayerPose, seen?: Record<string, number>): void {
    const ray = shotRay(this.data, origin, weapon);
    const items: ({ distance: number; surface: SurfaceHit } | { distance: number; body: string; zone: HitZone })[] = [];
    for (const surface of this.world?.traceBullet(ray) ?? []) items.push({ distance: surface.distance, surface });
    for (const id of this.poses.keys()) {
      if (id === actor || (this.snapshot.players[id]?.health ?? 0) <= 0 || this.now - (this.poseTimes.get(id) ?? 0) > 1500) continue;
      const target = this.poseAt(id, seen?.[id]);
      const hit = target && targetHit(this.data, origin, target, weapon);
      if (hit && hit.distance <= ray.distance) items.push({ distance: hit.distance, body: id, zone: hit.zone });
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
        hits.push({ kind: "hit", actor, target: item.body, weapon, cause: weapon, damage, zone: item.zone, from: ray.origin });
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
    if (current <= 0) return;
    this.world?.push(id, point, impulse);
    if (!Number.isFinite(info.maxHealth) || amount <= 0) return;
    const health = Math.max(0, Math.round((current - amount) * 10) / 10);
    this.snapshot.entities[id] = health;
    if (health > 0 || !info.explosive) return;
    const vent = this.emit({ kind: "vent", actor, entity: id, position: info.center, fuseMs: VENT_MS });
    this.snapshot.grenades.push({ id: vent, actor, explodeAt: this.now + VENT_MS, position: info.center, entity: id });
  }

  private hurt(targetId: string, amount: number, event: Omit<CombatEvent, "id">): void {
    const victim = this.snapshot.players[targetId];
    const damage = Math.min(victim?.health ?? 0, Math.max(0, Math.round(amount)));
    if (!victim || damage <= 0) return;
    victim.health -= damage;
    if (victim.health === 0) {
      victim.deaths += 1;
      victim.respawnAfter = this.now + 3000;
      victim.reloadUntil = 0;
      this.dropLoot(targetId, victim, event.cause === "fall" ? undefined : event.from);
      const killer = this.snapshot.players[event.actor];
      if (killer && event.actor !== targetId) killer.kills += 1;
    }
    this.emit({ ...event, kind: victim.health === 0 ? "death" : "hit", target: targetId, damage });
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
    }
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
    if (changed) this.changed();
    return changed;
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
