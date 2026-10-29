import {
  BoxGeometry, CylinderGeometry, ExtrudeGeometry, Group, Mesh, MeshStandardMaterial,
  PerspectiveCamera, PointLight, MeshBasicMaterial, Vector3, Scene, Shape, SphereGeometry, TorusGeometry,
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

interface PickupView { root: Group; ring: Mesh; beamMaterial: MeshStandardMaterial; }

// Rest pose of each held weapon in camera-local metres and radians, plus the offset
// (dx, dy, dz, rx, ry, rz) blended in while sprinting. Guns yaw slightly inward so the
// barrel converges on the crosshair instead of pointing off to the right.
export interface ViewPose { position: [number, number, number]; rotation: [number, number, number]; scale: number; sprint: [number, number, number, number, number, number]; }
export const VIEW_POSES: Record<WeaponKind, ViewPose> = {
  knife: { position: [0.3, -0.18, -0.8], rotation: [-0.26, -0.28, 0.18], scale: 0.75, sprint: [0.05, -0.1, 0.05, -0.4, -0.3, 0.3] },
  pistol: { position: [0.24, -0.2, -0.76], rotation: [-0.02, 0.09, -0.03], scale: 0.85, sprint: [0.05, -0.12, 0.04, -0.5, 0.4, -0.35] },
  rifle: { position: [0.25, -0.23, -0.6], rotation: [0.03, 0.12, 0.1], scale: 0.85, sprint: [0.04, -0.13, 0.06, -0.45, 0.5, -0.4] },
};

export class WeaponVisuals {
  private held = new Map<WeaponKind, Group>();
  private pickups = new Map<string, PickupView>();
  private active: WeaponKind = "knife";
  private requested: WeaponKind = "knife";
  private switchPhase = 0;
  private switching = false;
  private fallbackVisible = true;
  private turnLag = 0;
  private pitchLag = 0;
  private lastHeading: number | null = null;
  private lastPitch = 0;
  private landing = 0;
  private wasAirborne = false;
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
      const root = new Group();
      root.position.set(pickup.east, terrainHeight(data, pickup.east, pickup.north) + 0.05, pickup.north);
      const plate = add(root, new CylinderGeometry(0.54, 0.58, 0.08, 24), new MeshStandardMaterial({ color: 0x192e34, metalness: 0.4, roughness: 0.65 }), 0, 0, 0);
      plate.receiveShadow = true;
      const ring = add(root, new TorusGeometry(0.46, 0.025, 5, 32), ringMaterial, 0, 0.065, 0);
      ring.rotation.x = Math.PI / 2;
      const beam = add(root, new CylinderGeometry(0.24, 0.38, 1.7, 16, 1, true), beamMaterial, 0, 0.91, 0);
      beam.visible = true;
      const model = makeWeapon(pickup.weapon, false);
      model.position.y = 0.48;
      model.rotation.set(-0.1, Math.PI / 5, -0.1);
      model.scale.setScalar(pickup.weapon === "rifle" ? 0.9 : 1.2);
      root.add(model);
      const light = new PointLight(0x5bdad8, 0.8, 5);
      light.position.y = 0.65;
      root.add(light);
      scene.add(root);
      this.pickups.set(pickup.id, { root, ring, beamMaterial });
    }
  }

  setActive(kind: WeaponKind): void {
    if (kind === this.requested) return;
    this.requested = kind;
    if (!this.switching) { this.switching = true; this.switchPhase = 0; }
    else if (this.switchPhase >= 0.5) this.switchPhase = 1 - this.switchPhase;
    this.recoil = 0;
    this.flashTime = 0;
  }

  setFallbackVisible(visible: boolean): void {
    this.fallbackVisible = visible;
  }

  setTaken(taken: string[]): void {
    const hidden = new Set(taken);
    for (const [id, pickup] of this.pickups) pickup.root.visible = !hidden.has(id);
  }

  ready(): boolean { return !this.switching; }

  muzzle(): Vector3 | undefined {
    return this.flashes.get(this.active)?.getWorldPosition(new Vector3());
  }
  attack(): void { this.recoil = 1; this.flashTime = 0.055; }


  update(seconds: number, motion: PlayerMotion, heading = 0, pitch = 0): void {
    const elapsed = Math.max(0, seconds);
    seconds = Math.min(elapsed, 0.05);
    if (this.switching) {
      this.switchPhase = Math.min(1, this.switchPhase + elapsed / 0.56);
      if (this.switchPhase >= 0.5) this.active = this.requested;
      if (this.switchPhase >= 1 - 1e-6) { this.switchPhase = 1; this.switching = false; }
    }
    for (const [kind, model] of this.held) model.visible = this.fallbackVisible && kind === this.active;
    if (this.lastHeading !== null) {
      const turn = ((heading - this.lastHeading + 540) % 360) - 180;
      this.turnLag = Math.max(-0.025, Math.min(0.025, this.turnLag - turn*0.001));
      this.pitchLag = Math.max(-0.02, Math.min(0.02, this.pitchLag - (pitch-this.lastPitch)*0.001));
    }
    this.lastHeading = heading; this.lastPitch = pitch;
    this.turnLag *= Math.exp(-seconds*9); this.pitchLag *= Math.exp(-seconds*9);
    if (this.wasAirborne && !motion.airborne) this.landing = 0.025;
    this.wasAirborne = motion.airborne;
    this.landing *= Math.exp(-seconds*12);
    this.time += seconds;
    this.flashTime = Math.max(0, this.flashTime - seconds);
    for (const [kind, flash] of this.flashes) flash.visible = kind === this.active && this.flashTime > 0;
    this.movementBlend += ((motion.moving && !motion.airborne ? 1 : 0) - this.movementBlend) * Math.min(1, seconds * 8);
    this.sprintBlend += ((motion.running && motion.moving && !motion.airborne ? 1 : 0) - this.sprintBlend) * Math.min(1, seconds * 6);
    if (motion.moving) this.stride += motion.speed * seconds * (motion.running ? 1.55 : 1.25);
    this.recoil = Math.max(0, this.recoil - seconds * (this.active === "knife" ? 4.5 : 7));
    const held = this.held.get(this.active);
    if (held) {
      const pose = VIEW_POSES[this.active];
      const knife = this.active === "knife";
      const step = Math.sin(this.stride) * this.movementBlend;
      const lift = Math.abs(Math.cos(this.stride)) * this.movementBlend;
      const amplitude = motion.running ? 0.018 : 0.009;
      // Switching tucks the weapon down and inward; sprinting carries it low across the body.
      const lower = this.switching ? Math.sin(Math.PI * this.switchPhase) ** 2 : 0;
      const sprint = this.sprintBlend;
      const breath = Math.sin(this.time * 1.8) * 0.006;
      held.position.set(
        pose.position[0] + step * amplitude + this.turnLag + sprint * pose.sprint[0] + lower * 0.06,
        pose.position[1] + breath + lift * amplitude - this.landing + this.pitchLag + sprint * pose.sprint[1] - lower * 0.75 - this.recoil * (knife ? 0.08 : 0.035),
        pose.position[2] + sprint * pose.sprint[2] + this.recoil * (knife ? 0.02 : 0.045) + lower * 0.08,
      );
      held.rotation.set(
        pose.rotation[0] + this.recoil * (knife ? 0.8 : 0.19) + sprint * pose.sprint[3] - lower * 0.7,
        pose.rotation[1] - this.turnLag * 0.8 + sprint * pose.sprint[4] + lower * 0.25,
        pose.rotation[2] + step * amplitude * 0.8 - this.recoil * (knife ? 0.55 : 0.04) + sprint * pose.sprint[5] - lower * 0.3,
      );
    }
    for (const pickup of this.pickups.values()) {
      pickup.ring.rotation.z += seconds * 0.5;
      pickup.beamMaterial.opacity = 0.085 + Math.sin(this.time * 2.5) * 0.025;
      const model = pickup.root.children[3];
      if (model instanceof Group) {
        model.rotation.y += seconds * 0.55;
        model.position.y = 0.46 + Math.sin(this.time * 2.2) * 0.06;
      }
    }
  }
}
