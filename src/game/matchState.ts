import { type Arena, type ArenaData } from "../world/arena";
import { CollisionWorld } from "../world/collision";
import { hitDistance, makeWeaponPickups, WEAPONS, type ShotClear, type WeaponKind, type WeaponPickup } from "./combatRules";
import { type PlayerPose } from "./playerController";

export interface CombatPlayer {
  health: number;
  owned: WeaponKind[];
  active: WeaponKind;
  ammo: { pistol: number; rifle: number };
  reloadUntil: number;
  respawnAfter: number;
  kills: number;
  deaths: number;
}

export type CombatIntent =
  | { kind: "attack"; weapon: WeaponKind }
  | { kind: "pickup"; pickupId: string }
  | { kind: "reload" }
  | { kind: "select"; weapon: WeaponKind }
  | { kind: "respawn" };

export interface CombatEvent {
  id: number;
  kind: "hit" | "pickup" | "death" | "respawn";
  actor: string;
  target?: string;
  weapon?: WeaponKind;
  damage?: number;
}

export interface CombatSnapshot {
  version: 1;
  revision: number;
  players: Record<string, CombatPlayer>;
  taken: string[];
  pickupReturns: Record<string, number>;
  event: CombatEvent | null;
}

function freshPlayer(): CombatPlayer {
  return { health: 100, owned: ["knife"], active: "knife", ammo: { pistol: 12, rifle: 30 }, reloadUntil: 0, respawnAfter: 0, kills: 0, deaths: 0 };
}

function validPlayer(player: CombatPlayer): boolean {
  const validWeapon = (weapon: unknown): weapon is WeaponKind => weapon === "knife" || weapon === "pistol" || weapon === "rifle";
  return Number.isInteger(player.health) && player.health >= 0 && player.health <= 100
    && Array.isArray(player.owned) && player.owned.every(validWeapon) && player.owned.includes("knife")
    && validWeapon(player.active) && player.owned.includes(player.active)
    && Number.isInteger(player.ammo?.pistol) && player.ammo.pistol >= 0 && player.ammo.pistol <= WEAPONS.pistol.magazine
    && Number.isInteger(player.ammo?.rifle) && player.ammo.rifle >= 0 && player.ammo.rifle <= WEAPONS.rifle.magazine
    && Number.isFinite(player.reloadUntil) && player.reloadUntil >= 0
    && Number.isFinite(player.respawnAfter) && player.respawnAfter >= 0
    && Number.isSafeInteger(player.kills) && player.kills >= 0
    && Number.isSafeInteger(player.deaths) && player.deaths >= 0;
}

export class MatchState {
  readonly pickups: WeaponPickup[];
  private collision: CollisionWorld;
  private snapshot: CombatSnapshot = { version: 1, revision: 0, players: {}, taken: [], pickupReturns: {}, event: null };
  private poses = new Map<string, PlayerPose>();
  private poseTimes = new Map<string, number>();
  private lastAttack = new Map<string, number>();

  constructor(private data: ArenaData, arena: Arena, private onChange: (snapshot: CombatSnapshot) => void, private shotClear?: ShotClear) {
    this.collision = new CollisionWorld(data);
    this.pickups = makeWeaponPickups(data, arena);
  }

  reset(selfId: string): void {
    this.snapshot = { version: 1, revision: 0, players: { [selfId]: freshPlayer() }, taken: [], pickupReturns: {}, event: null };
    this.poses.clear();
    this.poseTimes.clear();
    this.lastAttack.clear();
    this.onChange(this.snapshot);
  }

  getState(): CombatSnapshot { return structuredClone(this.snapshot); }
  player(id: string): CombatPlayer | undefined { return this.snapshot.players[id]; }
  setPose(id: string, pose: PlayerPose): void { this.poses.set(id, pose); this.poseTimes.set(id, Date.now()); }
  removePose(id: string): void { this.poses.delete(id); this.poseTimes.delete(id); }

  ensurePlayer(id: string): boolean {
    if (this.snapshot.players[id]) return false;
    this.snapshot.players[id] = freshPlayer();
    this.changed();
    return true;
  }

