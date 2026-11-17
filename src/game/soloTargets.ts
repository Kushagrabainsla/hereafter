import { terrainHeight, type ArenaData } from "../world/arena";
import { type ShotRay } from "../world/physics";
import { type MatchState } from "./matchState";
import { type PlayerPose } from "./playerController";

// Practice opponents for a solo game: figures that stand or walk a beat in the market, and
// shoot back. Each one is a player in the match with no person behind it, so shots, blasts,
// thrown props, the kill feed and the score all work on it as on a real opponent, and it falls
// as a ragdoll and drops its pistol. It comes back a few seconds after it falls. They leave
// when a room is joined.

// Where one target stands or walks. `path` is its beat in map metres (east, north): one point
// for a target that stands still, more for one that walks to the end and back. `height` is the
// floor it is on, above the ground. `speed` is in metres per second (a walk is about 1.6, a
// run over 6), and `pause` is how long it waits at each end, in seconds. `face` is the way a
// standing target looks until something alerts it, in degrees (0 looks north, up the map; 180
// looks south): the standing ones look away from the nearest spawn, so the player can come up
// behind them.
interface Beat { name: string; path: [number, number][]; height?: number; speed?: number; pause?: number; crouch?: boolean; face?: number }

const BEATS: Beat[] = [
  // The lantern street (the west alley), from the south spawn to the food truck.
  // The beats run along lanes that are clear of stalls, tables and heaps as the map is built.
  { name: "Target 1", path: [[-4, 16]], face: 180 },
  { name: "Target 2", path: [[-6, 20], [-6, -22]], speed: 1.6, pause: 2 },
  { name: "Target 3", path: [[-2, -22], [-2, 22]], speed: 6.4, pause: 1.2 },
  { name: "Target 4", path: [[-4, -22]], crouch: true, face: 0 },
  // The cut between the two alleys.
  { name: "Target 5", path: [[-1, 1.5], [11, 1.5]], speed: 1.6, pause: 1.5 },
  // The service alley (the east alley).
  { name: "Target 6", path: [[12.75, 14]], face: 180 },
  { name: "Target 7", path: [[13.5, -20], [13.5, 12]], speed: 1.6, pause: 2.5 },
  // High ground: the fire escape over the lantern street.
  { name: "Target 8", path: [[-7.8, -19.4]], height: 4.6, face: 60 },
];

// How the targets fight. They are for practice: slow to react and poor shots at first, so one of
// them is a fair fight and three at once are not.
export const BOT = {
  // How far a target can see the player, in metres, and how far to each side of where it faces,
  // in degrees. One that has been hit, or has just seen the player, sees all round.
  sight: 26,
  cone: 75,
  // The time from first seeing the player to the first shot, in seconds: a new time each
  // sighting, between these two.
  reaction: [0.6, 1.0],
  // The time between shots, in seconds, between these two.
  between: [0.65, 1.1],
  // How far off its aim can be, in degrees to each side: at the first shot, and once it has
  // had the player in sight for `settle` seconds.
  errorFirst: 6,
  errorSettled: 2.6,
  settle: 3.5,
  // The share of that error it has up and down. Low, so a miss goes wide, not into the head.
  errorUpDown: 0.3,
  // More error for each metre per second the player moves.
  errorPerSpeed: 0.35,
  // How fast it turns to face the player, in degrees per second.
  turn: 240,
  // How long it stays alert after it loses sight of the player, in seconds.
  memory: 3,
  // No target notices a player who came into the game, or back into it, less than this long
  // ago, in seconds. And none notices a player who has not yet moved this far from where they
  // came in, in metres, and has not hurt a target: a player who stands at the spawn to read the
  // controls is left alone.
  grace: 4,
  graceMove: 2.5,
  // How long a fallen target stays down after it could respawn, in milliseconds.
  downExtraMs: 1500,
};

// Where a target looks from, and the height on the player it aims at: the belly, so its misses go
// wide and it rarely hits the head.
const EYE = 1.6, CROUCH_EYE = 1.05, CHEST = 1.0;
const between = ([low, high]: number[]): number => low + Math.random() * (high - low);
const turnTo = (from: number, to: number, most: number): number => {
  const turn = ((to - from + 540) % 360) - 180;
  return (from + Math.max(-most, Math.min(most, turn)) + 360) % 360;
};

