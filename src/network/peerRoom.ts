import { joinRoom, selfId } from "trystero";
import { toLocal, type Arena } from "../world/arena";
import { type PlayerPose } from "../game/playerController";
import { MatchState, type CombatIntent, type CombatSnapshot } from "../game/matchState";

const APP_ID = "io.github.kushagrabainsla.hereafter.v2";
// Version 3 carries event lists, entity health and grenades in snapshots, so it does not mix with 2.
const PROTOCOL_VERSION = 3;
const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

type PosePacket = {
  version: number;
  map: string;
  sequence: number;
  sentAt: number;
  east: number;
  north: number;
  heading: number;
  pitch: number;
  jumpHeight: number;
  moving: boolean;
  running: boolean;
  crouching: boolean;
  sliding?: boolean;
  airborne?: boolean;
  lean?: number;
};

type IntentPacket = { version: number; map: string; sequence: number; intent: CombatIntent };
type SnapshotPacket = { version: number; map: string; leader: string; state: CombatSnapshot };
type SyncPacket = { version: number; map: string };
// Loose prop transforms from the coordinator: [id, x, y, z, qx, qy, qz, qw].
export type PropState = [string, number, number, number, number, number, number, number];
type PropsPacket = { version: number; map: string; states: PropState[] };

export interface PeerRoomEvents {
  onPeers: (count: number, spawnSlot: number) => void;
  onPose: (peerId: string, pose: PlayerPose, sentAt: number) => void;
  onPeerLeave: (peerId: string) => void;
  onStatus: (message: string) => void;
  onProps?: (states: PropState[]) => void;
}

function mapKey(arena: Arena): string {
  return `san-jose-v1:${arena.latitude.toFixed(6)}:${arena.longitude.toFixed(6)}:${arena.sizeMeters}`;
}

function validPose(value: unknown, expectedMap: string): value is PosePacket {
  if (typeof value !== "object" || value === null) return false;
  const packet = value as Partial<PosePacket>;
  return packet.version === PROTOCOL_VERSION && packet.map === expectedMap
    && Number.isSafeInteger(packet.sequence) && (packet.sequence ?? -1) >= 0
    && Number.isFinite(packet.sentAt)
    && Number.isFinite(packet.east) && Math.abs(packet.east ?? Infinity) <= 350
    && Number.isFinite(packet.north) && Math.abs(packet.north ?? Infinity) <= 350
    && Number.isFinite(packet.heading) && (packet.heading ?? -1) >= 0 && (packet.heading ?? 361) <= 360
    && Number.isFinite(packet.pitch) && Math.abs(packet.pitch ?? Infinity) <= 80
    && Number.isFinite(packet.jumpHeight) && (packet.jumpHeight ?? -1) >= 0 && (packet.jumpHeight ?? 11) <= 2.5
    && typeof packet.moving === "boolean" && typeof packet.running === "boolean" && typeof packet.crouching === "boolean"
    && (packet.sliding === undefined || typeof packet.sliding === "boolean") && (packet.airborne === undefined || typeof packet.airborne === "boolean")
    && (packet.lean === undefined || (Number.isFinite(packet.lean) && Math.abs(packet.lean) <= 1));
}

function validAim(aim: unknown): boolean {
  const value = aim as { heading?: unknown; pitch?: unknown } | null;
  return !!value && typeof value.heading === "number" && typeof value.pitch === "number" && Number.isFinite(value.heading) && Number.isFinite(value.pitch) && Math.abs(value.pitch) <= 80;
}

function validIntent(value: unknown): value is CombatIntent {
  if (typeof value !== "object" || value === null) return false;
  const intent = value as CombatIntent;
  if (intent.kind === "attack") {
    if (!["knife", "pistol", "rifle"].includes(intent.weapon ?? "")) return false;
    if (intent.aim !== undefined && !validAim(intent.aim)) return false;
    return intent.seen === undefined || (typeof intent.seen === "object" && intent.seen !== null && Object.keys(intent.seen).length <= 16
      && Object.values(intent.seen).every((time) => typeof time === "number" && Number.isFinite(time)));
  }
  if (intent.kind === "select") return ["knife", "pistol", "rifle"].includes(intent.weapon ?? "");
  if (intent.kind === "pickup") return typeof intent.pickupId === "string" && intent.pickupId.length < 40;
  if (intent.kind === "throw") return validAim(intent.aim);
  if (intent.kind === "fall") return typeof intent.speed === "number" && Number.isFinite(intent.speed);
  return intent.kind === "reload" || intent.kind === "respawn";
}

export function normalizeRoomCode(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function newRoomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return [...bytes].map((byte) => ROOM_ALPHABET[byte % ROOM_ALPHABET.length]).join("");
}

