import {
  AnimationMixer, AnimationUtils, Group, LoopOnce, Matrix4, Mesh, Object3D, PerspectiveCamera, Quaternion, Texture, Vector3,
  type AnimationAction,
} from "three/webgpu";
import { loadWeaponFile } from "./weaponModels";
import { type KnifeStroke, type WeaponKind } from "./combatRules";
import { HandRig } from "./handPose";
import { toolHold, type Hold } from "./holding";
import { type PlayerMotion } from "./playerController";
import { type ViewDynamics } from "./weaponVisuals";

interface Model { root: Group; rig: Group; mixer: AnimationMixer; clips: Map<string, AnimationAction>; muzzle: Object3D | null; aim: Vector3; hands: HandRig }

// The knife's slash and stab clips are authored at 1/ATTACK_RATE speed so the fast arcs get
// more keyframes, and play back at ATTACK_RATE (see scripts/viewmodels/build.py).
const ATTACK_RATE = 2.5;
const ATTACKS = ["fire", "slash", "stab"];
// Aiming down the sights: how far the sights stand above the bore, so they rather than the
// barrel line up on the view's centre, and how far the gun comes back toward the eye, in metres.
const SIGHTS: Record<WeaponKind, { height: number; back: number }> = { knife: { height: 0, back: 0 }, pistol: { height: 0.051, back: 0.02 }, rifle: { height: 0.07, back: 0.02 } };

