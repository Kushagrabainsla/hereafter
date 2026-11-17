import {
  AnimationMixer, CanvasTexture, Group, Matrix4, Mesh, MeshStandardMaterial, MeshStandardNodeMaterial, Object3D, PerspectiveCamera, Quaternion, Sprite, SpriteMaterial, Texture, Vector3,
  type AnimationAction,
} from "three/webgpu";
import { loadWeaponFile, type ViewFile } from "./weaponModels";
import { type WeaponKind } from "./combatRules";
import { GUN_FEEL } from "./gunFeel";
import { HandRig } from "./handPose";
import { toolHold, type Hold } from "./holding";
import { type PlayerMotion } from "./playerController";
import { type ViewDynamics } from "./weaponVisuals";
import { materialColor, materialRoughness } from "three/tsl";

// Worn, satin gunmetal over the model's own steel: rougher (never below 0.3, where the polished
// texture let it mirror the sky like chrome) and a little darker.
function wornSteel(source: MeshStandardMaterial): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial();
  material.copy(source);
  material.roughnessNode = materialRoughness.mul(0.5).add(0.3);
  material.colorNode = materialColor.mul(0.9);
  return material;
}

// muzzle carries the flash's geometry; flashRest is how that node is turned as authored.
interface Model { root: Group; rig: Group; mixer: AnimationMixer; clips: Map<string, AnimationAction>; muzzle: Object3D | null; flashRest: Quaternion; aim: Vector3; hands: HandRig }

// The puffs of smoke a shot leaves at the muzzle, drawn at once.
const PUFFS = 4;
const BARREL = new Vector3(0, 0, 1);

// A soft round puff, densest at its centre.
function puffTexture(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const context = canvas.getContext("2d")!, gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, "rgba(255,255,255,0.9)");
  gradient.addColorStop(0.5, "rgba(255,255,255,0.35)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  return new CanvasTexture(canvas);
}

interface Puff { sprite: Sprite; age: number; life: number; size: number; drift: Vector3; opacity: number }

const ATTACKS = ["fire"];
// Aiming down the sights: how far the sights stand above the bore, so they rather than the
// barrel line up on the view's centre, and how far the gun comes back toward the eye, in metres.
const SIGHTS: Record<WeaponKind, { height: number; back: number }> = { pistol: { height: 0.051, back: 0.02 }, rifle: { height: 0.07, back: 0.02 } };

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
};
// Hands on something real in the world have to be drawn through the world's own lens, at their
// real size, or they would not line up with what they hold.
const HANDS_FRAMING: Framing = { x: 0, y: 0, z: 0, fov: 75, aimFov: 75 };
// Where the extinguisher's handle is held: low and to the right, with the can hanging below the
// bottom of the view.
const TOOL_AT = { x: 0.2, y: -0.27, z: -0.42 };
const BASE_FOV = 75;

