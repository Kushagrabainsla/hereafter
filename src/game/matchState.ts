import { type Arena, type ArenaData, terrainHeight } from "../world/arena";
import { targetHit, damageAt, shotRay, makeWeaponPickups, bloomAfterShot, currentBloom, deviateAim, spreadDegrees, WEAPONS, type HitZone, type WeaponKind, type WeaponPickup } from "./combatRules";
import { type ShotRay } from "../world/physics";
import { type PlayerPose } from "./playerController";
import { BODY_COST, MATERIALS, PENETRATION, type Material } from "../world/materials";

export interface Vec3 { x: number; y: number; z: number }

export interface CombatPlayer {
  health: number;
  owned: WeaponKind[];
  active: WeaponKind;
  ammo: { pistol: number; rifle: number };
  grenades: number;
  reloadUntil: number;
  respawnAfter: number;
  kills: number;
  deaths: number;
}

export type CombatIntent =
  // seen maps each target to the moment of its own pose timeline the shooter was looking at.
  | { kind: "attack"; weapon: WeaponKind; aim?: { heading: number; pitch: number }; seen?: Record<string, number> }
  | { kind: "pickup"; pickupId: string }
  | { kind: "reload" }
  | { kind: "select"; weapon: WeaponKind }
  | { kind: "respawn" }
  | { kind: "throw"; aim: { heading: number; pitch: number } }
  | { kind: "fall"; speed: number };

export type DamageCause = WeaponKind | "grenade" | "fall";

export interface Impact { x: number; y: number; z: number; nx: number; ny: number; nz: number; material: Material; exit?: boolean }

export interface CombatEvent {
  id: number;
  kind: "shot" | "hit" | "pickup" | "death" | "respawn" | "throw" | "explode";
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
}

export interface LiveGrenade { id: number; actor: string; explodeAt: number; position: Vec3 }

export interface CombatSnapshot {
  version: 3;
  revision: number;
  eventSeq: number;
  players: Record<string, CombatPlayer>;
  taken: string[];
  pickupReturns: Record<string, number>;
  // Health of world objects that have taken damage; 0 means destroyed.
  entities: Record<string, number>;
  grenades: LiveGrenade[];
  // The most recent events, oldest first; peers play every event newer than the last they saw.
  events: CombatEvent[];
}

// What the coordinating peer asks of the physical world.
export interface SurfaceHit { distance: number; thickness: number; point: Vec3; normal: Vec3; material: Material; entity?: string }
export interface CombatWorld {
  clearShot(ray: ShotRay): boolean;
  traceBullet(ray: ShotRay): SurfaceHit[];
  entity(id: string): { material: Material; maxHealth: number } | null;
  entitiesNear(center: Vec3, radius: number): { id: string; distance: number; point: Vec3 }[];
  grenadeRest(origin: Vec3, velocity: Vec3, seconds: number): Vec3;
  push(entity: string, point: Vec3, impulse: Vec3): void;
}

const EVENTS_KEPT = 32;
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
const BULLET_IMPULSE = { knife: 4, pistol: 2.5, rifle: 4.5 } as const;
const MATERIAL_NAMES = Object.keys(MATERIALS);
const EVENT_KINDS = ["shot", "hit", "pickup", "death", "respawn", "throw", "explode"];
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
    && (event.fuseMs === undefined || (finite(event.fuseMs) && event.fuseMs >= 0 && event.fuseMs <= 10_000));
}

function freshPlayer(): CombatPlayer {
  return { health: 100, owned: ["knife"], active: "knife", ammo: { pistol: 12, rifle: 30 }, grenades: GRENADES_PER_LIFE, reloadUntil: 0, respawnAfter: 0, kills: 0, deaths: 0 };
}

