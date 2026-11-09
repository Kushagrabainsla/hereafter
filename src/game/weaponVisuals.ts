import { Box3, Group, MeshStandardMaterial, PointLight, Vector3, Scene, type Object3D } from "three/webgpu";
import { terrainHeight, type ArenaData } from "../world/arena";
import { glowing, kitObject, type KitPiece } from "../world/kit";
import { type WeaponKind, type WeaponPickup } from "./combatRules";
import { type PlayerMotion } from "./playerController";

interface PickupView { root: Group; beamMaterial: MeshStandardMaterial; holder: Group; weapon: WeaponKind }

// Per-frame state shared with the authored view models: which weapon is visibly held
// (after the switch midpoint), how far the lower-and-raise switch has tucked it away, and
// the sway of the weapon on its spring in camera-local metres and radians, breathing
// included. reload is how far the weapon is canted for a reload (0 to 1) and jolt the
// decaying kick when a magazine seats or the action closes.
export interface Sway { x: number; y: number; z: number; pitch: number; yaw: number; roll: number }
export interface ViewDynamics { active: WeaponKind; lower: number; sway: Sway; reload: number; jolt: number; }

// The weapon hangs off the hands like a mass on a spring. Turning drags it behind the view,
// starting, stopping, jumping and landing swing it, and strafing rolls it. Heavier weapons
// swing slower and further: these are each one's natural frequency (Hz), how far it lags
// a turn (seconds of turn) and how strongly it follows the body's acceleration.
const SPRING: Record<WeaponKind, { frequency: number; lag: number; follow: number }> = {
  knife: { frequency: 2.6, lag: 0.012, follow: 0.16 },
  pistol: { frequency: 2.1, lag: 0.016, follow: 0.2 },
  rifle: { frequency: 1.5, lag: 0.024, follow: 0.24 },
};
const DAMPING = 0.5;

class SpringAxis {
  value = 0;
  speed = 0;
  step(seconds: number, frequency: number, target: number, push: number): void {
    const omega = 2 * Math.PI * frequency;
    this.speed += (omega * omega * (target - this.value) - 2 * DAMPING * omega * this.speed - push) * seconds;
    this.value += this.speed * seconds;
  }
  reset(): void { this.value = 0; this.speed = 0; }
}

// Moments in each reload recording (seconds) when the magazine seats and the action closes,
// so the weapon jolts in time with the sound (scripts/audio/build.sh cuts the recordings).
const RELOAD_JOLTS: Record<WeaponKind, number[]> = { knife: [], pistol: [0.42, 0.95], rifle: [1.15, 1.38] };

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

const SWITCH_SECONDS = 0.56;

// The procedural side of the first-person weapon: switching, the spring sway and breathing,
// reload cants and quick throws, which the authored view models (authoredViewModel.ts) read
// each frame; and the gun pickups, each spinning above a modelled stand.
export class WeaponVisuals {
  private pickups = new Map<string, PickupView>();
  private active: WeaponKind = "knife";
  private requested: WeaponKind = "knife";
  private switchPhase = 0;
  private switchSeconds = SWITCH_SECONDS;
  private switching = false;
  private lower = 0;
  private vault = 0;
  private throwTime = 0;
  private reloadElapsed = 0;
  private reloadDuration = 0;
  private reloadWeapon: WeaponKind = "knife";
  private reloadTilt = 0;
  private reloadJolt = 0;
  private lastHeading: number | null = null;
  private lastPitch = 0;
  private lastEye: Vector3 | null = null;
  private velocity = new Vector3();
  private turnRate = 0;
  private pitchRate = 0;
  private springs = { x: new SpringAxis(), y: new SpringAxis(), z: new SpringAxis(), pitch: new SpringAxis(), yaw: new SpringAxis(), roll: new SpringAxis() };
  private sway: Sway = { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 };
  private breathPhase = 0;
  private time = 0;

