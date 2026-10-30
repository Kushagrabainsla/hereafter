import {
  AnimationMixer, AnimationUtils, Group, LoopOnce, Matrix4, Mesh, MeshSSSNodeMaterial, MeshStandardMaterial, Object3D, PerspectiveCamera, Quaternion, Texture, Vector3,
  type AnimationAction,
} from "three/webgpu";
import { clamp, dot, float, materialColor, materialRoughness, mix, smoothstep, vec3 } from "three/tsl";
import { loadWeaponFile } from "./weaponModels";
import { type KnifeStroke, type WeaponKind } from "./combatRules";
import { type PlayerMotion } from "./playerController";
import { type ViewDynamics } from "./weaponVisuals";

interface Model { root: Group; rig: Group; mixer: AnimationMixer; clips: Map<string, AnimationAction>; muzzle: Object3D | null }

// The knife's slash and stab clips are authored at 1/ATTACK_RATE speed so the fast arcs get
// more keyframes, and play back at ATTACK_RATE (see scripts/viewmodels/build.py).
const ATTACK_RATE = 2.5;
const ATTACKS = ["fire", "slash", "stab"];

// Skin and cloth from the one arm texture. Skin is told apart by colour: it is redder than
// it is green, where the gloves, sleeves and watch strap are grey or grey-green. Cloth gets
// a soft sheen at grazing angles and stays rough; skin is smoother with a faint sheen of
// fine hair, and light passing through thin skin comes out red, so fingers and the edge of
// the forearm glow when a lamp is behind them.
function realisticArms(source: MeshStandardMaterial): MeshSSSNodeMaterial {
  const material = new MeshSSSNodeMaterial();
  material.name = source.name;
  material.map = source.map;
  material.normalMap = source.normalMap;
  material.normalScale.copy(source.normalScale).multiplyScalar(1.35);
  material.roughnessMap = source.roughnessMap;
  material.roughness = source.roughness;
  material.metalness = 0;
  const color = materialColor;
  const skin = smoothstep(0.045, 0.11, color.r.sub(color.g)).mul(smoothstep(0.04, 0.1, color.r));
  // The painted skin is far more saturated than real skin, which reads as orange plastic
  // under the market's warm lamps: pull it part way toward its own brightness.
  const luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
  material.colorNode = mix(color, mix(vec3(luma), color, 0.8).mul(0.88), skin);
  material.roughnessNode = mix(clamp(materialRoughness.mul(1.1), 0.62, 1), float(0.6), skin);
  material.sheenNode = mix(vec3(0.3, 0.31, 0.28), vec3(0.05, 0.035, 0.03), skin);
  material.sheenRoughnessNode = mix(float(0.8), float(0.5), skin);
  material.specularIntensityNode = mix(float(0.22), float(0.35), skin);
  material.thicknessColorNode = vec3(1, 0.3, 0.18).mul(skin);
  material.thicknessDistortionNode = float(0.18);
  material.thicknessAmbientNode = float(0);
  material.thicknessAttenuationNode = float(0.55);
  material.thicknessPowerNode = float(3);
  material.thicknessScaleNode = float(5);
  return material;
}

// Each GLB contains arms + weapon authored together in camera-local coordinates with
// idle, walk, run and fire clips, and slash and stab for the knife (see
// scripts/viewmodels/build.py). URLs are explicit build settings: no downloads or
// third-party requests by default.
export class AuthoredViewModel {
  private models = new Map<WeaponKind, Model>();
  private active: WeaponKind = "knife";
  private locomotion = "";
  private disposed = false;
  private attacking: AnimationAction | null = null;
  private hitStop = 0;
  // A blade turned by something hard kicks the hand back and up, then settles.
  private recoil = 0;
  private recoilSpeed = 0;
  constructor(private camera: PerspectiveCamera) {
    for (const kind of ["knife", "pistol", "rifle"] as const) {
      void loadWeaponFile(kind).then((gltf) => {
        if (!gltf) return;
        const root = gltf.scene;
        if (this.disposed) { this.release(root); return; }
        root.traverse((object) => {
          if (object instanceof Mesh) {
            object.renderOrder = 50;
            object.frustumCulled = false;
            // Fingers and the weapon shade each other under the key light.
            object.castShadow = true;
            object.receiveShadow = true;
            if (object.name === "arms" || object.parent?.name === "arms") {
              const materials = Array.isArray(object.material) ? object.material : [object.material];
              const upgraded = materials.map((material) => material.name === "arms" && material instanceof MeshStandardMaterial ? realisticArms(material) : material);
              object.material = Array.isArray(object.material) ? upgraded : upgraded[0];
            }
            for (const material of Array.isArray(object.material) ? object.material : [object.material]) { material.depthTest = true; material.depthWrite = true; }
          }
        });
        const mixer = new AnimationMixer(root);
        const clips = new Map<string, AnimationAction>();
        for (const source of gltf.animations) {
          const name = source.name.toLowerCase();
          let clip = source;
          if (ATTACKS.includes(name)) {
            // Attack clips start on the neutral pose, so they layer over whichever
            // locomotion clip is playing instead of averaging with it. Each is cloned first:
            // exporters share one accessor between identical constant tracks of different
            // clips, and makeClipAdditive subtracts from the track arrays in place.
            clip = AnimationUtils.makeClipAdditive(source.clone());
          }
          const action = mixer.clipAction(clip);
          if (ATTACKS.includes(name)) { action.setLoop(LoopOnce, 1); action.clampWhenFinished = false; }
          clips.set(name, action);
        }
        root.visible = false;
        const rig = new Group();
        rig.add(root);
        camera.add(rig);
        if (kind !== "knife") this.straighten(root, rig, mixer, clips);
        this.models.set(kind, { root, rig, mixer, clips, muzzle: root.getObjectByName("muzzle") ?? null });
        this.locomotion = "";
      }).catch((error: unknown) => console.warn(`Could not load ${kind} view model; using fallback.`, error));
    }
  }
  // The authored files hold guns yawed and canted toward the screen centre. Turning the
  // whole arms-and-weapon rig about the grip so the barrel runs parallel to the view
  // makes it point at the crosshair from any range (parallel lines meet at the centre on
  // screen), and tracers from the muzzle then leave along the barrel.
  private straighten(root: Group, rig: Group, mixer: AnimationMixer, clips: Map<string, AnimationAction>): void {
    const weapon = root.getObjectByName("weapon");
    if (!weapon) return;
    const idle = clips.get("idle");
    idle?.play();
    mixer.update(0);
    root.updateMatrixWorld(true);
    const grip = new Vector3(), turn = new Quaternion(), scale = new Vector3();
    new Matrix4().copy(root.matrixWorld).invert().multiply(weapon.matrixWorld).decompose(grip, turn, scale);
    rig.quaternion.copy(turn).invert();
    rig.position.copy(grip).sub(grip.clone().applyQuaternion(rig.quaternion));
    idle?.stop();
  }

