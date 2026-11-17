import { terrainHeight, type ArenaData } from "../world/arena";
import { type ShotRay } from "../world/physics";
import { type MatchState } from "./matchState";
import { type PlayerPose } from "./playerController";

// Practice targets for a solo game: figures that stand or walk a beat in the market. Each one
// is a player in the match with no person behind it, so shots, blasts, thrown props, the kill
// feed and the score all work on it as on a real opponent, and it falls as a ragdoll and drops
// its pistol. A target comes back a few seconds after it falls. They leave when a room is joined.

// Where one target stands or walks. `path` is its beat in map metres (east, north): one point
// for a target that stands still, more for one that walks to the end and back. `height` is the
// floor it is on, above the ground. `speed` is in metres per second (a walk is about 1.6, a
// run over 6), and `pause` is how long it waits at each end, in seconds.
interface Beat { name: string; path: [number, number][]; height?: number; speed?: number; pause?: number; crouch?: boolean }

const BEATS: Beat[] = [
  // The lantern street (the west alley), from the south spawn to the food truck.
  // The beats run along lanes that are clear of stalls, tables and heaps as the map is built.
  { name: "Target 1", path: [[-4, 16]] },
  { name: "Target 2", path: [[-6, 20], [-6, -22]], speed: 1.6, pause: 2 },
  { name: "Target 3", path: [[-2, -22], [-2, 22]], speed: 6.4, pause: 1.2 },
  { name: "Target 4", path: [[-4, -22]], crouch: true },
  // The cut between the two alleys.
  { name: "Target 5", path: [[-1, 1.5], [11, 1.5]], speed: 1.6, pause: 1.5 },
  // The service alley (the east alley).
  { name: "Target 6", path: [[12.75, 14]] },
  { name: "Target 7", path: [[13.5, -20], [13.5, 12]], speed: 1.6, pause: 2.5 },
  // High ground: the fire escape over the lantern street.
  { name: "Target 8", path: [[-7.8, -19.4]], height: 4.6 },
];

// How long after it could respawn a fallen target stays down, in milliseconds.
const DOWN_EXTRA_MS = 1500;

// What the targets need of the world: to be drawn, and to test their beats against it.
export interface TargetWorld {
  arenaData(): ArenaData;
  setRemotePose(id: string, pose: PlayerPose, sentAt: number): void;
  removeRemotePeer(id: string): void;
  clearShot(ray: ShotRay): boolean;
  playerPose(): PlayerPose;
}

interface Target { id: string; beat: Beat; path: [number, number][]; along: number; forward: boolean; waitUntil: number; heading: number }

export class SoloTargets {
  private targets: Target[] = [];
  private last = 0;

  constructor(private match: MatchState, private world: TargetWorld) {
    BEATS.forEach((beat, index) => {
      const path = this.walkable(beat);
      this.targets.push({ id: `target:${index + 1}`, beat, path, along: 0, forward: true, waitUntil: 0, heading: 0 });
    });
  }

  ids(): string[] { return this.targets.map((target) => target.id); }

  // The part of a beat a figure can walk: up to the first stretch with something solid across
  // it at shin, waist or head height. A beat that is blocked from the start is a standing post.
  private walkable(beat: Beat): [number, number][] {
    const data = this.world.arenaData(), path: [number, number][] = [beat.path[0]];
    for (let i = 1; i < beat.path.length; i += 1) {
      const [ax, az] = beat.path[i - 1], [bx, bz] = beat.path[i], length = Math.hypot(bx - ax, bz - az);
      const floor = terrainHeight(data, ax, az) + (beat.height ?? 0);
      const clear = [0.35, 1.0, 1.65].every((y) => this.world.clearShot({ origin: { x: ax, y: floor + y, z: az }, direction: { x: (bx - ax) / length, y: 0, z: (bz - az) / length }, distance: length }));
      if (!clear) break;
      path.push(beat.path[i]);
    }
    return path;
  }

  private place(target: Target): { east: number; north: number; turn: number | null } {
    const path = target.path;
    let left = target.along;
    for (let i = 1; i < path.length; i += 1) {
      const [ax, az] = path[i - 1], [bx, bz] = path[i], length = Math.hypot(bx - ax, bz - az);
      if (left <= length || i === path.length - 1) {
        const t = Math.max(0, Math.min(1, left / length)), way = target.forward ? 1 : -1;
        return { east: ax + (bx - ax) * t, north: az + (bz - az) * t, turn: Math.atan2((bx - ax) * way, (bz - az) * way) * 180 / Math.PI };
      }
      left -= length;
    }
    return { east: path[0][0], north: path[0][1], turn: null };
  }

  // Moves every target and tells the match and the view where each one is. Call it about 30
  // times a second, as a real player's position is sent.
  update(now = Date.now()): void {
    const seconds = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0;
    this.last = now;
    const self = this.world.playerPose();
    for (const target of this.targets) {
      let player = this.match.player(target.id);
      if (!player) {
        this.match.addDummy(target.id, target.beat.name);
        player = this.match.player(target.id);
        target.along = 0; target.forward = true; target.waitUntil = 0;
      }
      if (!player) continue;
      if (player.health <= 0) {
        if (now < player.respawnAfter + DOWN_EXTRA_MS || !this.match.apply(target.id, { kind: "respawn" }, now)) continue;
        // It comes back at the end of its beat that is further from the player.
        const length = this.lengthOf(target), [sx, sz] = target.path[0], [ex, ez] = target.path[target.path.length - 1];
        const atEnd = Math.hypot(ex - self.east, ez - self.north) > Math.hypot(sx - self.east, sz - self.north);
        target.along = atEnd ? length : 0; target.forward = !atEnd; target.waitUntil = now + 800;
      }
      const length = this.lengthOf(target), speed = target.beat.speed ?? 0;
      const walking = length > 0 && speed > 0 && now >= target.waitUntil;
      if (walking) {
        target.along += (target.forward ? 1 : -1) * speed * seconds;
        if (target.along >= length || target.along <= 0) {
          target.along = Math.max(0, Math.min(length, target.along));
          target.forward = !target.forward;
          target.waitUntil = now + (target.beat.pause ?? 1) * 1000;
        }
      }
      const at = this.place(target);
      // A target that stands, or waits at the end of its beat, turns to face the player.
      const facing = Math.atan2(self.east - at.east, self.north - at.north) * 180 / Math.PI;
      const wanted = walking && at.turn !== null ? at.turn : facing;
      const turn = ((wanted - target.heading + 540) % 360) - 180;
      target.heading = (target.heading + Math.max(-1, Math.min(1, turn / Math.max(1e-6, Math.abs(turn)))) * Math.min(Math.abs(turn), 360 * seconds) + 360) % 360;
      const pose: PlayerPose = {
        east: at.east, north: at.north, heading: target.heading, pitch: 0, jumpHeight: target.beat.height ?? 0,
        moving: walking, running: walking && speed > 5, crouching: !!target.beat.crouch && !walking,
        sliding: false, airborne: false, lean: 0, aiming: false, carrying: false,
      };
      this.match.setPose(target.id, pose, now);
      this.world.setRemotePose(target.id, pose, now);
    }
  }

  private lengthOf(target: Target): number {
    let length = 0;
    for (let i = 1; i < target.path.length; i += 1) length += Math.hypot(target.path[i][0] - target.path[i - 1][0], target.path[i][1] - target.path[i - 1][1]);
    return length;
  }

  // Takes the targets out of the match and the view, as when a room is joined.
  clear(): void {
    for (const target of this.targets) {
      this.match.removePlayer(target.id);
      this.world.removeRemotePeer(target.id);
    }
  }
}
