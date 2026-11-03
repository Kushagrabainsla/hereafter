import { joinRoom, selfId } from "trystero";
import { type Arena } from "../world/arena";
import { type PlayerPose } from "../game/playerController";
import { MatchState, type CombatDelta, type CombatIntent, type CombatSnapshot, type SentState } from "../game/matchState";

const APP_ID = "io.github.kushagrabainsla.hereafter.v2";
// Version 5 carries open doors and hatches and venting gas cylinders, so it does not mix with 4.
const PROTOCOL_VERSION = 13;
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
  // The player's tab is in the background, where its timers run once a second at most.
  away?: boolean;
};

type IntentPacket = { version: number; map: string; sequence: number; intent: CombatIntent };
// The coordinator's whole state, or what has changed since its last update.
type SnapshotPacket = { version: number; map: string; leader: string; state?: CombatSnapshot; delta?: CombatDelta };
type SyncPacket = { version: number; map: string };
// The coordinator a peer follows and the epoch of that choice.
type LeaderPacket = { version: number; map: string; leader: string; epoch: number };
// How well a peer could coordinate: how long its main thread keeps a message waiting, and its
// round trip to each peer, in ms.
type FitnessPacket = { version: number; map: string; lag: number; rtt: Record<string, number> };
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

// Every two seconds each peer tells the coordinator how well it could coordinate, and the
// coordinator weighs handing over to the best of them. It does so only when the typical peer,
// the median, would add at most 60% of the delay it adds itself and at least 8 ms less, three
// checks running, and not within 30 s of taking over. A slow machine is slower than all the
// others; measured against the best of five busy peers, the coordinator often lost by chance.
const FITNESS_MS = 2000;
const HANDOVER_RATIO = 0.6;
const HANDOVER_GAIN_MS = 8;
const HANDOVER_CHECKS = 3;
const HANDOVER_SETTLE_MS = 30_000;
// Every peer sends its position at least four times a second, so a coordinator unheard for this
// long has gone or frozen: its tab crashed or closed, or its connection or computer dropped out.
// Trystero notices only when the connection itself fails, which took 12 to 13 s, all that time
// without shots. In six-player fights on one overloaded machine a coordinator froze for at most
// 0.8 s; players went up to 2 s without hearing it only while frozen themselves.
const HOST_SILENCE_MS = 2000;
const SILENCE_CHECK_MS = 250;

// Positions travel on a data channel of their own beside Trystero's, both peers opening it
// with this id, so it needs no negotiation of its own.
const POSITION_LANE_ID = 512;
// A lane with this much waiting to go is congested; the newest position waits for the next tick.
const LANE_BACKLOG_BYTES = 8192;

// A position on the lane, 25 bytes, little-endian: protocol (u8), sequence (u32), sent at
// (f64 ms), east, north and jump height in centimetres (i16), heading in hundredths of a
// degree (u16), pitch in hundredths (i16), lean in hundredths (i8) and flags (u8): movement,
// and whether the player's tab is in the background. As text it was about 238 bytes.
const POSITION_BYTES = 25;
// A single byte, the protocol, on the lane: the sender is leaving the room.
const GOODBYE = Uint8Array.of(PROTOCOL_VERSION);
const FLAG = { moving: 1, running: 2, crouching: 4, sliding: 8, airborne: 16, away: 32 } as const;
// A player whose position has not changed sends it this often instead of every 50 ms: often
// enough that the coordinator, which ignores positions over 1.5 s old, still counts them.
const STILL_INTERVAL_MS = 250;
const POSE_FIELDS = ["east", "north", "heading", "pitch", "moving", "running", "crouching", "sliding", "airborne", "lean", "away"] as const;
// Standing on the ground, the height above it wavers by a centimetre from one frame to the
// next, so a change of under 1.5 cm counts as none.
const samePose = (a: PosePacket, b: PosePacket): boolean => POSE_FIELDS.every((key) => a[key] === b[key]) && Math.abs(a.jumpHeight - b.jumpHeight) < 0.015;

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
    | (packet.sliding ? FLAG.sliding : 0) | (packet.airborne ? FLAG.airborne : 0) | (packet.away ? FLAG.away : 0));
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
    sliding: (flags & FLAG.sliding) !== 0, airborne: (flags & FLAG.airborne) !== 0, away: (flags & FLAG.away) !== 0,
  };
}

