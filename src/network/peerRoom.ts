import { joinRoom, selfId } from "trystero";
import { type Arena } from "../world/arena";
import { type PlayerPose } from "../game/playerController";
import { MatchState, type CombatIntent, type CombatSnapshot } from "../game/matchState";

const APP_ID = "io.github.kushagrabainsla.hereafter.v2";
// Version 5 carries open doors and hatches and venting gas cylinders, so it does not mix with 4.
const PROTOCOL_VERSION = 10;
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
// Shoves a player gave loose props the coordinator simulates: [id, impulse x, y, z] in N·s.
export type PropPush = [string, number, number, number];
type PushPacket = { version: number; map: string; pushes: PropPush[] };

export interface PeerRoomEvents {
  onPeers: (count: number, spawnSlot: number) => void;
  onPose: (peerId: string, pose: PlayerPose, sentAt: number) => void;
  onPeerLeave: (peerId: string) => void;
  onStatus: (message: string) => void;
  onProps?: (states: PropState[]) => void;
  onPushes?: (pushes: PropPush[]) => void;
}

// Positions travel on a data channel of their own beside Trystero's, both peers opening it
// with this id, so it needs no negotiation of its own.
const POSITION_LANE_ID = 512;
// A lane with this much waiting to go is congested; the newest position waits for the next tick.
const LANE_BACKLOG_BYTES = 8192;

// A position on the lane, 25 bytes, little-endian: protocol (u8), sequence (u32), sent at
// (f64 ms), east, north and jump height in centimetres (i16), heading in hundredths of a
// degree (u16), pitch in hundredths (i16), lean in hundredths (i8) and movement flags (u8).
// As text it was about 238 bytes.
const POSITION_BYTES = 25;
const FLAG = { moving: 1, running: 2, crouching: 4, sliding: 8, airborne: 16 } as const;

function encodePosition(packet: PosePacket): ArrayBuffer {
  const view = new DataView(new ArrayBuffer(POSITION_BYTES));
  view.setUint8(0, PROTOCOL_VERSION);
  view.setUint32(1, packet.sequence >>> 0, true);
  view.setFloat64(5, packet.sentAt, true);
  view.setInt16(13, Math.round(packet.east * 100), true);
  view.setInt16(15, Math.round(packet.north * 100), true);
  view.setInt16(17, Math.round(Math.max(-327, Math.min(327, packet.jumpHeight)) * 100), true);
  view.setUint16(19, Math.round(((packet.heading % 360) + 360) % 360 * 100), true);
  view.setInt16(21, Math.round(packet.pitch * 100), true);
  view.setInt8(23, Math.round(Math.max(-1.27, Math.min(1.27, packet.lean ?? 0)) * 100));
  view.setUint8(24, (packet.moving ? FLAG.moving : 0) | (packet.running ? FLAG.running : 0) | (packet.crouching ? FLAG.crouching : 0)
    | (packet.sliding ? FLAG.sliding : 0) | (packet.airborne ? FLAG.airborne : 0));
  return view.buffer;
}

function decodePosition(data: ArrayBuffer, map: string): PosePacket | null {
  if (data.byteLength !== POSITION_BYTES) return null;
  const view = new DataView(data);
  if (view.getUint8(0) !== PROTOCOL_VERSION) return null;
  const flags = view.getUint8(24);
  return {
    version: PROTOCOL_VERSION, map, sequence: view.getUint32(1, true), sentAt: view.getFloat64(5, true),
    east: view.getInt16(13, true) / 100, north: view.getInt16(15, true) / 100, jumpHeight: view.getInt16(17, true) / 100,
    heading: view.getUint16(19, true) / 100, pitch: view.getInt16(21, true) / 100, lean: view.getInt8(23) / 100,
    moving: (flags & FLAG.moving) !== 0, running: (flags & FLAG.running) !== 0, crouching: (flags & FLAG.crouching) !== 0,
    sliding: (flags & FLAG.sliding) !== 0, airborne: (flags & FLAG.airborne) !== 0,
  };
}