export class PeerRoom {
  readonly code: string;
  private room;
  private poseAction;
  private intentAction;
  private snapshotAction;
  private syncAction;
  private propsAction;
  private peers = new Set<string>();
  private lastSequence = new Map<string, number>();
  private lastAcceptedPose = new Map<string, { east: number; north: number; receivedAt: number }>();
  private lastIntentSequence = new Map<string, number>();
  private sequence = 0;
  private intentSequence = 0;
  private sending = false;
  private failed = false;
  private expectedMap: string;
  private leaderId = selfId;
  private handoffUntil = 0;

  private reportPeers(): void {
    const members = [selfId, ...this.peers].sort();
    this.events.onPeers(members.length, members.indexOf(selfId));
  }

  constructor(code: string, private arena: Arena, private match: MatchState, private events: PeerRoomEvents) {
    this.code = normalizeRoomCode(code);
    if (this.code.length < 6 || this.code.length > 24) throw new Error("Room code must be 6–24 letters or numbers.");
    this.expectedMap = mapKey(arena);
    this.room = joinRoom({ appId: APP_ID, password: this.code }, this.code, {
      onJoinError: () => this.events.onStatus("A peer could not connect. Try another network or leave and rejoin."),
    });
    this.poseAction = this.room.makeAction<PosePacket>("pose-v1");
    this.intentAction = this.room.makeAction<IntentPacket>("combat-intent-v1");
    this.snapshotAction = this.room.makeAction<string>("combat-state-v1");
    this.syncAction = this.room.makeAction<SyncPacket>("combat-sync-v1");
    this.propsAction = this.room.makeAction<PropsPacket>("props-v1");
    this.propsAction.onMessage = (value, { peerId }) => {
      if (peerId !== this.leaderId || this.leaderId === selfId || value.version !== PROTOCOL_VERSION || value.map !== this.expectedMap || !Array.isArray(value.states)) return;
      const states = value.states.filter((state) => Array.isArray(state) && state.length === 8 && typeof state[0] === "string" && state[0].length < 40 && state.slice(1).every((n) => typeof n === "number" && Number.isFinite(n))).slice(0, 200);
      this.events.onProps?.(states);
    };
    this.poseAction.onMessage = (value, { peerId }) => {
      if (!this.peers.has(peerId) || !validPose(value, this.expectedMap)) return;
      const [centerEast, centerNorth] = toLocal(this.arena.latitude, this.arena.longitude);
      const half = this.arena.sizeMeters / 2 + 0.5;
      if (Math.abs(value.east - centerEast) > half || Math.abs(value.north - centerNorth) > half) return;
      const previous = this.lastSequence.get(peerId) ?? -1;
      if (value.sequence <= previous) return;
      const now = performance.now();
      const last = this.lastAcceptedPose.get(peerId);
      if (last) {
        const elapsed = Math.min(0.5, Math.max((now - last.receivedAt) / 1000, Math.min(0.2, (value.sequence - previous) * 0.05)));
        if (Math.hypot(value.east - last.east, value.north - last.north) > 0.9 + 10 * elapsed) return;
      }
      this.lastSequence.set(peerId, value.sequence);
      this.lastAcceptedPose.set(peerId, { east: value.east, north: value.north, receivedAt: now });
      const pose = {
        east: value.east,
        north: value.north,
        heading: value.heading,
        pitch: value.pitch,
        jumpHeight: value.jumpHeight,
        moving: value.moving,
        running: value.running,
        crouching: value.crouching,
        sliding: value.sliding === true,
        airborne: value.airborne === true,
        lean: value.lean ?? 0,
      };
      this.match.setPose(peerId, pose, value.sentAt);
      this.events.onPose(peerId, pose, value.sentAt);
    };
    this.intentAction.onMessage = (value, { peerId }) => {
      if (this.leaderId !== selfId || !this.peers.has(peerId) || value.version !== PROTOCOL_VERSION || value.map !== this.expectedMap
        || !Number.isSafeInteger(value.sequence) || !validIntent(value.intent)) return;
      if (value.sequence <= (this.lastIntentSequence.get(peerId) ?? -1)) return;
      this.lastIntentSequence.set(peerId, value.sequence);
      if (this.match.apply(peerId, value.intent)) {
        if (value.intent.kind === "respawn") this.lastAcceptedPose.delete(peerId);
        this.broadcastSnapshot();
      }
    };
    this.snapshotAction.onMessage = (raw, { peerId }) => {
      let value: SnapshotPacket;
      try { value = JSON.parse(raw) as SnapshotPacket; } catch { return; }
      if (!value || !value.state) return;
      if (!this.peers.has(peerId) || value.version !== PROTOCOL_VERSION || value.map !== this.expectedMap || value.leader !== peerId) return;
      if (peerId !== this.leaderId && !(this.leaderId === selfId && Date.now() < this.handoffUntil)) return;
      if (this.match.adopt(value.state)) {
        // A respawn teleports the player, so its next pose must not fail the distance check.
        for (const event of value.state.events) if (event.kind === "respawn") this.lastAcceptedPose.delete(event.actor);
        if (this.leaderId === selfId) {
          this.match.ensurePlayer(selfId);
          this.broadcastSnapshot();
        }
      }
    };
    this.syncAction.onMessage = (value, { peerId }) => {
      if (this.leaderId === selfId && this.peers.has(peerId) && value.version === PROTOCOL_VERSION && value.map === this.expectedMap) this.sendSnapshot(peerId);
    };
    this.room.onPeerJoin = (peerId) => {
      const wasLeader = this.leaderId === selfId;
      this.peers.add(peerId);
      if (wasLeader) {
        this.match.ensurePlayer(peerId);
        this.sendSnapshot(peerId);
      }
      this.refreshLeader();
      this.reportPeers();
      this.events.onStatus(`${this.peers.size + 1} players connected directly.`);
    };
    this.room.onPeerLeave = (peerId) => {
      this.peers.delete(peerId);
      this.lastSequence.delete(peerId);
      this.lastAcceptedPose.delete(peerId);
      this.lastIntentSequence.delete(peerId);
      this.match.removePose(peerId);
      this.events.onPeerLeave(peerId);
      this.refreshLeader();
      this.reportPeers();
      this.events.onStatus(this.peers.size ? `${this.peers.size + 1} players connected directly.` : "Waiting for a friend to join…");
    };
    this.reportPeers();
    this.events.onStatus("Waiting for a friend to join…");
  }

