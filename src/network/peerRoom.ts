import { joinRoom, selfId } from "trystero";
import { type Arena } from "../world/arena";
import { type PlayerPose } from "../game/playerController";

const APP_ID = "io.github.kushagrabainsla.hereafter.v1";
const PROTOCOL_VERSION = 1;
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
};

export interface PeerRoomEvents {
  onPeers: (count: number, spawnSlot: number) => void;
  onPose: (peerId: string, pose: PlayerPose) => void;
  onPeerLeave: (peerId: string) => void;
  onStatus: (message: string) => void;
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
    && Number.isFinite(packet.jumpHeight) && (packet.jumpHeight ?? -1) >= 0 && (packet.jumpHeight ?? 11) <= 10
    && typeof packet.moving === "boolean" && typeof packet.running === "boolean" && typeof packet.crouching === "boolean";
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
  private peers = new Set<string>();
  private lastSequence = new Map<string, number>();
  private sequence = 0;
  private sending = false;
  private failed = false;
  private expectedMap: string;

  private reportPeers(): void {
    const members = [selfId, ...this.peers].sort();
    this.events.onPeers(members.length, members.indexOf(selfId));
  }

  constructor(code: string, arena: Arena, private events: PeerRoomEvents) {
    this.code = normalizeRoomCode(code);
    if (this.code.length < 6 || this.code.length > 24) throw new Error("Room code must be 6–24 letters or numbers.");
    this.expectedMap = mapKey(arena);
    this.room = joinRoom({ appId: APP_ID, password: this.code }, this.code, {
      onJoinError: () => this.events.onStatus("A peer could not connect. Try another network or leave and rejoin."),
    });
    this.poseAction = this.room.makeAction<PosePacket>("pose-v1");
    this.poseAction.onMessage = (value, { peerId }) => {
      if (!this.peers.has(peerId) || !validPose(value, this.expectedMap)) return;
      const previous = this.lastSequence.get(peerId) ?? -1;
      if (value.sequence <= previous) return;
      this.lastSequence.set(peerId, value.sequence);
      this.events.onPose(peerId, {
        east: value.east,
        north: value.north,
        heading: value.heading,
        pitch: value.pitch,
        jumpHeight: value.jumpHeight,
        moving: value.moving,
        running: value.running,
        crouching: value.crouching,
      });
    };
    this.room.onPeerJoin = (peerId) => {
      this.peers.add(peerId);
      this.reportPeers();
      this.events.onStatus(`${this.peers.size + 1} players connected directly.`);
    };
    this.room.onPeerLeave = (peerId) => {
      this.peers.delete(peerId);
      this.lastSequence.delete(peerId);
      this.events.onPeerLeave(peerId);
      this.reportPeers();
      this.events.onStatus(this.peers.size ? `${this.peers.size + 1} players connected directly.` : "Waiting for a friend to join…");
    };
    this.reportPeers();
    this.events.onStatus("Waiting for a friend to join…");
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
    this.room.onPeerJoin = null;
    this.room.onPeerLeave = null;
    await this.room.leave();
    this.peers.clear();
    this.lastSequence.clear();
  }
}