  constructor(scene: Scene, data: ArenaData, pickupData: WeaponPickup[], pieces: Map<string, KitPiece>) {
    const ringMaterial = new MeshStandardMaterial({ color: 0x59d3d0, emissive: 0x237a78, emissiveIntensity: 1.8, metalness: 0.35, roughness: 0.34 });
    const beamMaterial = new MeshStandardMaterial({ color: 0x5bd8d6, emissive: 0x3bbfba, emissiveIntensity: 0.8, transparent: true, opacity: 0.11, depthWrite: false });
    for (const pickup of pickupData) {
      if (pickup.item !== "gun") continue;
      const root = new Group();
      root.position.set(pickup.east, terrainHeight(data, pickup.east, pickup.north) + pickup.y + 0.05, pickup.north);
      // The modelled stand (items.glb), its ring lit by the game.
      const stand = kitObject(pieces.get("pickup_stand"), undefined, (material) => glowing(material) ? ringMaterial : material);
      stand.position.y = -0.05;
      root.add(stand);
      // The column of light over it (effects.glb), rising from the stand.
      const beam = kitObject(pieces.get("marker_beam"), undefined, () => beamMaterial);
      beam.position.y = 0.06;
      root.add(beam);
      // The holder spins and bobs; it shows the gun once the weapon models load.
      const holder = new Group();
      holder.position.y = 0.48;
      holder.rotation.set(-0.1, Math.PI / 5, -0.1);
      root.add(holder);
      const light = new PointLight(0x5bdad8, 0.8, 5);
      light.position.y = 0.65;
      root.add(light);
      scene.add(root);
      this.pickups.set(pickup.id, { root, beamMaterial, holder, weapon: pickup.weapon });
    }
  }

  // Lowers the weapon and raises it again over this long, the hands busy with something else.
  dip(seconds: number): void {
    if (this.switching) return;
    this.switching = true;
    this.switchPhase = 0;
    this.switchSeconds = seconds;
    this.cancelReload();
  }

  setActive(kind: WeaponKind): void {
    if (kind === this.requested) return;
    this.switchSeconds = SWITCH_SECONDS;
    this.requested = kind;
    if (!this.switching) { this.switching = true; this.switchPhase = 0; }
    else if (this.switchPhase >= 0.5) this.switchPhase = 1 - this.switchPhase;
    this.cancelReload();
  }

  // Cant the weapon for a reload lasting durationMs, with jolts timed to the reload sound.
  reload(kind: WeaponKind, durationMs: number): void {
    if (kind === "knife" || kind !== this.requested) return;
    this.reloadWeapon = kind;
    this.reloadElapsed = 0;
    this.reloadDuration = durationMs / 1000;
  }

  cancelReload(): void { this.reloadDuration = 0; }

  dynamics(): ViewDynamics {
    return { active: this.active, lower: this.lower, sway: this.sway, reload: this.reloadTilt, jolt: this.reloadJolt };
  }

  // Drives the spring from how the view turned and how the eyes accelerated since the last
  // frame, expressed along the camera's right, up and forward axes, then adds breathing
  // that quickens and deepens with exertion and a faint tremor of the hands.
  private swing(seconds: number, motion: PlayerMotion, heading: number, pitch: number, eye: Vector3 | undefined, right: Vector3, up: Vector3, forward: Vector3): void {
    if (seconds <= 0) return;
    const spring = SPRING[this.active];
    let turn = 0, tilt = 0;
    if (this.lastHeading !== null) {
      turn = ((heading - this.lastHeading + 540) % 360) - 180;
      tilt = pitch - this.lastPitch;
      if (Math.abs(turn) > 60 || Math.abs(tilt) > 40) turn = tilt = 0;
    }
    this.lastHeading = heading;
    this.lastPitch = pitch;
    const turnRate = turn * Math.PI / 180 / seconds, pitchRate = tilt * Math.PI / 180 / seconds;
    const turnAcceleration = (turnRate - this.turnRate) / seconds, pitchAcceleration = (pitchRate - this.pitchRate) / seconds;
    this.turnRate = turnRate;
    this.pitchRate = pitchRate;
    const accel = new Vector3();
    if (eye) {
      if (this.lastEye && eye.distanceTo(this.lastEye) < 1.5) {
        const velocity = eye.clone().sub(this.lastEye).divideScalar(seconds);
        // Smooth out frame-time noise before differentiating.
        const smoothed = this.velocity.clone().lerp(velocity, 1 - Math.exp(-seconds / 0.03));
        accel.copy(smoothed).sub(this.velocity).divideScalar(seconds);
        this.velocity.copy(smoothed);
      } else this.velocity.set(0, 0, 0);
      this.lastEye = (this.lastEye ?? new Vector3()).copy(eye);
    }
    const clampTo = (value: number, limit: number): number => Math.max(-limit, Math.min(limit, value));
    const along = (axis: Vector3, limit: number): number => clampTo(accel.dot(axis), limit) * spring.follow;
    const s = this.springs, f = spring.frequency;
    s.x.step(seconds, f, 0, along(right, 40));
    s.y.step(seconds, f, 0, along(up, 60));
    s.z.step(seconds, f, 0, -along(forward, 40));
    // A turn drags the weapon behind it: turning left (rising heading) leaves it pointing
    // right, and looking up leaves it low. Sudden starts and stops add a swing of their own.
    s.yaw.step(seconds, f * 1.2, clampTo(-turnRate * spring.lag, 0.08), clampTo(turnAcceleration, 400) * spring.lag * 0.05);
    s.pitch.step(seconds, f * 1.2, clampTo(-pitchRate * spring.lag, 0.06), clampTo(pitchAcceleration, 400) * spring.lag * 0.05);
    s.roll.step(seconds, f, clampTo(-this.velocity.dot(right) * 0.008, 0.05), 0);
    // Breathing: about 14 breaths a minute at rest, up to 40 after a hard sprint.
    const exertion = motion.exertion;
    this.breathPhase += seconds * 2 * Math.PI * (0.23 + exertion * 0.45);
    const breath = Math.sin(this.breathPhase), depth = 0.0012 + exertion * 0.0055;
    const tremor = (0.00025 + exertion * 0.0008) * (Math.sin(this.time * 47) + Math.sin(this.time * 61 + 1.3) * 0.7);
    this.sway = {
      x: s.x.value - s.yaw.value * 0.35 + tremor * 0.6,
      y: s.y.value + breath * depth + tremor,
      z: s.z.value,
      pitch: s.pitch.value + breath * depth * 2.2,
      yaw: s.yaw.value,
      roll: s.roll.value + s.yaw.value * 0.4,
    };
  }

