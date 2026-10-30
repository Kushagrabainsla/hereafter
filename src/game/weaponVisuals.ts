import {
  Box3, BoxGeometry, CylinderGeometry, ExtrudeGeometry, Group, Mesh, MeshStandardMaterial,
  PerspectiveCamera, PointLight, MeshBasicMaterial, Vector3, Scene, Shape, SphereGeometry, TorusGeometry, type Object3D,
} from "three/webgpu";
import { terrainHeight, type ArenaData } from "../world/arena";
import { type WeaponKind, type WeaponPickup } from "./combatRules";
import { PlayerHands } from "./playerHands";
import { type PlayerMotion } from "./playerController";

function add(group: Group, geometry: BoxGeometry | CylinderGeometry | ExtrudeGeometry | SphereGeometry | TorusGeometry, material: MeshStandardMaterial, x: number, y: number, z: number): Mesh {
  const mesh = new Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  group.add(mesh);
  return mesh;
}

export function makeWeapon(kind: WeaponKind, viewModel: boolean): Group {
  const group = new Group();
  const steel = new MeshStandardMaterial({ color: 0xb8c4ca, metalness: 0.84, roughness: 0.24, depthTest: true, depthWrite: true });
  const dark = new MeshStandardMaterial({ color: 0x1b2429, metalness: 0.42, roughness: 0.58, depthTest: true, depthWrite: true });
  const black = new MeshStandardMaterial({ color: 0x0c151b, metalness: 0.2, roughness: 0.82, depthTest: true, depthWrite: true });
  const accent = new MeshStandardMaterial({ color: 0x4d686a, metalness: 0.62, roughness: 0.36, depthTest: true, depthWrite: true });
  if (kind === "knife") {
    const blade = new Shape();
    blade.moveTo(-0.052, 0);
    blade.lineTo(-0.047, 0.34);
    blade.lineTo(0, 0.49);
    blade.lineTo(0.055, 0.34);
    blade.lineTo(0.045, 0);
    blade.closePath();
    const edge = add(group, new ExtrudeGeometry(blade, { depth: 0.026, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 1 }), steel, 0, 0.12, 0);
    edge.rotation.y = 0.16;
    add(group, new BoxGeometry(0.18, 0.045, 0.07), dark, 0, 0.1, 0.015);
    add(group, new CylinderGeometry(0.047, 0.053, 0.29, 10), black, 0, -0.06, 0.015);
    for (let ring = 0; ring < 5; ring += 1) add(group, new TorusGeometry(0.051, 0.006, 4, 12), accent, 0, -0.17 + ring * 0.055, 0.015).rotation.x = Math.PI / 2;
    add(group, new CylinderGeometry(0.06, 0.05, 0.035, 10), dark, 0, -0.22, 0.015);
  } else {
    const rifle = kind === "rifle";
    const length = rifle ? 0.67 : 0.32;
    // Slim bodies read as firearms rather than blocks when seen along their side.
    add(group, new BoxGeometry(0.11, 0.14, length), dark, 0, 0, -length / 2);
    add(group, new BoxGeometry(0.1, 0.065, rifle ? 0.37 : 0.3), steel, 0, 0.1, rifle ? -0.25 : -0.16);
    add(group, new CylinderGeometry(rifle ? 0.033 : 0.042, rifle ? 0.033 : 0.042, rifle ? 0.38 : 0.16, 12), black, 0, 0.005, rifle ? -0.7 : -0.37).rotation.x = Math.PI / 2;
    add(group, new CylinderGeometry(0.047, 0.047, 0.07, 12), steel, 0, 0.005, rifle ? -0.9 : -0.45).rotation.x = Math.PI / 2;
    add(group, new BoxGeometry(0.08, 0.26, 0.1), black, 0, -0.19, 0.01).rotation.x = -0.28;
    add(group, new BoxGeometry(0.09, 0.075, 0.075), accent, 0, -0.03, 0.035);
    add(group, new BoxGeometry(0.05, 0.05, 0.06), black, 0, 0.155, rifle ? -0.53 : -0.26);
    add(group, new BoxGeometry(0.05, 0.04, 0.05), black, 0, 0.15, -0.055);
    if (rifle) {
      add(group, new BoxGeometry(0.115, 0.125, 0.29), accent, 0, -0.015, -0.5);
      add(group, new BoxGeometry(0.075, 0.11, 0.36), dark, 0, -0.035, 0.205);
      add(group, new BoxGeometry(0.085, 0.15, 0.03), black, 0, -0.04, 0.385);
      add(group, new BoxGeometry(0.06, 0.24, 0.09), black, 0, -0.19, -0.28).rotation.x = -0.12;
      add(group, new CylinderGeometry(0.035, 0.035, 0.19, 10), steel, 0, 0.17, -0.25).rotation.x = Math.PI / 2;
    }
  }
  if (viewModel) group.traverse((object) => { if (object instanceof Mesh) object.renderOrder = 50; });
  return group;
}