  hasModel(): boolean { return this.models.has(this.active); }
  // Muzzle position in camera-local metres for tracers, when the active model has one.
  muzzle(): Vector3 | undefined {
    const muzzle = this.models.get(this.active)?.muzzle;
    return muzzle ? muzzle.getWorldPosition(new Vector3()) : undefined;
  }
  // The gun's recoil clip, or the knife stroke's.
  fire(stroke?: KnifeStroke): void {
    const clips = this.models.get(this.active)?.clips;
    const action = stroke ? clips?.get(stroke) ?? clips?.get("fire") : clips?.get("fire");
    if (!action) return;
    this.attacking?.stop();
    action.reset().setEffectiveWeight(1).play();
    action.timeScale = stroke && clips?.has(stroke) ? ATTACK_RATE : 1;
    this.attacking = action;
    this.hitStop = 0;
  }
  // The blade bites: the stroke all but stops for a moment, as flesh resists it.
  bite(): void { this.hitStop = 0.075; }
  // The blade struck something hard: the stroke stops dead and the hand jolts back.
  deflect(): void {
    this.attacking?.fadeOut(0.16);
    this.recoilSpeed = 14;
  }
  update(seconds: number, motion: PlayerMotion, dynamics: ViewDynamics): void {
    if (dynamics.active !== this.active) { this.models.get(this.active)?.mixer.stopAllAction(); this.locomotion = ""; this.attacking = null; this.active = dynamics.active; }
    for (const [kind, model] of this.models) model.root.visible = kind === this.active;
    const model = this.models.get(this.active);
    if (!model) return;
    const desired = motion.moving && !motion.airborne && !motion.sliding && !motion.mantling && !motion.climbing ? motion.running ? "run" : "walk" : "idle";
    const next = model.clips.has(desired) ? desired : "idle";
    if (next !== this.locomotion) {
      model.clips.get(this.locomotion)?.fadeOut(0.15);
      model.clips.get(next)?.reset().fadeIn(0.15).play();
      this.locomotion = next;
    }
    if (this.attacking && this.hitStop > 0) {
      this.hitStop = Math.max(0, this.hitStop - seconds);
      this.attacking.timeScale = this.hitStop > 0 ? ATTACK_RATE * 0.08 : ATTACK_RATE;
    }
    model.mixer.update(seconds);
    // A critically damped kick: out fast, back without overshoot.
    this.recoilSpeed += (-140 * this.recoil - 2 * Math.sqrt(140) * this.recoilSpeed) * seconds;
    this.recoil += this.recoilSpeed * seconds;
    // Switching, the spring sway and breathing come from the shared procedural state so
    // authored and fallback weapons behave the same way. A reload cants the weapon and tips
    // the muzzle up, with a small kick as the magazine seats and the action closes; the
    // root pivots at the camera, so offsets keep it low.
    const lower = dynamics.lower, reload = dynamics.reload, jolt = dynamics.jolt, sway = dynamics.sway, kick = this.recoil;
    model.root.position.set(sway.x + lower * 0.05 - reload * 0.06, sway.y - lower * 0.55 - reload * 0.1 + jolt * 0.012 - kick * 0.01, sway.z + lower * 0.06 + kick * 0.035);
    model.root.rotation.set(sway.pitch - lower * 0.6 + reload * 0.1 + jolt * 0.03 + kick * 0.12, sway.yaw + lower * 0.25 - kick * 0.05, sway.roll - lower * 0.3 + reload * 0.32 + kick * 0.08);
  }
  private release(root: Group): void {
    root.traverse((object) => {
      if (object instanceof Mesh) {
        object.geometry.dispose();
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          for (const value of Object.values(material)) if (value instanceof Texture) value.dispose();
          material.dispose();
        }
      }
    });
  }
  dispose(): void {
    this.disposed = true;
    for (const model of this.models.values()) { model.mixer.stopAllAction(); model.mixer.uncacheRoot(model.root); this.camera.remove(model.rig); this.release(model.root); }
    this.models.clear();
  }
}