function validPlayer(player: CombatPlayer): boolean {
  const validWeapon = (weapon: unknown): weapon is WeaponKind => weapon === "knife" || weapon === "pistol" || weapon === "rifle";
  return Number.isInteger(player.health) && player.health >= 0 && player.health <= 100
    && Array.isArray(player.owned) && player.owned.every(validWeapon) && player.owned.includes("knife")
    && validWeapon(player.active) && player.owned.includes(player.active)
    && Number.isInteger(player.ammo?.pistol) && player.ammo.pistol >= 0 && player.ammo.pistol <= WEAPONS.pistol.magazine
    && Number.isInteger(player.ammo?.rifle) && player.ammo.rifle >= 0 && player.ammo.rifle <= WEAPONS.rifle.magazine
    && Number.isInteger(player.grenades) && player.grenades >= 0 && player.grenades <= GRENADES_PER_LIFE
    && Number.isFinite(player.reloadUntil) && player.reloadUntil >= 0
    && Number.isFinite(player.respawnAfter) && player.respawnAfter >= 0
    && Number.isSafeInteger(player.kills) && player.kills >= 0
    && Number.isSafeInteger(player.deaths) && player.deaths >= 0;
}

function emptySnapshot(): CombatSnapshot {
  return { version: 3, revision: 0, eventSeq: 0, players: {}, taken: [], pickupReturns: {}, entities: {}, grenades: [], events: [] };
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
  private now = 0;

  constructor(private data: ArenaData, arena: Arena, private onChange: (snapshot: CombatSnapshot) => void, private world?: CombatWorld) {
    this.pickups = makeWeaponPickups(data, arena);
  }

  reset(selfId: string): void {
    this.snapshot = { ...emptySnapshot(), players: { [selfId]: freshPlayer() } };
    this.poses.clear();
    this.poseTimes.clear();
    this.history.clear();
    this.lastAttack.clear();
    this.lastThrow.clear();
    this.bloom.clear();
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
    if (!incoming || incoming.version !== 3 || !Number.isSafeInteger(incoming.revision) || incoming.revision < 0 || !Number.isSafeInteger(incoming.eventSeq)
      || !incoming.players || !Array.isArray(incoming.taken) || !incoming.pickupReturns || typeof incoming.pickupReturns !== "object"
      || !incoming.entities || typeof incoming.entities !== "object" || !Array.isArray(incoming.grenades) || !Array.isArray(incoming.events)) return false;
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
    const grenades = incoming.grenades.filter((grenade) => grenade && Number.isSafeInteger(grenade.id) && typeof grenade.actor === "string" && finite(grenade.explodeAt) && validVec(grenade.position)).slice(0, 16);
    const events = incoming.events.filter(validEvent).slice(-EVENTS_KEPT).map((event) => structuredClone(event));
    this.snapshot = { version: 3, revision: incoming.revision, eventSeq: incoming.eventSeq, players, taken: incoming.taken.filter((id) => this.pickups.some((pickup) => pickup.id === id)), pickupReturns, entities, grenades: structuredClone(grenades), events };
    this.onChange(this.snapshot);
    return true;
  }

  apply(actor: string, intent: CombatIntent, now = Date.now()): boolean {
    this.now = now;
    const player = this.snapshot.players[actor];
    if (!player) return false;
    if (intent.kind === "respawn") {
      if (player.health > 0 || now < player.respawnAfter) return false;
      Object.assign(player, { health: 100, active: "knife", owned: ["knife"], ammo: { pistol: 12, rifle: 30 }, grenades: GRENADES_PER_LIFE, reloadUntil: 0 });
      this.removePose(actor);
      this.emit({ kind: "respawn", actor });
      this.changed();
      return true;
    }
    if (player.health <= 0) return false;
    const pose = this.poses.get(actor);
    const fresh = !!pose && now - (this.poseTimes.get(actor) ?? 0) <= 1500;
    if (intent.kind === "pickup") {
      const pickup = this.pickups.find((item) => item.id === intent.pickupId);
      if (!pickup || !pose || !fresh || this.snapshot.taken.includes(pickup.id)
        || Math.hypot(pose.east - pickup.east, pose.north - pickup.north) > 2.3) return false;
      this.snapshot.taken.push(pickup.id);
      this.snapshot.pickupReturns[pickup.id] = now + 30_000;
      if (!player.owned.includes(pickup.weapon)) player.owned.push(pickup.weapon);
      player.active = pickup.weapon;
      this.equipUntil.set(actor, now + 560);
      player.ammo[pickup.weapon] = WEAPONS[pickup.weapon].magazine;
      player.reloadUntil = 0;
      this.emit({ kind: "pickup", actor, weapon: pickup.weapon });
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
    if (intent.kind === "reload") {
      if (player.active === "knife" || player.reloadUntil > now || player.ammo[player.active] >= WEAPONS[player.active].magazine) return false;
      player.reloadUntil = now + WEAPONS[player.active].reloadMs;
      this.changed();
      return true;
    }
    if (intent.kind === "fall") return this.fall(actor, intent.speed);
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
      if (now < (this.equipUntil.get(actor) ?? 0) || intent.weapon !== weapon || player.reloadUntil > now || now - (this.lastAttack.get(actor) ?? 0) < WEAPONS[weapon].cooldownMs) return false;
      if (weapon !== "knife" && player.ammo[weapon] <= 0) return false;
      const aim = intent.aim;
      if (aim && (!finite(aim.heading, aim.pitch) || Math.abs(aim.pitch) > 80)) return false;
      if (!pose || !fresh || pose.running) return false;
      // Spread follows how the shooter was moving and how fast they have been firing.
      const sinceLast = (now - (this.lastAttack.get(actor) ?? 0)) / 1000;
      const bloom = currentBloom(weapon, this.bloom.get(actor) ?? 0, sinceLast);
      const spread = spreadDegrees(weapon, { moving: pose.moving, crouching: pose.crouching, airborne: !!pose.airborne, sliding: !!pose.sliding }, bloom);
      this.bloom.set(actor, bloomAfterShot(weapon, this.bloom.get(actor) ?? 0, sinceLast));
      const origin = { ...pose, ...deviateAim(aim ?? pose, spread) };
      this.lastAttack.set(actor, now);
      if (weapon !== "knife") player.ammo[weapon] -= 1;
      this.resolveShot(actor, weapon, origin, intent.seen);
      this.changed();
      return true;
    }
    return false;
  }

  // A round travels through surfaces and bodies in order, spending penetration power on
  // each and dealing what it has left. Objects it crosses take damage by their material.
  private resolveShot(actor: string, weapon: WeaponKind, origin: PlayerPose, seen?: Record<string, number>): void {
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
    const full = Math.max(PENETRATION[weapon], 1);
    let power = PENETRATION[weapon];
    let end = ray.distance, stopped = false;
    const impacts: Impact[] = [];
    const hits: Omit<CombatEvent, "id">[] = [];
    const direction = ray.direction;
    for (const item of items) {
      const share = weapon === "knife" ? 1 : Math.max(0, power) / full;
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
        this.damageEntity(surface.entity, WEAPONS[weapon].damage * share * rule.bullet, surface.point, { x: direction.x * strength, y: direction.y * strength, z: direction.z * strength });
      }
      const cost = rule.resistance * Math.max(0.02, surface.thickness);
      if (weapon === "knife" || power <= cost) { end = surface.distance; stopped = true; break; }
      power -= cost;
      const exit = surface.distance + surface.thickness;
      impacts.push({ x: ray.origin.x + direction.x * exit, y: ray.origin.y + direction.y * exit, z: ray.origin.z + direction.z * exit, nx: direction.x, ny: direction.y, nz: direction.z, material: surface.material, exit: true });
    }
    this.emit({ kind: "shot", actor, weapon, shot: { ...ray, distance: end }, impact: stopped, impacts: impacts.slice(0, 24) });
    for (const hit of hits) this.hurt(hit.target!, hit.damage ?? 0, hit);
  }

  private damageEntity(id: string, amount: number, point: Vec3, impulse: Vec3): void {
    const info = this.world?.entity(id);
    if (!info) return;
    const current = this.snapshot.entities[id] ?? info.maxHealth;
    if (current <= 0) return;
    this.world?.push(id, point, impulse);
    if (!Number.isFinite(info.maxHealth) || amount <= 0) return;
    this.snapshot.entities[id] = Math.max(0, Math.round((current - amount) * 10) / 10);
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
    const damage = Math.round((speed - FALL_SAFE_SPEED) * FALL_DAMAGE_PER_MS);
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
    this.emit({ kind: "explode", actor: grenade.actor, position: center, grenade: grenade.id });
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
      this.damageEntity(entity.id, BLAST_ENTITY_DAMAGE * strength * MATERIALS[info.material].blast, entity.point, { x: dx / length * push, y: dy / length * push, z: dz / length * push });
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
        player.ammo[player.active === "knife" ? "pistol" : player.active] = WEAPONS[player.active].magazine;
        player.reloadUntil = 0;
        changed = true;
      }
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