interface PickupView { root: Group; ring: Mesh; beamMaterial: MeshStandardMaterial; holder: Group; weapon: WeaponKind }

// Rest pose of each held weapon in camera-local metres and radians, plus the offset
// (dx, dy, dz, rx, ry, rz) blended in while sprinting. Guns yaw slightly inward so the
// barrel converges on the crosshair instead of pointing off to the right.
export interface ViewPose { position: [number, number, number]; rotation: [number, number, number]; scale: number; sprint: [number, number, number, number, number, number]; }
export const VIEW_POSES: Record<WeaponKind, ViewPose> = {
  knife: { position: [0.3, -0.18, -0.8], rotation: [-0.26, -0.28, 0.18], scale: 0.75, sprint: [0.05, -0.1, 0.05, -0.4, -0.3, 0.3] },
  pistol: { position: [0.24, -0.2, -0.76], rotation: [-0.02, 0.09, -0.03], scale: 0.85, sprint: [0.05, -0.12, 0.04, -0.5, 0.4, -0.35] },
  rifle: { position: [0.25, -0.23, -0.6], rotation: [0.03, 0.12, 0.1], scale: 0.85, sprint: [0.04, -0.13, 0.06, -0.45, 0.5, -0.4] },
};

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

export class WeaponVisuals {
  private held = new Map<WeaponKind, Group>();
  private pickups = new Map<string, PickupView>();
  private active: WeaponKind = "knife";
  private requested: WeaponKind = "knife";
  private switchPhase = 0;
  private switching = false;
  private fallbackVisible = true;
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
  private recoil = 0;
  private flashTime = 0;
  private flashes = new Map<WeaponKind, Mesh>();
  private time = 0;
  private stride = 0;
  private movementBlend = 0;
  private sprintBlend = 0;

  constructor(camera: PerspectiveCamera, scene: Scene, data: ArenaData, pickupData: WeaponPickup[]) {
    for (const kind of ["knife", "pistol", "rifle"] as const) {
      const model = makeWeapon(kind, true);
      const pose = VIEW_POSES[kind];
      model.position.set(...pose.position);
      model.rotation.set(...pose.rotation);
      model.scale.setScalar(pose.scale);
      new PlayerHands(model, kind);
      model.visible = kind === "knife";
      if (kind !== "knife") {
        const flash = new Mesh(new SphereGeometry(1, 7, 4), new MeshBasicMaterial({ color: 0xffd68a, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false, toneMapped: false }));
        flash.position.set(0, 0.005, kind === "rifle" ? -0.96 : -0.50);
        flash.scale.set(0.045, 0.045, 0.12);
        flash.renderOrder = 51;
        flash.visible = false;
        model.add(flash);
        this.flashes.set(kind, flash);
      }
      camera.add(model);
      this.held.set(kind, model);
    }
    const ringMaterial = new MeshStandardMaterial({ color: 0x59d3d0, emissive: 0x237a78, emissiveIntensity: 1.8, metalness: 0.35, roughness: 0.34 });
    const beamMaterial = new MeshStandardMaterial({ color: 0x5bd8d6, emissive: 0x3bbfba, emissiveIntensity: 0.8, transparent: true, opacity: 0.11, depthWrite: false });
    for (const pickup of pickupData) {
      if (pickup.item !== "gun") continue;
      const root = new Group();
      root.position.set(pickup.east, terrainHeight(data, pickup.east, pickup.north) + pickup.y + 0.05, pickup.north);
      const plate = add(root, new CylinderGeometry(0.54, 0.58, 0.08, 24), new MeshStandardMaterial({ color: 0x192e34, metalness: 0.4, roughness: 0.65 }), 0, 0, 0);
      plate.receiveShadow = true;
      const ring = add(root, new TorusGeometry(0.46, 0.025, 5, 32), ringMaterial, 0, 0.065, 0);
      ring.rotation.x = Math.PI / 2;
      const beam = add(root, new CylinderGeometry(0.24, 0.38, 1.7, 16, 1, true), beamMaterial, 0, 0.91, 0);
      beam.visible = true;
      // The holder spins and bobs; it shows a simple stand-in until the real model loads.
      const holder = new Group();
      holder.position.y = 0.48;
      holder.rotation.set(-0.1, Math.PI / 5, -0.1);
      const model = makeWeapon(pickup.weapon, false);
      model.scale.setScalar(pickup.weapon === "rifle" ? 0.9 : 1.2);
      holder.add(model);
      root.add(holder);
      const light = new PointLight(0x5bdad8, 0.8, 5);
      light.position.y = 0.65;
      root.add(light);
      scene.add(root);
      this.pickups.set(pickup.id, { root, ring, beamMaterial, holder, weapon: pickup.weapon });
    }
  }