// What the targets need of the world: to be drawn, and to test their beats and their line of
// sight against it.
export interface TargetWorld {
  arenaData(): ArenaData;
  setRemotePose(id: string, pose: PlayerPose, sentAt: number): void;
  removeRemotePeer(id: string): void;
  clearShot(ray: ShotRay): boolean;
  playerPose(): PlayerPose;
}

interface Target {
  id: string; beat: Beat; path: [number, number][]; along: number; forward: boolean; waitUntil: number; heading: number; pitch: number;
  // Fighting: its health when last looked at, how long it stays alert, since when it has had the
  // player in sight (0: not in sight), and when it fires next.
  health: number; alertUntil: number; seenSince: number; fireAt: number;
}

export class SoloTargets {
  private targets: Target[] = [];
  private last = 0;
  private lastSelf: { east: number; north: number } | null = null;
  private selfSpeed = 0;
  // Whether the player was alive at the last look, and since when they have been.
  private selfWasAlive = false;
  private selfAliveSince = 0;
  // Where the player came into the game, and whether they have left that spot or hurt a target.
  private selfCameIn: { east: number; north: number } | null = null;
  private selfEngaged = false;

  constructor(private match: MatchState, private world: TargetWorld, private selfId: string) {
    BEATS.forEach((beat, index) => {
      this.targets.push({ id: `target:${index + 1}`, beat, path: this.walkable(beat), along: 0, forward: true, waitUntil: 0, heading: beat.face ?? 0, pitch: 0, health: 100, alertUntil: 0, seenSince: 0, fireAt: 0 });
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

  private lengthOf(target: Target): number {
    let length = 0;
    for (let i = 1; i < target.path.length; i += 1) length += Math.hypot(target.path[i][0] - target.path[i - 1][0], target.path[i][1] - target.path[i - 1][1]);
    return length;
  }

  // Moves every target, lets it look for the player and shoot, and tells the match and the view
  // where each one is. Call it about 30 times a second, as a real player's position is sent.
  update(now = Date.now()): void {
    const seconds = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0;
    this.last = now;
    const data = this.world.arenaData(), self = this.world.playerPose(), selfAlive = (this.match.player(this.selfId)?.health ?? 0) > 0;
    if (selfAlive && !this.selfWasAlive) { this.selfAliveSince = now; this.selfCameIn = null; this.selfEngaged = false; }
    this.selfWasAlive = selfAlive;
    // The spot is taken a moment after the player comes in, once the view has put them there.
    if (selfAlive && !this.selfCameIn && now - this.selfAliveSince > 400) this.selfCameIn = { east: self.east, north: self.north };
    if (this.selfCameIn && Math.hypot(self.east - this.selfCameIn.east, self.north - this.selfCameIn.north) > BOT.graceMove) this.selfEngaged = true;
    const grace = !this.selfEngaged || now - this.selfAliveSince < BOT.grace * 1000;
    if (this.lastSelf && seconds > 0) this.selfSpeed += (Math.hypot(self.east - this.lastSelf.east, self.north - this.lastSelf.north) / seconds - this.selfSpeed) * Math.min(1, seconds * 6);
    this.lastSelf = { east: self.east, north: self.north };
    const selfFeet = terrainHeight(data, self.east, self.north) + self.jumpHeight, selfChest = selfFeet + (self.crouching ? 0.8 : CHEST);
    for (const target of this.targets) {
      let player = this.match.player(target.id);
      if (!player) {
        this.match.addDummy(target.id, target.beat.name);
        player = this.match.player(target.id);
        Object.assign(target, { along: 0, forward: true, waitUntil: 0, health: 100, alertUntil: 0, seenSince: 0, fireAt: 0 });
      }
      if (!player) continue;
      if (player.health <= 0) {
        target.seenSince = 0; target.alertUntil = 0;
        if (now < player.respawnAfter + BOT.downExtraMs || !this.match.apply(target.id, { kind: "respawn" }, now)) continue;
        // It comes back at the end of its beat that is further from the player.
        const length = this.lengthOf(target), [sx, sz] = target.path[0], [ex, ez] = target.path[target.path.length - 1];
        const atEnd = Math.hypot(ex - self.east, ez - self.north) > Math.hypot(sx - self.east, sz - self.north);
        Object.assign(target, { along: atEnd ? length : 0, forward: !atEnd, waitUntil: now + 800, health: 100 });
      }
      // A hit puts it on alert, wherever the shot came from, and ends the player's quiet start.
      if (player.health < target.health) { target.alertUntil = now + BOT.memory * 1000; this.selfEngaged = true; }
      target.health = player.health;

      // Where it is, and whether it can see the player from there.
      let at = this.place(target);
      const floor = terrainHeight(data, at.east, at.north) + (target.beat.height ?? 0);
      const alert = now < target.alertUntil, crouched = !!target.beat.crouch;
      const eye = { x: at.east, y: floor + (crouched ? CROUCH_EYE : EYE), z: at.north };
      const dx = self.east - eye.x, dy = selfChest - eye.y, dz = self.north - eye.z, flat = Math.hypot(dx, dz), far = Math.hypot(flat, dy);
      const toPlayer = Math.atan2(dx, dz) * 180 / Math.PI;
      const ahead = Math.abs(((toPlayer - target.heading + 540) % 360) - 180) <= BOT.cone;
      const sees = selfAlive && !grace && far <= BOT.sight && far > 0.5 && (alert || ahead)
        && this.world.clearShot({ origin: eye, direction: { x: dx / far, y: dy / far, z: dz / far }, distance: Math.max(0, far - 0.4) });
      if (sees) {
        if (!target.seenSince) { target.seenSince = now; target.fireAt = now + between(BOT.reaction) * 1000; }
        target.alertUntil = now + BOT.memory * 1000;
      } else target.seenSince = 0;
      const fighting = now < target.alertUntil;

      // It walks its beat until something alerts it; then it stands and faces the player.
      const length = this.lengthOf(target), speed = target.beat.speed ?? 0;
      const walking = !fighting && length > 0 && speed > 0 && now >= target.waitUntil;
      if (walking) {
        target.along += (target.forward ? 1 : -1) * speed * seconds;
        if (target.along >= length || target.along <= 0) {
          target.along = Math.max(0, Math.min(length, target.along));
          target.forward = !target.forward;
          target.waitUntil = now + (target.beat.pause ?? 1) * 1000;
        }
        at = this.place(target);
      }
      // One that fights turns to face the player. One that walks faces along its beat, and one
      // that stands looks the way its post has it look.
      const resting = at.turn ?? target.beat.face ?? target.heading;
      target.heading = turnTo(target.heading, fighting ? toPlayer : resting, (fighting ? BOT.turn : 180) * seconds);
      const wantedPitch = fighting && selfAlive ? Math.max(-60, Math.min(60, Math.atan2(dy, flat) * 180 / Math.PI)) : 0;
      target.pitch += (wantedPitch - target.pitch) * Math.min(1, seconds * 8);
      const pose: PlayerPose = {
        east: at.east, north: at.north, heading: target.heading, pitch: target.pitch, jumpHeight: target.beat.height ?? 0,
        moving: walking, running: walking && speed > 5, crouching: crouched && !walking,
        sliding: false, airborne: false, lean: 0, aiming: fighting, carrying: false,
      };
      this.match.setPose(target.id, pose, now);
      this.world.setRemotePose(target.id, pose, now);

      // It fires once it has had the player in sight for its reaction time and faces them.
      if (!sees || grace || now < target.fireAt || Math.abs(((toPlayer - target.heading + 540) % 360) - 180) > 12) continue;
      const gun = player.active;
      // A reload is over when the match has put the magazine in (it sets the timer back to 0),
      // not when the timer runs out: this runs more often than the match counts time.
      if (player.reloadUntil > 0) continue;
      if (player.ammo[gun] <= 0) {
        // It always has one more magazine, and takes the time to change it.
        if (!player.mags[gun].length) player.mags[gun].push(12);
        this.match.apply(target.id, { kind: "reload" }, now);
        continue;
      }
      const sighted = Math.min(1, (now - target.seenSince) / 1000 / BOT.settle);
      const error = BOT.errorFirst + (BOT.errorSettled - BOT.errorFirst) * sighted + this.selfSpeed * BOT.errorPerSpeed;
      const aim = { heading: (toPlayer + (Math.random() * 2 - 1) * error + 360) % 360, pitch: Math.max(-80, Math.min(80, Math.atan2(dy, flat) * 180 / Math.PI + (Math.random() * 2 - 1) * error * BOT.errorUpDown)) };
      this.match.apply(target.id, { kind: "attack", weapon: gun, aim }, now);
      target.fireAt = now + between(BOT.between) * 1000;
    }
  }

  // Takes the targets out of the match and the view, as when a room is joined.
  clear(): void {
    for (const target of this.targets) {
      this.match.removePlayer(target.id);
      this.world.removeRemotePeer(target.id);
    }
  }
}
