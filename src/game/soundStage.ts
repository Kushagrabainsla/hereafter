import { Vector3, type PerspectiveCamera } from "three/webgpu";
import { type ArenaData } from "../world/arena";
import { gameAudio, type Gait, type Surface, type Vec3 } from "./gameAudio";
import { type CombatEvent } from "./matchState";
import { type PlayerGait, type PlayerMotion, type PlayerPose } from "./playerController";

interface RemoteSteps { x: number; z: number; stride: number; height: number }
interface RemoteSource { each: (visit: (peerId: string, feet: Vector3, pose: PlayerPose, dead: boolean) => void) => void }

// Distance a remote player covers per footstep, matching the local head-bob cadence.
const STEP_LENGTH: Record<Gait, number> = { walk: 1.85, run: 1.49, crouch: 1.85 };
const UP = new Vector3(0, 1, 0);

// Connects the world to the sound engine: keeps the listener on the camera, times
// footsteps from the local stride and from other players' movement, picks the ground
// surface under each step, and places combat sounds where they happen.
export class SoundStage {
  private roads: { ax: number; az: number; bx: number; bz: number; reach: number }[];
  private stepIndex = 0;
  private jumps = 0;
  private landings = 0;
  private remote = new Map<string, RemoteSteps>();
  private forward = new Vector3();
  private up = new Vector3();

  constructor(data: ArenaData, private positionOf: (peerId: string) => Vec3 | null) {
    this.roads = data.roads.map(({ points: [a, b], width }) => ({ ax: a[0], az: a[1], bx: b[0], bz: b[1], reach: width / 2 + 0.15 }));
  }

  // Roads and pavements are hard; open ground and parks are grass. Standing on cover is hard.
  surfaceAt(east: number, north: number, aboveGround: number): Surface {
    if (aboveGround > 0.25) return "hard";
    for (const road of this.roads) {
      const dx = road.bx - road.ax, dz = road.bz - road.az;
      const t = Math.max(0, Math.min(1, ((east - road.ax) * dx + (north - road.az) * dz) / Math.max(1e-6, dx * dx + dz * dz)));
      if (Math.hypot(east - road.ax - dx * t, north - road.az - dz * t) <= road.reach) return "hard";
    }
    return "soft";
  }

  update(camera: PerspectiveCamera, gait: PlayerGait, motion: PlayerMotion, remotes: RemoteSource): void {
    camera.getWorldDirection(this.forward);
    this.up.copy(UP).applyQuaternion(camera.quaternion);
    gameAudio.listen(camera.position, this.forward, this.up);
    const surface = (): Surface => this.surfaceAt(camera.position.x, camera.position.z, gait.aboveGround);
    // The head bob is lowest when stride sits at 3/4 pi past a multiple of pi: one footfall.
    const index = Math.floor((gait.stride - 0.75 * Math.PI) / Math.PI);
    if (index !== this.stepIndex) {
      if (motion.moving && gait.grounded) gameAudio.step(surface(), motion.running ? "run" : motion.crouching ? "crouch" : "walk", index % 2 ? 1 : -1);
      this.stepIndex = index;
    }
    if (gait.jumps !== this.jumps) { this.jumps = gait.jumps; gameAudio.jump(surface()); }
    if (gait.landings !== this.landings) { this.landings = gait.landings; gameAudio.land(gait.landingSpeed, surface()); }
    const seen = new Set<string>();
    remotes.each((peerId, feet, pose, dead) => {
      seen.add(peerId);
      let state = this.remote.get(peerId);
      if (!state) { state = { x: feet.x, z: feet.z, stride: 0, height: pose.jumpHeight }; this.remote.set(peerId, state); }
      const moved = Math.hypot(feet.x - state.x, feet.z - state.z);
      state.x = feet.x; state.z = feet.z;
      const chest = { x: feet.x, y: feet.y + 1.1, z: feet.z };
      const at = { x: feet.x, y: feet.y + 0.05, z: feet.z };
      if (state.height > 0.45 && pose.jumpHeight < 0.1 && !dead) gameAudio.remoteLand(at, this.surfaceAt(feet.x, feet.z, 0));
      state.height = pose.jumpHeight;
      // Respawns and corrections jump several metres in a frame; they are not footsteps.
      if (dead || moved > 2.5 || !pose.moving || pose.jumpHeight > 0.15) { if (moved > 2.5) state.stride = 0; return; }
      const gaitName: Gait = pose.crouching ? "crouch" : pose.running ? "run" : "walk";
      state.stride += moved / STEP_LENGTH[gaitName];
      if (state.stride < 1) return;
      state.stride %= 1;
      if (gameAudio.distanceTo(at) > 40) return;
      gameAudio.remoteStep(at, this.surfaceAt(feet.x, feet.z, pose.jumpHeight), gaitName, gameAudio.occlusion(camera.position, chest));
    });
    for (const peerId of this.remote.keys()) if (!seen.has(peerId)) this.remote.delete(peerId);
  }

  // Sounds for a combat event as heard by selfId. The player's own shots are played when
  // fired (see gameAudio.fire), so here they only add impacts.
  combat(event: CombatEvent, selfId: string): void {
    const shot = event.shot;
    if (shot && (event.kind === "shot" || event.kind === "hit" || event.kind === "death")) {
      const weapon = event.weapon ?? "pistol";
      const origin = shot.origin;
      const end = { x: origin.x + shot.direction.x * shot.distance, y: origin.y + shot.direction.y * shot.distance, z: origin.z + shot.direction.z * shot.distance };
      if (event.actor !== selfId) {
        gameAudio.remoteFire(weapon, origin);
        if (weapon !== "knife" && event.target !== selfId) this.nearMiss(shot.origin, shot.direction, shot.distance);
      }
      if (event.target && event.target !== selfId) gameAudio.bodyHit(end, weapon === "knife");
      if (event.kind === "death" && event.target !== selfId) gameAudio.bodyFall(end);
      if (!event.target && event.impact && weapon !== "knife") gameAudio.surfaceImpact(end);
    }
    if (event.kind === "pickup" && event.actor !== selfId) {
      const at = this.positionOf(event.actor);
      if (at) gameAudio.remotePickup({ x: at.x, y: at.y + 1, z: at.z });
    }
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