// Numbers in the coordinator's updates go as text to four decimal places, a tenth of a
// millimetre in a position: "1.7350637578964234" becomes "1.7351". Whole numbers, such as
// times, stay as they are.
const trimNumber = (_key: string, value: unknown): unknown =>
  typeof value === "number" && !Number.isInteger(value) && Math.abs(value) < 1e6 ? Math.round(value * 1e4) / 1e4 : value;

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
    && (packet.lean === undefined || (Number.isFinite(packet.lean) && Math.abs(packet.lean) <= 1))
    && (packet.away === undefined || typeof packet.away === "boolean");
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
  private leaderAction;
  private fitnessAction;
  private peers = new Set<string>();
  private lastSequence = new Map<string, number>();
  private lastAcceptedPose = new Map<string, { east: number; north: number; receivedAt: number; sentAt: number }>();
  // Each peer's position lane: unordered and never resent, so a lost packet holds up nothing
  // behind it, and a late position is simply superseded by the next.
  private lanes = new Map<string, RTCDataChannel>();
  // The last position sent and when, and the newest one held back since because it was the same.
  private lastPose: PosePacket | null = null;
  private lastPoseAt = 0;
  private heldPose: PosePacket | null = null;
  private lastIntentSequence = new Map<string, number>();
  private sequence = 0;
  private intentSequence = 0;
  private sending = false;
  private failed = false;
  private expectedMap: string;
  private leaderId = selfId;
  private handoffUntil = 0;
  // The epoch of the coordinator this peer follows. A lone peer leads itself at epoch 0. A new
  // room settles on its lowest id, which then moves to epoch 1, so a peer joining later never
  // displaces it; each handover adds one. A peer takes a coordinator another announces if its
  // epoch is higher, or the same with a lower id, and only once connected to it.
  private epoch = 0;
  // The highest epoch any peer has announced, and the peers that have announced one. A peer
  // settles a new room only once every peer has told it whom it follows, all at epoch 0; one
  // that has heard of a settled room waits to reach that room's coordinator instead.
  private heardEpoch = 0;
  private announced = new Set<string>();
  private fitness = new Map<string, FitnessPacket & { at: number }>();
  private own: (FitnessPacket & { at: number }) | null = null;
  // A timer due every 100 ms runs late by as long as the main thread is busy when it falls
  // due, which is how long a message arriving then waits too. A frame rate would not show
  // this: a processor slowed to a quarter speed still drew as many frames, the graphics card
  // being the limit, while its timers ran four times as late. A peer reports the median of
  // its last ten two-second medians, so a stall of under ten seconds moves it not at all,
  // while a slow machine, slow in every window, shows within twelve. The coordinator stalls
  // like that in a fight, when every shot comes to it at once or a blast throws props it
  // alone simulates, and recovers once the moment passes.
  private late: number[] = [];
  private lags: number[] = [];
  private lagTimer = 0;
  private fitnessTimer = 0;
  private leadingSince = performance.now();
  private betterChecks = 0;
  // The newest event broadcast so far, and when the last broadcast left; see broadcastSnapshot.
  private lastSentEvent = 0;
  private lastBroadcastAt = 0;
  private broadcastTimer = 0;
  // What this coordinator last sent its peers, so each update carries only what has changed
  // since; null until its first update, which carries the whole state.
  private sent: SentState | null = null;
  // The coordinator whose state this peer holds: its changes apply only on top of its own state.
  private held = "";
  private syncAsked = { of: "", at: 0 };
  // When each peer was last heard from, and the peers whose tabs are in the background.
  private lastHeard = new Map<string, number>();
  private away = new Set<string>();
  private silenceTimer = 0;
  private lastSilenceCheck = performance.now();
  // The coordinator found unheard at the last check, if any.
  private unheard = "";
  private onVisibility = (): void => this.visibilityChanged();

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
    this.leaderAction = this.room.makeAction<LeaderPacket>("leader-v1");
    this.fitnessAction = this.room.makeAction<FitnessPacket>("fitness-v1");
    this.leaderAction.onMessage = (value, { peerId }) => {
      if (!this.peers.has(peerId) || value.version !== PROTOCOL_VERSION || value.map !== this.expectedMap || typeof value.leader !== "string" || value.leader.length > 64
        || !Number.isSafeInteger(value.epoch) || value.epoch < 0) return;
      this.announced.add(peerId);
      this.hear(value.leader, value.epoch);
    };
    this.fitnessAction.onMessage = (value, { peerId }) => {
      if (this.leaderId !== selfId || !this.peers.has(peerId) || value.version !== PROTOCOL_VERSION || value.map !== this.expectedMap
        || !Number.isFinite(value.lag) || !value.rtt || typeof value.rtt !== "object") return;
      const rtt: Record<string, number> = {};
      for (const [id, ms] of Object.entries(value.rtt)) if ((id === selfId || this.peers.has(id)) && Number.isFinite(ms) && ms >= 0) rtt[id] = Math.min(ms, 5000);
      this.fitness.set(peerId, { version: value.version, map: value.map, lag: Math.max(0, Math.min(5000, value.lag)), rtt, at: performance.now() });
    };
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
      if (!value || (!value.state && !value.delta)) return;
      if (!this.peers.has(peerId) || value.version !== PROTOCOL_VERSION || value.map !== this.expectedMap || value.leader !== peerId) return;
      this.lastHeard.set(peerId, performance.now());
      if (peerId !== this.leaderId && !(this.leaderId === selfId && Date.now() < this.handoffUntil)) return;
      // The first whole state from a new coordinator replaces what this peer held, whatever
      // its revision; changes it cannot place on what it holds, it asks to have resent whole.
      const accepted = value.delta ? this.held === peerId && this.match.applyDelta(value.delta)
        : !!value.state && this.match.adopt(value.state, peerId === this.leaderId && this.held !== peerId);
      if (!accepted) {
        if (value.delta && peerId === this.leaderId) this.askSync(peerId);
        return;
      }
      this.held = peerId;
      // A respawn teleports the player, so its next pose must not fail the distance check.
      for (const event of (value.delta ?? value.state)?.events ?? []) if (event?.kind === "respawn") this.lastAcceptedPose.delete(event.actor);
      if (this.leaderId === selfId) {
        this.match.ensurePlayer(selfId);
        this.broadcastSnapshot();
      }
    };
    this.syncAction.onMessage = (value, { peerId }) => {
      if (this.leaderId === selfId && this.peers.has(peerId) && value.version === PROTOCOL_VERSION && value.map === this.expectedMap) this.sendSnapshot(peerId);
    };
    this.room.onPeerJoin = (peerId) => {
      const wasLeader = this.leaderId === selfId;
      this.peers.add(peerId);
      this.lastHeard.set(peerId, performance.now());
      this.openLane(peerId);
      // Every peer tells a newcomer whom it follows; the coordinator also sends its state.
      void this.leaderAction.send({ version: PROTOCOL_VERSION, map: this.expectedMap, leader: this.leaderId, epoch: this.epoch }, { target: peerId }).catch(() => undefined);
      if (wasLeader) {
        this.match.ensurePlayer(peerId);
        this.sendSnapshot(peerId);
      }
      // Until a room has settled on a coordinator, its lowest id coordinates.
      if (this.epoch === 0) this.setLeader([selfId, ...this.peers].sort()[0]);
      this.reportPeers();
      this.events.onStatus(`${this.peers.size + 1} players connected directly.`);
    };
    this.room.onPeerLeave = (peerId) => this.dropPeer(peerId);
    this.reportPeers();
    this.events.onStatus("Waiting for a friend to join…");
    this.probeLag();
    this.fitnessTimer = window.setInterval(() => void this.checkFitness(), FITNESS_MS);
    this.silenceTimer = window.setInterval(() => this.checkSilence(), SILENCE_CHECK_MS);
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  // A peer that has left, by Trystero's account or by its own goodbye, whichever comes first.
  private dropPeer(peerId: string): void {
    if (!this.peers.delete(peerId)) return;
    this.closeLane(peerId);
    this.lastSequence.delete(peerId);
    this.lastAcceptedPose.delete(peerId);
    this.lastIntentSequence.delete(peerId);
    this.match.removePose(peerId);
    this.fitness.delete(peerId);
    this.announced.delete(peerId);
    this.lastHeard.delete(peerId);
    this.away.delete(peerId);
    this.events.onPeerLeave(peerId);
    // A coordinator that leaves is succeeded by the lowest id left, at the same epoch.
    if (peerId === this.leaderId) this.setLeader([selfId, ...this.peers].sort()[0]);
    else this.broadcastSnapshot();
    this.reportPeers();
    this.events.onStatus(this.peers.size ? `${this.peers.size + 1} players connected directly.` : "Waiting for a friend to join…");
  }

  private receivePose(value: unknown, peerId: string): void {
    if (!this.peers.has(peerId) || !validPose(value, this.expectedMap)) return;
    const now = performance.now();
    this.lastHeard.set(peerId, now);
    const half = this.arena.sizeMeters / 2 + 0.5;
    if (Math.abs(value.east) > half || Math.abs(value.north) > half) return;
    const previous = this.lastSequence.get(peerId) ?? -1;
    if (value.sequence <= previous) return;
    if (value.away) this.away.add(peerId);
    else this.away.delete(peerId);
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
        if (data instanceof ArrayBuffer && data.byteLength === 1 && new Uint8Array(data)[0] === PROTOCOL_VERSION) { this.dropPeer(peerId); return; }
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

  // Takes the coordinator another peer announces if it ranks above the one this peer follows.
  private hear(leader: string, epoch: number): void {
    this.heardEpoch = Math.max(this.heardEpoch, epoch);
    if (leader !== selfId && !this.peers.has(leader)) return;
    if (epoch < this.epoch || (epoch === this.epoch && leader >= this.leaderId)) return;
    this.epoch = epoch;
    this.setLeader(leader);
  }

  private setLeader(next: string): void {
    if (next === this.leaderId) {
      if (next === selfId) this.broadcastSnapshot();
      return;
    }
    this.leaderId = next;
    this.handoffUntil = Date.now() + 1800;
    this.sent = null;
    this.betterChecks = 0;
    if (next === selfId) {
      this.held = "";
      this.leadingSince = performance.now();
      for (const peerId of this.peers) this.match.ensurePlayer(peerId);
      window.setTimeout(() => this.broadcastSnapshot(), 500);
    } else this.askSync(next);
  }

  private probeLag(): void {
    const due = performance.now() + 100;
    this.lagTimer = window.setTimeout(() => {
      if (this.late.length < 100) this.late.push(Math.max(0, performance.now() - due));
      this.probeLag();
    }, 100);
  }

  // Every two seconds: this peer measures how late its timers ran and its round trips. Others
  // report them to the coordinator; the coordinator settles a new room, repeats whom the room
  // follows for any peer that missed it, and weighs handing over.
  private async checkFitness(): Promise<void> {
    // A page in the background runs timers about once a second, if that.
    const late = this.late.sort((a, b) => a - b);
    this.lags = [...this.lags.slice(-9), late.length ? late[Math.floor(late.length / 2)] : 1000];
    this.late = [];
    const lag = [...this.lags].sort((a, b) => a - b)[Math.floor(this.lags.length / 2)];
    if (!this.peers.size) return;
    const rtt = await this.roundTrips();
    this.own = { version: PROTOCOL_VERSION, map: this.expectedMap, lag, rtt, at: performance.now() };
    if (this.leaderId !== selfId) {
      void this.fitnessAction.send({ version: PROTOCOL_VERSION, map: this.expectedMap, lag, rtt }, { target: this.leaderId }).catch(() => undefined);
      return;
    }
    if (this.epoch === 0 && this.heardEpoch === 0 && [...this.peers].every((peerId) => this.announced.has(peerId))) this.epoch = 1;
    void this.leaderAction.send({ version: PROTOCOL_VERSION, map: this.expectedMap, leader: selfId, epoch: this.epoch }).catch(() => undefined);
    this.weighHandover(performance.now());
  }

  // Each peer's round trip in ms, from the connection's selected candidate pair.
  private async roundTrips(): Promise<Record<string, number>> {
    const rtt: Record<string, number> = {};
    await Promise.all([...this.peers].map(async (peerId) => {
      try {
        const report = await this.room.getPeers()[peerId]?.getStats();
        report?.forEach((entry: RTCIceCandidatePairStats) => {
          if (entry.type === "candidate-pair" && entry.nominated && entry.state === "succeeded" && typeof entry.currentRoundTripTime === "number") rtt[peerId] = Math.round(entry.currentRoundTripTime * 1000);
        });
      } catch {
        // No figure for this peer this time.
      }
    }));
    return rtt;
  }

  // What a peer coordinating would add to each shot: its average round trip to the others, and
  // how long its main thread keeps a message waiting. Null without a recent report.
  private delayOf(id: string, now: number): number | null {
    const report = id === selfId ? this.own : this.fitness.get(id);
    if (!report || now - report.at > 3 * FITNESS_MS) return null;
    const others = [selfId, ...this.peers].filter((member) => member !== id);
    let total = 0;
    for (const member of others) {
      const trip = report.rtt[member] ?? (member === selfId ? this.own : this.fitness.get(member))?.rtt[id];
      if (trip === undefined) return null;
      total += trip;
    }
    return total / Math.max(1, others.length) + report.lag;
  }

  private weighHandover(now: number): void {
    const mine = this.delayOf(selfId, now);
    const others = [...this.peers].flatMap((peerId) => { const delay = this.delayOf(peerId, now); return delay === null ? [] : [{ peerId, delay }]; }).sort((a, b) => a.delay - b.delay);
    const best = others[0]?.peerId ?? "", typical = others[Math.floor(others.length / 2)]?.delay ?? Infinity;
    const clearlyBetter = mine !== null && best !== "" && typical < mine * HANDOVER_RATIO && mine - typical >= HANDOVER_GAIN_MS;
    this.betterChecks = clearlyBetter ? this.betterChecks + 1 : 0;
    if (clearlyBetter && this.betterChecks >= HANDOVER_CHECKS && now - this.leadingSince > HANDOVER_SETTLE_MS) this.handOver(best);
  }

  // Everyone gets the latest changes first, so the new coordinator starts from the same state.
  private handOver(to: string): void {
    window.clearTimeout(this.broadcastTimer);
    this.broadcastTimer = 0;
    this.broadcastNow();
    this.epoch += 1;
    void this.leaderAction.send({ version: PROTOCOL_VERSION, map: this.expectedMap, leader: to, epoch: this.epoch }).catch(() => undefined);
    this.setLeader(to);
  }

  // Who should coordinate instead of `gone`: the lowest id among this peer and the peers heard
  // from lately, preferring those whose tabs are in front. Null if no one qualifies.
  private successor(gone: string, includeSelf: boolean): string | null {
    const now = performance.now();
    const live = [...(includeSelf ? [selfId] : []), ...this.peers].filter((id) => id !== gone
      && (id === selfId || now - (this.lastHeard.get(id) ?? -Infinity) < HOST_SILENCE_MS));
    const present = live.filter((id) => !(id === selfId ? document.hidden : this.away.has(id)));
    return (present.length ? present : includeSelf ? live : []).sort()[0] ?? null;
  }

  // A coordinator unheard for two seconds has gone: the lowest live peer takes over at the next
  // epoch, as if it had left, and everyone follows the announcement.
  private checkSilence(): void {
    const now = performance.now(), gap = now - this.lastSilenceCheck, leader = this.leaderId;
    this.lastSilenceCheck = now;
    // After a stall of this page's own, the messages that arrived meanwhile are read only after
    // this check, so a coordinator counts as gone only if it is still unheard at the next.
    const silent = gap <= 1500 && leader !== selfId && this.peers.has(leader) && now - (this.lastHeard.get(leader) ?? now) >= HOST_SILENCE_MS;
    const confirmed = silent && this.unheard === leader;
    this.unheard = silent ? leader : "";
    if (!confirmed) return;
    // A peer that hears none of the others has lost its own connection, not the coordinator.
    const others = [...this.peers].filter((id) => id !== leader);
    if (others.length && !others.some((id) => now - (this.lastHeard.get(id) ?? -Infinity) < HOST_SILENCE_MS)) return;
    const next = this.successor(leader, true);
    if (!next) return;
    this.epoch += 1;
    void this.leaderAction.send({ version: PROTOCOL_VERSION, map: this.expectedMap, leader: next, epoch: this.epoch }).catch(() => undefined);
    this.setLeader(next);
  }

  // A tab in the background runs its timers once a second at most, and none of its frames, so
  // its coordinator hands over at once to a peer whose tab is in front; before, it held on for
  // 14 s until its slowness showed. Its position goes out now, saying it is away.
  private visibilityChanged(): void {
    if (this.lastPose) {
      this.lastPose = { ...this.lastPose, sequence: ++this.sequence, sentAt: Date.now(), away: document.hidden };
      this.lastPoseAt = performance.now();
      this.heldPose = null;
      this.transmitPose(this.lastPose);
    }
    if (!document.hidden || this.leaderId !== selfId) return;
    const next = this.successor(selfId, false);
    if (next) this.handOver(next);
  }

  // Asks the coordinator for its whole state, at most once every two seconds.
  private askSync(leader: string): void {
    const now = performance.now();
    if (this.syncAsked.of === leader && now - this.syncAsked.at < 2000) return;
    this.syncAsked = { of: leader, at: now };
    void this.syncAction.send({ version: PROTOCOL_VERSION, map: this.expectedMap }, { target: leader }).catch(() => undefined);
  }

  private packet(body: { state: CombatSnapshot } | { delta: CombatDelta }): string {
    return JSON.stringify({ version: PROTOCOL_VERSION, map: this.expectedMap, leader: selfId, ...body }, trimNumber);
  }

  // The whole state with its recent events, for a peer joining or catching up. Pending changes
  // go out first, so the state sent here is the one the next changes are made against.
  private sendSnapshot(peerId: string): void {
    window.clearTimeout(this.broadcastTimer);
    this.broadcastTimer = 0;
    this.broadcastNow();
    void this.snapshotAction.send(this.packet({ state: this.match.view() }), { target: peerId }).catch(() => undefined);
  }

  // Changes go out at most 20 times a second.
  private broadcastSnapshot(): void {
    if (this.leaderId !== selfId || !this.peers.size) return;
    const wait = this.lastBroadcastAt + 50 - performance.now();
    if (wait > 0) {
      if (!this.broadcastTimer) this.broadcastTimer = window.setTimeout(() => { this.broadcastTimer = 0; this.broadcastSnapshot(); }, wait);
      return;
    }
    this.broadcastNow();
  }

  // The first update as coordinator carries the whole state; each one after carries only what
  // has changed since the one before: the fields of each player that changed, such as one
  // gun's rounds, the objects hit and the events since. The whole state, with the 32 most
  // recent events, made a firefight between three players send over 100 KB a second to each.
  // The channel is reliable and ordered, so a peer misses none of them.
  private broadcastNow(): void {
    this.lastBroadcastAt = performance.now();
    if (!this.sent) {
      const state = this.match.view(this.lastSentEvent);
      this.sent = this.match.sent();
      this.lastSentEvent = state.eventSeq;
      void this.snapshotAction.send(this.packet({ state })).catch(() => undefined);
      return;
    }
    const delta = this.match.delta(this.sent, this.lastSentEvent);
    if (!delta) return;
    this.lastSentEvent = delta.eventSeq;
    void this.snapshotAction.send(this.packet({ delta })).catch(() => undefined);
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
      away: document.hidden,
    };
    // Standing still, a player sends the same position only every quarter second. When they
    // move again, the position they held goes out first, stamped at the moment before, so
    // others see them set off then rather than glide from where the last one put them.
    const now = performance.now(), last = this.lastPose;
    if (last && samePose(packet, last)) {
      if (now - this.lastPoseAt < STILL_INTERVAL_MS) { this.heldPose = packet; return; }
    } else if (this.heldPose) this.transmitPose(this.heldPose);
    this.heldPose = null;
    this.lastPose = packet;
    this.lastPoseAt = now;
    this.transmitPose(packet);
  }

  private transmitPose(packet: PosePacket): void {
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
    this.leaderAction.onMessage = null;
    this.fitnessAction.onMessage = null;
    window.clearTimeout(this.lagTimer);
    window.clearInterval(this.fitnessTimer);
    window.clearInterval(this.silenceTimer);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.room.onPeerJoin = null;
    this.room.onPeerLeave = null;
    window.clearTimeout(this.broadcastTimer);
    this.sent = null;
    // Trystero's goodbye goes out once its message is ready, and it closes the connections 99 ms
    // later; a tab being closed is gone by then, and its peers waited 12 to 14 s to notice, until
    // the connection failed. A goodbye on each lane goes out at once, and closing the connections
    // now tells the peers at the other end within a few seconds if the goodbye is lost.
    for (const lane of this.lanes.values()) if (lane.readyState === "open") lane.send(GOODBYE);
    for (const peerId of [...this.lanes.keys()]) this.closeLane(peerId);
    const leaving = this.room.leave();
    for (const connection of Object.values(this.room.getPeers())) connection.close();
    await leaving;
    this.peers.clear();
    this.lastSequence.clear();
    this.lastAcceptedPose.clear();
    this.lastIntentSequence.clear();
  }
}