  adopt(incoming: CombatSnapshot): boolean {
    if (incoming.version !== 1 || !Number.isSafeInteger(incoming.revision) || incoming.revision < 0 || !incoming.players || !Array.isArray(incoming.taken) || !incoming.pickupReturns || typeof incoming.pickupReturns !== "object") return false;
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
    const candidateEvent = incoming.event;
    const event = candidateEvent && Number.isSafeInteger(candidateEvent.id)
      && ["hit", "pickup", "death", "respawn"].includes(candidateEvent.kind)
      && typeof candidateEvent.actor === "string"
      && (!candidateEvent.weapon || candidateEvent.weapon in WEAPONS)
      ? structuredClone(candidateEvent) : null;
    this.snapshot = { version: 1, revision: incoming.revision, players, taken: incoming.taken.filter((id) => this.pickups.some((pickup) => pickup.id === id)), pickupReturns, event };
    this.onChange(this.snapshot);
    return true;
  }

  apply(actor: string, intent: CombatIntent, now = Date.now()): boolean {
    const player = this.snapshot.players[actor];
    if (!player) return false;
    if (intent.kind === "respawn") {
      if (player.health > 0 || now < player.respawnAfter) return false;
      player.health = 100;
      player.active = "knife";
      player.owned = ["knife"];
      player.ammo = { pistol: 12, rifle: 30 };
      player.reloadUntil = 0;
      this.removePose(actor);
      this.event("respawn", actor);
      return true;
    }
    if (player.health <= 0) return false;
    if (intent.kind === "pickup") {
      const pickup = this.pickups.find((item) => item.id === intent.pickupId);
      const pose = this.poses.get(actor);
      if (!pickup || !pose || now - (this.poseTimes.get(actor) ?? 0) > 1500 || this.snapshot.taken.includes(pickup.id)
        || Math.hypot(pose.east - pickup.east, pose.north - pickup.north) > 2.3) return false;
      this.snapshot.taken.push(pickup.id);
      this.snapshot.pickupReturns[pickup.id] = now + 30_000;
      if (!player.owned.includes(pickup.weapon)) player.owned.push(pickup.weapon);
      player.active = pickup.weapon;
      player.ammo[pickup.weapon] = WEAPONS[pickup.weapon].magazine;
      player.reloadUntil = 0;
      this.event("pickup", actor, undefined, pickup.weapon);
      return true;
    }
    if (intent.kind === "select") {
      if (!player.owned.includes(intent.weapon) || player.active === intent.weapon || player.reloadUntil > now) return false;
      player.active = intent.weapon;
      this.changed();
      return true;
    }
    if (intent.kind === "reload") {
      if (player.active === "knife" || player.reloadUntil > now || player.ammo[player.active] >= WEAPONS[player.active].magazine) return false;
      player.reloadUntil = now + WEAPONS[player.active].reloadMs;
      this.changed();
      return true;
    }
    if (intent.kind === "attack") {
      const weapon = player.active;
      if (intent.weapon !== weapon || player.reloadUntil > now || now - (this.lastAttack.get(actor) ?? 0) < WEAPONS[weapon].cooldownMs) return false;
      if (weapon !== "knife" && player.ammo[weapon] <= 0) return false;
      this.lastAttack.set(actor, now);
      if (weapon !== "knife") player.ammo[weapon] -= 1;
      const origin = this.poses.get(actor);
      let closest: { id: string; distance: number } | null = null;
      if (origin && now - (this.poseTimes.get(actor) ?? 0) <= 1500) for (const [id, target] of this.poses) {
        if (id === actor || (this.snapshot.players[id]?.health ?? 0) <= 0) continue;
        if (now - (this.poseTimes.get(id) ?? 0) > 1500) continue;
        const distance = hitDistance(this.data, this.collision, origin, target, weapon, this.shotClear);
        if (distance !== null && (!closest || distance < closest.distance)) closest = { id, distance };
      }
      if (closest) {
        const victim = this.snapshot.players[closest.id];
        victim.health = Math.max(0, victim.health - WEAPONS[weapon].damage);
        if (victim.health === 0) {
          victim.deaths += 1;
          victim.respawnAfter = now + 3000;
          player.kills += 1;
        }
        this.event(victim.health === 0 ? "death" : "hit", actor, closest.id, weapon, WEAPONS[weapon].damage);
      } else this.changed();
      return true;
    }
    return false;
  }

  tick(now = Date.now()): boolean {
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
    if (changed) this.changed();
    return changed;
  }

  private event(kind: CombatEvent["kind"], actor: string, target?: string, weapon?: WeaponKind, damage?: number): void {
    this.snapshot.event = { id: this.snapshot.revision + 1, kind, actor, target, weapon, damage };
    this.changed();
  }

  private changed(): void {
    this.snapshot.revision += 1;
    this.onChange(this.snapshot);
  }
}