// How each weapon sits in the view: drawn through a narrower lens than the world and brought in
// and up, so it looks big low on the right and the arm runs off the edge of the screen with only
// the hand showing. Metres in the camera's frame (x right, y up, z toward the eye) and degrees.
// Aiming eases the offset away, so the sights still line up, and keeps a narrower lens than the
// world's so the arm stays out of the picture. fov and aimFov are at the normal 75 degrees of
// view, and follow it as a sprint or a crouch changes it.
interface Framing { x: number; y: number; z: number; fov: number; aimFov: number }
const FRAMING: Record<WeaponKind, Framing> = {
  rifle: { x: 0.015, y: 0.035, z: 0.08, fov: 44, aimFov: 52 },
  pistol: { x: 0.02, y: 0.035, z: -0.02, fov: 47, aimFov: 52 },
  knife: { x: -0.05, y: 0.06, z: 0, fov: 50, aimFov: 50 },
};
// Hands on something real in the world have to be drawn through the world's own lens, at their
// real size, or they would not line up with what they hold.
const HANDS_FRAMING: Framing = { x: 0, y: 0, z: 0, fov: 75, aimFov: 75 };
// Where the extinguisher's handle is held: low and to the right, with the can hanging below the
// bottom of the view.
const TOOL_AT = { x: 0.2, y: -0.27, z: -0.42 };
const BASE_FOV = 75;

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
  // The knife's arms stand in for hands on something else, with the knife left out; this is
  // what they hold when that is an extinguisher.
  private tool: Object3D | null = null;
  // What the hands are on, in the camera's frame; or that they are out of sight round it.
  private hold: Hold | "hidden" | null = null;
  private toolShown = false;
  private framing: Framing = FRAMING.knife;
  private aimed = 0;
  constructor(private camera: PerspectiveCamera) {
    for (const kind of ["knife", "pistol", "rifle"] as const) {
      void loadWeaponFile(kind).then((gltf) => {
        if (!gltf) return;
        const root = gltf.scene;
        if (this.disposed) { this.release(root); return; }
        const hands = new HandRig(root);
        root.traverse((object) => {
          if (object instanceof Mesh) {
            object.renderOrder = 50;
            object.frustumCulled = false;
            // Fingers and the weapon shade each other under the key light.
            object.castShadow = true;
            object.receiveShadow = true;
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
        const muzzle = root.getObjectByName("muzzle") ?? null;
        const aim = kind !== "knife" ? this.straighten(root, rig, mixer, clips, muzzle, SIGHTS[kind]) : new Vector3();
        this.models.set(kind, { root, rig, mixer, clips, muzzle, aim, hands });
        this.locomotion = "";
      }).catch((error: unknown) => console.warn(`Could not load the ${kind} view model; it will not be drawn.`, error));
    }
  }
  // The authored files hold guns yawed and canted toward the screen centre. Turning the
  // whole arms-and-weapon rig about the grip so the barrel runs parallel to the view
  // makes it point at the crosshair from any range (parallel lines meet at the centre on
  // screen), and tracers from the muzzle then leave along the barrel.
  // Returns how far to move the gun, in the camera's frame, to bring its sights onto the view's
  // centre: the barrel then runs along the line of sight, under the sights.
  private straighten(root: Group, rig: Group, mixer: AnimationMixer, clips: Map<string, AnimationAction>, muzzle: Object3D | null, sights: { height: number; back: number }): Vector3 {
    const weapon = root.getObjectByName("weapon");
    if (!weapon) return new Vector3();
    const idle = clips.get("idle");
    idle?.play();
    mixer.update(0);
    root.updateMatrixWorld(true);
    const grip = new Vector3(), turn = new Quaternion(), scale = new Vector3();
    new Matrix4().copy(root.matrixWorld).invert().multiply(weapon.matrixWorld).decompose(grip, turn, scale);
    rig.quaternion.copy(turn).invert();
    rig.position.copy(grip).sub(grip.clone().applyQuaternion(rig.quaternion));
    rig.updateMatrix();
    const end = muzzle ? new Matrix4().copy(root.matrixWorld).invert().multiply(muzzle.matrixWorld) : null;
    idle?.stop();
    if (!end) return new Vector3();
    // The muzzle in the camera's frame, through the straightened rig.
    const at = new Vector3().setFromMatrixPosition(end).applyMatrix4(rig.matrix);
    return new Vector3(-at.x, -at.y - sights.height, sights.back);
  }

  // The thing to show in the empty hands when holding a tool, and whether to show it.
  setTool(tool: Object3D): void { this.tool = tool; tool.visible = false; }
  showTool(shown: boolean): void { this.toolShown = shown; }
  setHold(hold: Hold | "hidden" | null): void { this.hold = hold; }

  hasModel(): boolean { return this.models.has(this.active); }
  // Muzzle position in camera-local metres for tracers, when the active model has one.
  muzzle(): Vector3 | undefined {
    const muzzle = this.models.get(this.active)?.muzzle;
    return muzzle ? muzzle.getWorldPosition(new Vector3()) : undefined;
  }
  // The lens to draw the weapon through, given what the plain view would be.
  viewFov(handFov: number): number {
    return (this.framing.fov + (this.framing.aimFov - this.framing.fov) * this.aimed) * handFov / BASE_FOV;
  }
  // The same muzzle, moved to where it appears on screen when looked at through the world's
  // lens instead of the weapon's, so a tracer leaves from where the muzzle is seen.
  muzzleOnScreen(viewFov: number, worldFov: number): Vector3 | undefined {
    const at = this.muzzle();
    if (!at) return undefined;
    const scale = Math.tan(worldFov * Math.PI / 360) / Math.tan(viewFov * Math.PI / 360);
    at.x *= scale;
    at.y *= scale;
    return at;
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
    const wanted = dynamics.hands ? "knife" : dynamics.active;
    if (wanted !== this.active) { this.models.get(this.active)?.mixer.stopAllAction(); this.locomotion = ""; this.attacking = null; this.active = wanted; }
    for (const [kind, model] of this.models) model.root.visible = kind === this.active && !(dynamics.hands && !this.toolShown && this.hold === "hidden");
    const model = this.models.get(this.active);
    if (!model) return;
    const stand = this.models.get("knife");
    const weapon = stand?.root.getObjectByName("weapon");
    if (stand && weapon) {
      weapon.visible = !dynamics.hands;
      if (this.tool) {
        if (this.tool.parent !== stand.root) stand.root.add(this.tool);
        this.tool.position.set(TOOL_AT.x, TOOL_AT.y, TOOL_AT.z);
        this.tool.visible = dynamics.hands && this.toolShown;
      }
    }
    // Looking down the sights the gun is held still, without the walk's swing.
    const desired = motion.moving && !motion.airborne && !motion.sliding && !motion.mantling && !motion.climbing && motion.aim < 0.5 ? motion.running ? "run" : "walk" : "idle";
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
    // Switching, the spring sway and breathing come from the procedural state in
    // weaponVisuals.ts. A reload cants the weapon and tips the muzzle up, with a small kick
    // as the magazine seats and the action closes; the root pivots at the camera, so offsets
    // keep it low.
    const lower = dynamics.lower, reload = dynamics.reload, jolt = dynamics.jolt, kick = this.recoil;
    // Aiming steadies the sway to a quarter and brings the sights to the centre of the view.
    const aim = motion.aim, steady = 1 - 0.75 * aim, raw = dynamics.sway;
    const sway = { x: raw.x * steady, y: raw.y * steady, z: raw.z * steady, pitch: raw.pitch * steady, yaw: raw.yaw * steady, roll: raw.roll * steady };
    model.root.position.set(sway.x + lower * 0.05 - reload * 0.06 + model.aim.x * aim, sway.y + (dynamics.hands ? 0.05 : 0) - lower * 0.55 - reload * 0.1 + jolt * 0.012 - kick * 0.01 + model.aim.y * aim, sway.z + lower * 0.06 + kick * 0.035 + model.aim.z * aim);
    this.framing = dynamics.hands ? HANDS_FRAMING : FRAMING[this.active];
    this.aimed = aim;
    model.root.position.x += this.framing.x * (1 - aim);
    model.root.position.y += this.framing.y * (1 - aim);
    model.root.position.z += this.framing.z * (1 - aim);
    model.root.rotation.set(sway.pitch - lower * 0.6 + reload * 0.1 + jolt * 0.03 + kick * 0.12, sway.yaw + lower * 0.25 - kick * 0.05, sway.roll - lower * 0.3 + reload * 0.32 + kick * 0.08);
    if (dynamics.hands) this.handsOn(model, lower);
  }
  // Puts the hands on what they hold, once the arms have been posed. They arrive as the arms come
  // up, from wherever the animation had them.
  private handsOn(model: Model, lower: number): void {
    if (this.hold === "hidden" && !this.toolShown) return;
    model.root.updateWorldMatrix(true, true);
    const fromCamera = this.camera.matrixWorld;
    let hold: Hold | null = null;
    if (this.toolShown && this.tool) hold = toolHold(this.tool.matrixWorld);
    else if (this.hold && this.hold !== "hidden") {
      const place = (hand: Hold["right"]): Hold["right"] => ({ grip: hand.grip.clone().applyMatrix4(fromCamera), fingers: hand.fingers.clone().transformDirection(fromCamera), palm: hand.palm.clone().transformDirection(fromCamera) });
      hold = { right: place(this.hold.right), left: place(this.hold.left), curl: this.hold.curl };
    }
    if (!hold) return;
    const weight = Math.max(0, 1 - lower * 2);
    model.hands.reach("R", hold.right, new Vector3(0.8, -1, 0.15).transformDirection(fromCamera), weight);
    model.hands.reach("L", hold.left, new Vector3(-0.8, -1, 0.15).transformDirection(fromCamera), weight);
    model.hands.curl("R", hold.curl, weight);
    model.hands.curl("L", hold.curl, weight);
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