// Each GLB contains arms + weapon authored together in camera-local coordinates with
// idle, walk, run and fire clips (see scripts/viewmodels/build.py); the bare arms are their own
// file. URLs are explicit build settings: no downloads or third-party requests by default.
export class AuthoredViewModel {
  private models = new Map<ViewFile, Model>();
  private active: ViewFile = "pistol";
  private locomotion = "";
  private disposed = false;
  // The muzzle flash of the last shot: how long it still shows (s), whether a frame has drawn it,
  // and its size, stretch along the barrel and roll about it, new for each shot.
  private flash = { left: 0, drawn: true, size: 1, stretch: 1, roll: 0 };
  private puffs: Puff[] = [];
  private nextPuff = 0;
  private puffMap = puffTexture();
  private turn = new Quaternion();
  // The bare arms stand in for hands on something else; this is what they hold when that is an
  // extinguisher.
  private tool: Object3D | null = null;
  // What the hands are on, in the camera's frame; or that they are out of sight round it.
  private hold: Hold | "hidden" | null = null;
  private toolShown = false;
  private framing: Framing = FRAMING.pistol;
  private aimed = 0;
  constructor(private camera: PerspectiveCamera) {
    // The smoke puffs are always in the scene, at no size, so their shader is built at load.
    for (let i = 0; i < PUFFS; i += 1) {
      const sprite = new Sprite(new SpriteMaterial({ map: this.puffMap, color: 0x9a9792, transparent: true, opacity: 0, depthWrite: false }));
      sprite.scale.setScalar(0.0001);
      sprite.renderOrder = 60;
      camera.add(sprite);
      this.puffs.push({ sprite, age: 1, life: 1, size: 0, drift: new Vector3(), opacity: 0 });
    }
    for (const kind of ["hands", "pistol", "rifle"] as const) {
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
            // The pistol's steel came out as polished chrome that mirrored the sky; a carried service
            // pistol is worn, matte gunmetal, as the weapons in Saltline are.
            if (!Array.isArray(object.material) && object.material.name === "service_pistol") object.material = wornSteel(object.material as MeshStandardMaterial);
          }
        });
        const mixer = new AnimationMixer(root);
        const clips = new Map<string, AnimationAction>();
        for (const source of gltf.animations) {
          const name = source.name.toLowerCase();
          // The fire clip is not played. The kick of the gun comes from a spring and the muzzle
          // flash is timed in code (gunFeel.ts): the clip was the same for every shot.
          if (ATTACKS.includes(name)) continue;
          clips.set(name, mixer.clipAction(source));
        }
        root.visible = false;
        const rig = new Group();
        rig.add(root);
        camera.add(rig);
        const muzzle = root.getObjectByName("muzzle") ?? null;
        const aim = kind !== "hands" ? this.straighten(root, rig, mixer, clips, muzzle, SIGHTS[kind]) : new Vector3();
        const flashRest = muzzle ? muzzle.quaternion.clone() : new Quaternion();
        muzzle?.scale.setScalar(0);
        this.models.set(kind, { root, rig, mixer, clips, muzzle, flashRest, aim, hands });
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
  // The muzzle flash of a shot and the puff of smoke it leaves (the `flash` rows of GUN_FEEL):
  // the flash shows for a frame or two, at a new size and roll each time. aim is how far the
  // sights are up; the smoke is thinner in the line of sight.
  fire(weapon: WeaponKind, aim = 0): void {
    const feel = GUN_FEEL[weapon].flash, flash = this.flash;
    flash.left = feel.ms / 1000;
    flash.drawn = false;
    flash.size = feel.size[0] + Math.random() * (feel.size[1] - feel.size[0]);
    flash.stretch = 1 + (Math.random() * 2 - 1) * feel.stretch;
    flash.roll = Math.random() * Math.PI * 2;
    const muzzle = this.models.get(this.active)?.muzzle;
    if (!muzzle) return;
    const puff = this.puffs[this.nextPuff];
    this.nextPuff = (this.nextPuff + 1) % PUFFS;
    this.camera.worldToLocal(muzzle.getWorldPosition(puff.sprite.position));
    puff.age = 0;
    puff.life = feel.smokeSeconds;
    puff.size = feel.smokeSize * (0.8 + Math.random() * 0.4);
    puff.opacity = feel.smokeOpacity * (1 - 0.6 * aim);
    // Forward (away from the eye), up, and a little to a random side.
    puff.drift.set((Math.random() - 0.5) * 0.3, 0.45, -1).multiplyScalar(feel.smokeDrift / feel.smokeSeconds);
    puff.sprite.material.rotation = Math.random() * Math.PI * 2;
  }
  update(seconds: number, motion: PlayerMotion, dynamics: ViewDynamics): void {
    const wanted: ViewFile = dynamics.hands ? "hands" : dynamics.active;
    if (wanted !== this.active) { this.models.get(this.active)?.mixer.stopAllAction(); this.models.get(this.active)?.muzzle?.scale.setScalar(0); this.locomotion = ""; this.flash.left = 0; this.active = wanted; }
    this.drift(seconds);
    for (const [kind, model] of this.models) model.root.visible = kind === this.active && !(dynamics.hands && !this.toolShown && this.hold === "hidden");
    const model = this.models.get(this.active);
    if (!model) return;
    const arms = this.models.get("hands");
    if (arms && this.tool) {
      if (this.tool.parent !== arms.root) arms.root.add(this.tool);
      this.tool.position.set(TOOL_AT.x, TOOL_AT.y, TOOL_AT.z);
      this.tool.visible = dynamics.hands && this.toolShown;
    }
    // Looking down the sights the gun is held still, without the walk's swing.
    const desired = motion.moving && !motion.airborne && !motion.sliding && !motion.mantling && !motion.climbing && motion.aim < 0.5 ? motion.running ? "run" : "walk" : "idle";
    const next = model.clips.has(desired) ? desired : "idle";
    if (next !== this.locomotion) {
      model.clips.get(this.locomotion)?.fadeOut(0.15);
      model.clips.get(next)?.reset().fadeIn(0.15).play();
      this.locomotion = next;
    }
    model.mixer.update(seconds);
    // The flash, after the clips have had their say about the muzzle. The first frame after a
    // shot always draws it; after that it lasts as long as the table says.
    if (model.muzzle) {
      const flash = this.flash;
      if (flash.drawn) flash.left -= seconds; else flash.drawn = true;
      if (flash.left > 0) {
        model.muzzle.scale.set(flash.size, flash.size, flash.size * flash.stretch);
        model.muzzle.quaternion.copy(model.flashRest).multiply(this.turn.setFromAxisAngle(BARREL, flash.roll));
      } else model.muzzle.scale.setScalar(0);
    }
    // Switching, the spring sway and breathing come from the procedural state in
    // weaponVisuals.ts. A reload cants the weapon and tips the muzzle up, with a small kick
    // as the magazine seats and the action closes; the root pivots at the camera, so offsets
    // keep it low.
    const lower = dynamics.lower, reload = dynamics.reload, jolt = dynamics.jolt;
    // Aiming steadies the sway to a quarter and brings the sights to the centre of the view.
    const aim = motion.aim, steady = 1 - 0.75 * aim, raw = dynamics.sway;
    const sway = { x: raw.x * steady, y: raw.y * steady, z: raw.z * steady, pitch: raw.pitch * steady, yaw: raw.yaw * steady, roll: raw.roll * steady };
    model.root.position.set(sway.x + lower * 0.05 - reload * 0.06 + model.aim.x * aim, sway.y + (dynamics.hands ? 0.05 : 0) - lower * 0.55 - reload * 0.1 + jolt * 0.012 + model.aim.y * aim, sway.z + lower * 0.06 + model.aim.z * aim);
    this.framing = dynamics.hands || this.active === "hands" ? HANDS_FRAMING : FRAMING[this.active];
    this.aimed = aim;
    model.root.position.x += this.framing.x * (1 - aim);
    model.root.position.y += this.framing.y * (1 - aim);
    model.root.position.z += this.framing.z * (1 - aim);
    model.root.rotation.set(sway.pitch - lower * 0.6 + reload * 0.1 + jolt * 0.03, sway.yaw + lower * 0.25, sway.roll - lower * 0.3 + reload * 0.32);
    // The kick of each shot: back toward the eye and up, the muzzle tipped up and thrown a
    // little to one side and round, differently every shot.
    const kick = dynamics.kick;
    model.root.position.y += kick.up;
    model.root.position.z += kick.back;
    model.root.rotation.x += kick.pitch;
    model.root.rotation.y += kick.yaw;
    model.root.rotation.z += kick.roll;
    if (dynamics.hands) this.handsOn(model, lower);
  }
  // Each puff of muzzle smoke drifts forward and up, grows and thins out.
  private drift(seconds: number): void {
    for (const puff of this.puffs) {
      if (puff.age >= puff.life) continue;
      puff.age += seconds;
      const t = Math.min(1, puff.age / puff.life);
      if (t >= 1) { puff.sprite.material.opacity = 0; puff.sprite.scale.setScalar(0.0001); continue; }
      puff.sprite.position.addScaledVector(puff.drift, seconds * (1 - 0.6 * t));
      puff.sprite.scale.setScalar(puff.size * (0.25 + 0.75 * Math.sqrt(t)));
      puff.sprite.material.opacity = puff.opacity * (1 - t) ** 1.5;
    }
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
    for (const puff of this.puffs) { this.camera.remove(puff.sprite); puff.sprite.material.dispose(); }
    this.puffMap.dispose();
  }
}