  setActive(kind: WeaponKind): void {
    if (kind === this.requested) return;
    this.requested = kind;
    if (!this.switching) { this.switching = true; this.switchPhase = 0; }
    else if (this.switchPhase >= 0.5) this.switchPhase = 1 - this.switchPhase;
    this.recoil = 0;
    this.flashTime = 0;
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

  setFallbackVisible(visible: boolean): void {
    this.fallbackVisible = visible;
    for (const [kind, model] of this.held) model.visible = visible && kind === this.active;
  }

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
      pickup.holder.traverse((object) => {
        if (!(object instanceof Mesh)) return;
        object.geometry.dispose();
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose();
      });
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

  muzzle(): Vector3 | undefined {
    return this.flashes.get(this.active)?.getWorldPosition(new Vector3());
  }
  attack(): void { this.recoil = 1; this.flashTime = 0.055; }


  update(seconds: number, motion: PlayerMotion, heading = 0, pitch = 0, eye?: Vector3, axes?: { right: Vector3; up: Vector3; forward: Vector3 }): void {
    const elapsed = Math.max(0, seconds);
    seconds = Math.min(elapsed, 0.05);
    if (this.switching) {
      this.switchPhase = Math.min(1, this.switchPhase + elapsed / 0.56);
      if (this.switchPhase >= 0.5) this.active = this.requested;
      if (this.switchPhase >= 1 - 1e-6) { this.switchPhase = 1; this.switching = false; }
    }
    for (const [kind, model] of this.held) model.visible = this.fallbackVisible && kind === this.active;
    this.time += seconds;
    this.swing(seconds, motion, heading, pitch, eye, axes?.right ?? new Vector3(1, 0, 0), axes?.up ?? new Vector3(0, 1, 0), axes?.forward ?? new Vector3(0, 0, -1));
    this.flashTime = Math.max(0, this.flashTime - seconds);
    for (const [kind, flash] of this.flashes) flash.visible = kind === this.active && this.flashTime > 0;
    this.movementBlend += ((motion.moving && !motion.airborne && !motion.sliding ? 1 : 0) - this.movementBlend) * Math.min(1, seconds * 8);
    // The weapon drops into the sprint carry steadily but comes up quickly to fire.
    const sprintTarget = motion.running && motion.moving && !motion.airborne ? 1 : 0;
    this.sprintBlend += (sprintTarget - this.sprintBlend) * Math.min(1, seconds * (sprintTarget > this.sprintBlend ? 6 : 13));
    // Both hands are busy climbing during a mantle, so the weapon tucks away.
    this.vault += ((motion.mantling || motion.climbing ? 1 : 0) - this.vault) * Math.min(1, seconds * 14);
    this.throwTime = Math.max(0, this.throwTime - elapsed);
    if (motion.moving) this.stride += motion.speed * seconds * (motion.running ? 1.55 : 1.25);
    this.recoil = Math.max(0, this.recoil - seconds * (this.active === "knife" ? 4.5 : 7));
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
    const reload = this.reloadTilt, jolt = this.reloadJolt;
    const held = this.held.get(this.active);
    if (held) {
      const pose = VIEW_POSES[this.active];
      const knife = this.active === "knife";
      const step = Math.sin(this.stride) * this.movementBlend;
      const lift = Math.abs(Math.cos(this.stride)) * this.movementBlend;
      const amplitude = motion.running ? 0.018 : 0.009;
      // Switching tucks the weapon down and inward; sprinting carries it low across the body.
      const throwing = this.throwTime > 0 ? Math.sin(Math.PI * (1 - this.throwTime / 0.55)) * 0.65 : 0;
      const lower = Math.max(this.switching ? Math.sin(Math.PI * this.switchPhase) ** 2 : 0, this.vault * 0.7, throwing);
      this.lower = lower;
      const sprint = this.sprintBlend;
      const sway = this.sway;
      held.position.set(
        pose.position[0] + step * amplitude + sway.x + sprint * pose.sprint[0] + lower * 0.06 - reload * 0.05,
        pose.position[1] + lift * amplitude + sway.y + sprint * pose.sprint[1] - lower * 0.75 - this.recoil * (knife ? 0.08 : 0.035) - reload * 0.06 + jolt * 0.014,
        pose.position[2] + sway.z + sprint * pose.sprint[2] + this.recoil * (knife ? 0.02 : 0.045) + lower * 0.08,
      );
      held.rotation.set(
        pose.rotation[0] + sway.pitch + this.recoil * (knife ? 0.8 : 0.19) + sprint * pose.sprint[3] - lower * 0.7 + reload * 0.2 + jolt * 0.05,
        pose.rotation[1] + sway.yaw + sprint * pose.sprint[4] + lower * 0.25,
        pose.rotation[2] + sway.roll + step * amplitude * 0.8 - this.recoil * (knife ? 0.55 : 0.04) + sprint * pose.sprint[5] - lower * 0.3 + reload * 0.5,
      );
    }
    for (const pickup of this.pickups.values()) {
      pickup.ring.rotation.z += seconds * 0.5;
      pickup.beamMaterial.opacity = 0.085 + Math.sin(this.time * 2.5) * 0.025;
      pickup.holder.rotation.y += seconds * 0.55;
      pickup.holder.position.y = 0.48 + Math.sin(this.time * 2.2) * 0.06;
    }
  }
}
