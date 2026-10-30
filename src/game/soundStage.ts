import { Vector3, type PerspectiveCamera } from "three/webgpu";
import { gameAudio, type Gait, type Surface, type Vec3 } from "./gameAudio";
import { type CombatEvent } from "./matchState";
import { type PlayerGait, type PlayerMotion, type PlayerPose } from "./playerController";

interface RemoteSteps { x: number; z: number; stride: number; height: number; sliding: boolean }
interface RemoteSource { each: (visit: (peerId: string, feet: Vector3, pose: PlayerPose, dead: boolean) => void) => void }

// Distance a remote player covers per footstep, matching the local head-bob cadence.
const STEP_LENGTH: Record<Gait, number> = { walk: 1.85, run: 1.49, crouch: 1.85 };
const UP = new Vector3(0, 1, 0);

// Connects the world to the sound engine: keeps the listener on the camera, times
// footsteps from the local stride and from other players' movement, picks the ground
// surface under each step, and places combat sounds where they happen.
export class SoundStage {
  private stepIndex = 0;
  private jumps = 0;
  private landings = 0;
  private mantles = 0;
  private rungs = 0;
  private sliding = false;
  private remote = new Map<string, RemoteSteps>();
  private forward = new Vector3();
  private up = new Vector3();

  constructor(private positionOf: (peerId: string) => Vec3 | null) {
  }

  // The market is paved or floored everywhere.
  surfaceAt(): Surface { return "hard"; }

  update(camera: PerspectiveCamera, gait: PlayerGait, motion: PlayerMotion, remotes: RemoteSource): void {
    camera.getWorldDirection(this.forward);
    this.up.copy(UP).applyQuaternion(camera.quaternion);
    gameAudio.listen(camera.position, this.forward, this.up);
    const surface = (): Surface => this.surfaceAt();
    // The head bob is lowest when stride sits at 3/4 pi past a multiple of pi: one footfall.
    const index = Math.floor((gait.stride - 0.75 * Math.PI) / Math.PI);
    if (index !== this.stepIndex) {
      if (motion.moving && gait.grounded && !motion.sliding) gameAudio.step(surface(), motion.running ? "run" : motion.crouching ? "crouch" : "walk", index % 2 ? 1 : -1);
      this.stepIndex = index;
    }
    if (gait.jumps !== this.jumps) { this.jumps = gait.jumps; gameAudio.jump(surface()); }
    if (gait.landings !== this.landings) { this.landings = gait.landings; gameAudio.land(gait.landingSpeed, surface()); }
    if (gait.mantles !== this.mantles) { this.mantles = gait.mantles; gameAudio.mantle(); }
    if (gait.rungs !== this.rungs) { this.rungs = gait.rungs; gameAudio.ladderStep(); }
    if (motion.sliding !== this.sliding) {
      this.sliding = motion.sliding;
      if (motion.sliding) gameAudio.slide(surface());
      else gameAudio.stopSlide();
    }
    const seen = new Set<string>();
    remotes.each((peerId, feet, pose, dead) => {
      seen.add(peerId);
      let state = this.remote.get(peerId);
      if (!state) { state = { x: feet.x, z: feet.z, stride: 0, height: pose.jumpHeight, sliding: false }; this.remote.set(peerId, state); }
      const moved = Math.hypot(feet.x - state.x, feet.z - state.z);
      state.x = feet.x; state.z = feet.z;
      const chest = { x: feet.x, y: feet.y + 1.1, z: feet.z };
      const at = { x: feet.x, y: feet.y + 0.05, z: feet.z };
      if (state.height > 0.45 && pose.jumpHeight < 0.1 && !dead) gameAudio.remoteLand(at, this.surfaceAt());
      state.height = pose.jumpHeight;
      if (pose.sliding && !state.sliding && !dead) gameAudio.remoteSlide(at, this.surfaceAt());
      state.sliding = pose.sliding === true;
      // Respawns and corrections jump several metres in a frame; they are not footsteps.
      if (dead || moved > 2.5 || !pose.moving || pose.sliding || pose.jumpHeight > 0.15) { if (moved > 2.5) state.stride = 0; return; }
      const gaitName: Gait = pose.crouching ? "crouch" : pose.running ? "run" : "walk";
      state.stride += moved / STEP_LENGTH[gaitName];
      if (state.stride < 1) return;
      state.stride %= 1;
      if (gameAudio.distanceTo(at) > 40) return;
      gameAudio.remoteStep(at, this.surfaceAt(), gaitName, gameAudio.occlusion(camera.position, chest));
    });
    for (const peerId of this.remote.keys()) if (!seen.has(peerId)) this.remote.delete(peerId);
  }

  // Sounds for a combat event as heard by selfId. The player's own shots are played when
  // fired (see gameAudio.fire), so here they only add what the rounds struck.
  combat(event: CombatEvent, selfId: string): void {
    const shot = event.shot;
    if (event.kind === "shot" && shot) {
      const weapon = event.weapon ?? "pistol";
      if (event.actor !== selfId) {
        gameAudio.remoteFire(weapon, shot.origin, event.stroke === "stab");
        if (weapon !== "knife") this.nearMiss(shot.origin, shot.direction, shot.distance);
      }
      // A few audible strikes per round: where it went in, and where it broke through.
      for (const impact of (event.impacts ?? []).slice(0, 4)) gameAudio.impact(impact.material, impact);
      return;
    }
    if ((event.kind === "hit" || event.kind === "death") && event.target && event.target !== selfId) {
      const at = this.positionOf(event.target);
      if (!at) return;
      const chest = { x: at.x, y: at.y + 1.1, z: at.z };
      if (event.cause !== "fall") gameAudio.bodyHit(chest, event.cause === "knife");
      if (event.kind === "death") gameAudio.bodyFall(chest);
      return;
    }
    if (event.kind === "pickup" && event.actor !== selfId) {
      const at = this.positionOf(event.actor);
      if (at) gameAudio.remotePickup({ x: at.x, y: at.y + 1, z: at.z });
      return;
    }
    if (event.kind === "throw") gameAudio.throwGrenade(event.actor === selfId ? undefined : event.position);
    if (event.kind === "explode" && event.position) gameAudio.explosion(event.position);
  }

  // A round that passes within three metres of the listener's head cracks past them.
  private nearMiss(origin: Vec3, direction: Vec3, distance: number): void {
    const listener = gameAudio.listenerPosition();
    const along = (listener.x - origin.x) * direction.x + (listener.y - origin.y) * direction.y + (listener.z - origin.z) * direction.z;
    if (along < 2 || along > distance + 1) return;
    const closest = { x: origin.x + direction.x * along, y: origin.y + direction.y * along, z: origin.z + direction.z * along };
    const miss = Math.hypot(listener.x - closest.x, listener.y - closest.y, listener.z - closest.z);
    if (miss < 3) gameAudio.nearMiss(closest, miss);
  }
}