// Peers only exchange packets for the same map and protocol.
const MAP_KEY = "night-market-v1";

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
    if (intent.stroke !== undefined && intent.stroke !== "slash" && intent.stroke !== "stab") return false;
    if (intent.aim !== undefined && !validAim(intent.aim)) return false;
    return intent.seen === undefined || (typeof intent.seen === "object" && intent.seen !== null && Object.keys(intent.seen).length <= 16
      && Object.values(intent.seen).every((time) => typeof time === "number" && Number.isFinite(time)));
  }
  if (intent.kind === "select") return ["knife", "pistol", "rifle"].includes(intent.weapon ?? "");
  if (intent.kind === "use") return typeof intent.target === "string" && intent.target.length < 40;
  if (intent.kind === "pickup") return typeof intent.pickupId === "string" && intent.pickupId.length < 40;
  if (intent.kind === "throw") return validAim(intent.aim) && (intent.smoke === undefined || typeof intent.smoke === "boolean");
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
  private pushAction;
  private peers = new Set<string>();
  private lastSequence = new Map<string, number>();
  private lastAcceptedPose = new Map<string, { east: number; north: number; receivedAt: number; sentAt: number }>();
  // Each peer's position lane: unordered and never resent, so a lost packet holds up nothing
  // behind it, and a late position is simply superseded by the next.
  private lanes = new Map<string, RTCDataChannel>();
  private lastIntentSequence = new Map<string, number>();
  private sequence = 0;
  private intentSequence = 0;
  private sending = false;
  private failed = false;
  private expectedMap: string;
  private leaderId = selfId;
  private handoffUntil = 0;
  // The newest event broadcast so far, and when the last broadcast left; see broadcastSnapshot.
  private lastSentEvent = 0;
  private lastBroadcastAt = 0;
  private broadcastTimer = 0;

  private reportPeers(): void {
    const members = [selfId, ...this.peers].sort();
    this.events.onPeers(members.length, members.indexOf(selfId));
  }

  constructor(code: string, private arena: Arena, private match: MatchState, private events: PeerRoomEvents) {
    this.code = normalizeRoomCode(code);
    if (this.code.length < 6 || this.code.length > 24) throw new Error("Room code must be 6–24 letters or numbers.");
    this.expectedMap = MAP_KEY;
    // The room name keeps the map id the night market's rooms have always used.
    this.room = joinRoom({ appId: APP_ID, password: this.code }, `${this.code}@night-market`, {
      onJoinError: () => this.events.onStatus("A peer could not connect. Try another network or leave and rejoin."),
    });
    this.poseAction = this.room.makeAction<PosePacket>("pose-v1");
    this.intentAction = this.room.makeAction<IntentPacket>("combat-intent-v1");
    this.snapshotAction = this.room.makeAction<string>("combat-state-v1");
    this.syncAction = this.room.makeAction<SyncPacket>("combat-sync-v1");
    this.propsAction = this.room.makeAction<PropsPacket>("props-v1");
    this.pushAction = this.room.makeAction<PushPacket>("prop-push-v1");
    this.pushAction.onMessage = (value, { peerId }) => {
      if (this.leaderId !== selfId || !this.peers.has(peerId) || value.version !== PROTOCOL_VERSION || value.map !== this.expectedMap || !Array.isArray(value.pushes)) return;
      // A body can only lean so hard on a prop in the time between packets.
      const pushes = value.pushes.filter((push) => Array.isArray(push) && push.length === 4 && typeof push[0] === "string" && push[0].length < 40
        && push.slice(1).every((n) => typeof n === "number" && Number.isFinite(n)) && Math.hypot(push[1], push[2], push[3]) <= 120).slice(0, 8);
      if (pushes.length) this.events.onPushes?.(pushes);
    };
    this.propsAction.onMessage = (value, { peerId }) => {
      if (peerId !== this.leaderId || this.leaderId === selfId || value.version !== PROTOCOL_VERSION || value.map !== this.expectedMap || !Array.isArray(value.states)) return;
      const states = value.states.filter((state) => Array.isArray(state) && state.length === 8 && typeof state[0] === "string" && state[0].length < 40 && state.slice(1).every((n) => typeof n === "number" && Number.isFinite(n))).slice(0, 200);
      this.events.onProps?.(states);
    };
    this.poseAction.onMessage = (value, { peerId }) => this.receivePose(value, peerId);
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
      this.openLane(peerId);
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
      this.closeLane(peerId);
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

  private receivePose(value: unknown, peerId: string): void {
    if (!this.peers.has(peerId) || !validPose(value, this.expectedMap)) return;
    const half = this.arena.sizeMeters / 2 + 0.5;
    if (Math.abs(value.east) > half || Math.abs(value.north) > half) return;
    const previous = this.lastSequence.get(peerId) ?? -1;
    if (value.sequence <= previous) return;
    const now = performance.now();
    // A player can only have run so far since the last position accepted from them, timed by
    // their own clock, so positions missing in between are no reason to doubt the next one.
    // After a silence of over 1.5 s, as when a connection stalls, the next position is taken
    // as it is: measured from where they were last seen, it would be rejected for good and
    // the player would freeze for everyone until they respawned.
    const last = this.lastAcceptedPose.get(peerId);
    if (last && now - last.receivedAt < 1500) {
      const elapsed = Math.min(1.5, Math.max(0.05, (value.sentAt - last.sentAt) / 1000));
      if (Math.hypot(value.east - last.east, value.north - last.north) > 0.9 + 10 * elapsed) return;
    }
    this.lastSequence.set(peerId, value.sequence);
    this.lastAcceptedPose.set(peerId, { east: value.east, north: value.north, receivedAt: now, sentAt: value.sentAt });
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
  }

  // Opens the position lane to a peer, who opens its end with the same id.
  private openLane(peerId: string): void {
    const connection = this.room.getPeers()[peerId];
    if (!connection || this.lanes.has(peerId)) return;
    try {
      const lane = connection.createDataChannel("positions", { negotiated: true, id: POSITION_LANE_ID, ordered: false, maxRetransmits: 0 });
      lane.binaryType = "arraybuffer";
      lane.onmessage = ({ data }) => {
        const value = data instanceof ArrayBuffer ? decodePosition(data, this.expectedMap) : null;
        if (value) this.receivePose(value, peerId);
      };
      lane.onclose = () => { if (this.lanes.get(peerId) === lane) this.lanes.delete(peerId); };
      this.lanes.set(peerId, lane);
    } catch {
      // Without a lane, positions to this peer take the shared channel.
    }
  }

  private closeLane(peerId: string): void {
    this.lanes.get(peerId)?.close();
    this.lanes.delete(peerId);
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

  private packet(state: CombatSnapshot): string {
    return JSON.stringify({ version: PROTOCOL_VERSION, map: this.expectedMap, leader: selfId, state });
  }

  // The whole state with its recent events, for a peer joining or catching up.
  private sendSnapshot(peerId: string): void {
    void this.snapshotAction.send(this.packet(this.match.view()), { target: peerId }).catch(() => undefined);
  }

  // Changes go out at most 20 times a second, and each carries only the events since the
  // last: resending the 32 most recent events every time made nine-tenths of each packet, and
  // a firefight between three players sent over 100 KB a second to each. The channel is
  // reliable and ordered, so a peer misses none of them.
  private broadcastSnapshot(): void {
    if (this.leaderId !== selfId || !this.peers.size) return;
    const wait = this.lastBroadcastAt + 50 - performance.now();
    if (wait > 0) {
      if (!this.broadcastTimer) this.broadcastTimer = window.setTimeout(() => { this.broadcastTimer = 0; this.broadcastSnapshot(); }, wait);
      return;
    }
    this.lastBroadcastAt = performance.now();
    const state = this.match.view(this.lastSentEvent);
    this.lastSentEvent = state.eventSeq;
    void this.snapshotAction.send(this.packet(state)).catch(() => undefined);
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

  sendPushes(pushes: PropPush[]): void {
    if (this.leaderId === selfId || !pushes.length) return;
    void this.pushAction.send({ version: PROTOCOL_VERSION, map: this.expectedMap, pushes }, { target: this.leaderId }).catch(() => undefined);
  }

  sendPose(pose: PlayerPose): void {
    if (!this.peers.size) return;
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
    // The lane where it is open; a congested lane skips this position rather than queue it.
    const bytes = encodePosition(packet), shared: string[] = [];
    for (const peerId of this.peers) {
      const lane = this.lanes.get(peerId);
      if (lane?.readyState === "open") { if (lane.bufferedAmount < LANE_BACKLOG_BYTES) lane.send(bytes); }
      else shared.push(peerId);
    }
    if (!shared.length || this.sending) return;
    this.sending = true;
    void this.poseAction.send(packet, { target: shared }).catch(() => {
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
    window.clearTimeout(this.broadcastTimer);
    for (const peerId of [...this.lanes.keys()]) this.closeLane(peerId);
    await this.room.leave();
    this.peers.clear();
    this.lastSequence.clear();
    this.lastAcceptedPose.clear();
    this.lastIntentSequence.clear();
  }
}