  // Shows each pickup as the same model the player holds, spinning about its middle and
  // drawn a little larger than life so it reads at a distance.
  useModels(models: Map<WeaponKind, Object3D>): void {
    for (const pickup of this.pickups.values()) {
      const source = models.get(pickup.weapon);
      if (!source) continue;
      const model = source.clone(true);
      const center = new Box3().setFromObject(model).getCenter(new Vector3());
      model.position.sub(center);
      pickup.holder.clear();
      pickup.holder.add(model);
      pickup.holder.scale.setScalar(pickup.weapon === "rifle" ? 1.05 : 1.6);
    }
  }

  setTaken(taken: string[]): void {
    const hidden = new Set(taken);
    for (const [id, pickup] of this.pickups) pickup.root.visible = !hidden.has(id);
  }

  ready(): boolean { return !this.switching && this.throwTime <= 0; }

  // Throwing a grenade dips the held weapon out of the way and back.
  quickThrow(): void { this.throwTime = 0.55; }


  update(seconds: number, motion: PlayerMotion, heading = 0, pitch = 0, eye?: Vector3, axes?: { right: Vector3; up: Vector3; forward: Vector3 }): void {
    const elapsed = Math.max(0, seconds);
    seconds = Math.min(elapsed, 0.05);
    if (this.switching) {
      this.switchPhase = Math.min(1, this.switchPhase + elapsed / this.switchSeconds);
      if (this.switchPhase >= 0.5) this.active = this.requested;
      if (this.switchPhase >= 1 - 1e-6) { this.switchPhase = 1; this.switching = false; }
    }
    this.time += seconds;
    this.swing(seconds, motion, heading, pitch, eye, axes?.right ?? new Vector3(1, 0, 0), axes?.up ?? new Vector3(0, 1, 0), axes?.forward ?? new Vector3(0, 0, -1));
    // Both hands are busy climbing during a mantle, so the weapon tucks away.
    this.vault += ((motion.mantling || motion.climbing ? 1 : 0) - this.vault) * Math.min(1, seconds * 14);
    this.throwTime = Math.max(0, this.throwTime - elapsed);
    this.reloadTilt = 0;
    this.reloadJolt = 0;
    if (this.reloadDuration > 0) {
      this.reloadElapsed += elapsed;
      const progress = this.reloadElapsed / this.reloadDuration;
      if (progress >= 1 || this.reloadWeapon !== this.active) this.reloadDuration = 0;
      else {
        this.reloadTilt = smoothstep(0, 0.16, progress) * (1 - smoothstep(0.84, 1, progress));
        for (const moment of RELOAD_JOLTS[this.reloadWeapon]) {
          if (this.reloadElapsed >= moment) this.reloadJolt += Math.exp(-(this.reloadElapsed - moment) * 16);
        }
      }
    }
    // Switching tucks the weapon down and inward, and so do a mantle and a quick throw.
    const throwing = this.throwTime > 0 ? Math.sin(Math.PI * (1 - this.throwTime / 0.55)) * 0.65 : 0;
    this.lower = Math.max(this.switching ? Math.sin(Math.PI * this.switchPhase) ** 2 : 0, this.vault * 0.7, throwing);
    for (const pickup of this.pickups.values()) {
      pickup.beamMaterial.opacity = 0.085 + Math.sin(this.time * 2.5) * 0.025;
      pickup.holder.rotation.y += seconds * 0.55;
      pickup.holder.position.y = 0.48 + Math.sin(this.time * 2.2) * 0.06;
    }
  }
}