  private refreshLeader(): void {
    const nextLeader = [selfId, ...this.peers].sort()[0];
    if (nextLeader === this.leaderId) {
      if (nextLeader === selfId) this.broadcastSnapshot();
      return;
    }
    this.leaderId = nextLeader;
    this.handoffUntil = Date.now() + 1800;
    if (nextLeader === selfId) {
      for (const peerId of this.peers) this.match.ensurePlayer(peerId);
      window.setTimeout(() => this.broadcastSnapshot(), 500);
    } else void this.syncAction.send({ version: PROTOCOL_VERSION, map: this.expectedMap }, { target: nextLeader }).catch(() => undefined);
  }

  private sendSnapshot(peerId: string): void {
    void this.snapshotAction.send(JSON.stringify({ version: PROTOCOL_VERSION, map: this.expectedMap, leader: selfId, state: this.match.getState() }), { target: peerId }).catch(() => undefined);
  }

  private broadcastSnapshot(): void {
    if (this.leaderId !== selfId || !this.peers.size) return;
    void this.snapshotAction.send(JSON.stringify({ version: PROTOCOL_VERSION, map: this.expectedMap, leader: selfId, state: this.match.getState() })).catch(() => undefined);
  }

  sendCombatIntent(intent: CombatIntent): void {
    if (this.leaderId === selfId) {
      if (this.match.apply(selfId, intent)) this.broadcastSnapshot();
      return;
    }
    void this.intentAction.send({ version: PROTOCOL_VERSION, map: this.expectedMap, sequence: ++this.intentSequence, intent }, { target: this.leaderId }).catch(() => undefined);
  }

  tickCombat(): void {
    if (this.leaderId === selfId && this.match.tick()) this.broadcastSnapshot();
  }

  leading(): boolean { return this.leaderId === selfId; }

  sendProps(states: PropState[]): void {
    if (this.leaderId !== selfId || !this.peers.size || !states.length) return;
    void this.propsAction.send({ version: PROTOCOL_VERSION, map: this.expectedMap, states }).catch(() => undefined);
  }

  sendPose(pose: PlayerPose): void {
    if (!this.peers.size || this.sending) return;
    const round = (value: number): number => Math.round(value * 100) / 100;
    const packet: PosePacket = {
      version: PROTOCOL_VERSION,
      map: this.expectedMap,
      sequence: ++this.sequence,
      sentAt: Date.now(),
      east: round(pose.east),
      north: round(pose.north),
      heading: round(pose.heading),
      pitch: round(pose.pitch),
      jumpHeight: round(pose.jumpHeight),
      moving: pose.moving,
      running: pose.running,
      crouching: pose.crouching,
      sliding: pose.sliding === true,
      airborne: pose.airborne === true,
      lean: round(pose.lean ?? 0),
    };
    this.sending = true;
    void this.poseAction.send(packet).catch(() => {
      if (!this.failed) this.events.onStatus("Connection interrupted. Waiting for peers to reconnect…");
      this.failed = true;
    }).finally(() => {
      this.sending = false;
    });
  }

  async leave(): Promise<void> {
    this.poseAction.onMessage = null;
    this.intentAction.onMessage = null;
    this.snapshotAction.onMessage = null;
    this.syncAction.onMessage = null;
    this.propsAction.onMessage = null;
    this.room.onPeerJoin = null;
    this.room.onPeerLeave = null;
    await this.room.leave();
    this.peers.clear();
    this.lastSequence.clear();
    this.lastAcceptedPose.clear();
    this.lastIntentSequence.clear();
  }
}
