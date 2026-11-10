import { AnimationMixer, Color, Group, LoopOnce, Matrix4, Mesh, MeshStandardMaterial, Object3D, Quaternion, SkinnedMesh, Texture, Vector3, type AnimationAction, type AnimationClip } from "three/webgpu";
import { type HeldGrip } from "./weaponModels";
import { FIST, HandRig, SUPPORT, TRIGGER } from "./handPose";
import { type Hold } from "./holding";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";

export type PlayerStance = "idle" | "walk" | "run" | "crouch";

interface Library { scene: Group; clips: AnimationClip[] }

// One rigged character shared by every other player: the GLB is fetched once and each
// peer gets a skeleton clone that shares geometry and textures. Other players are drawn
// once it has loaded.
export class PlayerModelLibrary {
  private library: Library | null = null;
  private failed = false;
  constructor() {
    const path: unknown = import.meta.env.VITE_PLAYER_MODEL;
    if (typeof path !== "string" || !path) { this.failed = true; return; }
    const url = new URL(path, new URL(import.meta.env.BASE_URL, location.origin));
    if (url.origin !== location.origin) { this.failed = true; return; }
    void new GLTFLoader().loadAsync(url.href).then((gltf) => {
      gltf.scene.traverse((object) => { if (object instanceof Mesh) { object.castShadow = true; object.receiveShadow = true; object.frustumCulled = false; } });
      this.library = { scene: gltf.scene, clips: gltf.animations };
    }).catch((error: unknown) => { this.failed = true; console.warn("Could not load the player model; other players will not be drawn.", error); });
  }
  ready(): boolean { return this.library !== null; }
  unavailable(): boolean { return this.failed; }
  instantiate(tint: Color): PlayerModelInstance | null {
    return this.library ? new PlayerModelInstance(this.library, tint) : null;
  }
  dispose(): void {
    const library = this.library;
    this.library = null;
    library?.scene.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      object.geometry.dispose();
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        for (const value of Object.values(material)) if (value instanceof Texture) value.dispose();
        material.dispose();
      }
    });
  }
}

const FADE = 0.2;
const WORLD_RIGHT = new Vector3(1, 0, 0);
const WORLD_FORWARD = new Vector3(0, 0, 1);
const WORLD_UP = new Vector3(0, 1, 0);
// A gun's frame has its barrel along -Z; turned half round it points the character's way (+Z).
const BARREL_FORWARD = new Quaternion().setFromAxisAngle(WORLD_UP, Math.PI);
// Running, the gun drops to a low ready: muzzle down and across the body.
const LOW_READY_PITCH = -38 * Math.PI / 180;
const LOW_READY_YAW = 18 * Math.PI / 180;
// A shot kicks the gun back and its muzzle up, settling in about a tenth of a second.
const KICK_BACK = 0.045;
const KICK_UP = 7 * Math.PI / 180;
const FLASH_SECONDS = 0.05;
// Hands on something carried: how far apart they sit from the body's middle, and how far ahead
// of and below the shoulders.
const CARRY_APART = 0.2;
const CARRY_OUT = 0.42;
const CARRY_DROP = 0.3;

interface ArmChain { upper: Object3D; fore: Object3D; hand: Object3D }
interface HeldGun { object: Object3D; grip: HeldGrip; flash: Object3D | null }

export class PlayerModelInstance {
  readonly root: Object3D;
  readonly weaponSocket: Object3D | null;
  private mixer: AnimationMixer;
  private actions = new Map<string, AnimationAction>();
  private stance: PlayerStance | "" = "";
  private dead = false;
  private pitch = 0;
  private spine: { bone: Object3D; axis: Vector3; forward: Vector3 }[] = [];
  private lean = 0;
  private flinchAmount = 0;
  // While a ragdoll drives the bones the animation is stopped; the pose before it is kept
  // so animation resumes cleanly on respawn.
  private frozen: { bone: Object3D; position: Vector3; quaternion: Quaternion; scale: Vector3 }[] | null = null;
  private materials: MeshStandardMaterial[] = [];
  private scratch = new Quaternion();
  // The right upper arm and forearm, for strokes.
  private arm: Object3D[] = [];
  private stroke: { kind: "slash" | "stab" | "shot"; time: number } | null = null;
  // Both arms, for holding a gun to the shoulder; the gun held, how far it has dropped to a
  // low ready, its recoil and how long its flash still shows.
  private arms: { right: ArmChain; left: ArmChain } | null = null;
  private gun: HeldGun | null = null;
  // Both hands out in front on something carried, and how far they have come up.
  private carrying = false;
  private carried = 0;
  // Hands on what is carried, the knife in the fist, and the finger joints behind them.
  private hold: Hold | null = null;
  private knife = false;
  private hands: HandRig | null = null;
  private ready = 0;
  private recoil = 0;
  private flashFor = 0;
  private temp = { a: new Vector3(), b: new Vector3(), c: new Vector3(), d: new Vector3(), q: new Quaternion(), r: new Quaternion(), m: new Matrix4(), n: new Matrix4() };

  constructor(library: Library, tint: Color) {
    this.root = cloneSkeleton(library.scene);
    this.root.traverse((object) => {
      if (object instanceof Mesh) {
        // Textures stay shared; only the material object is per peer so it can carry the tint.
        const materials = (Array.isArray(object.material) ? object.material : [object.material]) as MeshStandardMaterial[];
        const tinted = materials.map((material) => {
          const copy = material.clone();
          if (material.name.startsWith("body") || material.name.startsWith("equipment")) copy.color.copy(tint);
          this.materials.push(copy);
          return copy;
        });
        object.material = Array.isArray(object.material) ? tinted : tinted[0];
      }
    });
    this.mixer = new AnimationMixer(this.root);
    for (const clip of library.clips) {
      const action = this.mixer.clipAction(clip);
      if (clip.name === "death") { action.setLoop(LoopOnce, 1); action.clampWhenFinished = true; }
      this.actions.set(clip.name, action);
    }
    this.weaponSocket = this.root.getObjectByName("weapon_socket") ?? null;
    this.root.updateMatrixWorld(true);
    // Pitch tilts the upper spine and head about the axis that points to the character's
    // right in the bind pose, split so the lean reads naturally.
    for (const name of ["Bip01 Spine1", "Bip01 Spine2", "Bip01 Head"]) {
      // GLTFLoader replaces spaces in node names with underscores.
      const bone = this.root.getObjectByName(name.replace(/\s+/g, "_")) ?? this.root.getObjectByName(name);
      if (!bone) continue;
      const inverse = bone.getWorldQuaternion(new Quaternion()).invert();
      this.spine.push({ bone, axis: WORLD_RIGHT.clone().applyQuaternion(inverse).normalize(), forward: WORLD_FORWARD.clone().applyQuaternion(inverse).normalize() });
    }
    const boneNamed = (name: string): Object3D | undefined => this.root.getObjectByName(name.replace(/\s+/g, "_")) ?? this.root.getObjectByName(name);
    for (const name of ["Bip01 R UpperArm", "Bip01 R Forearm"]) {
      const bone = boneNamed(name);
      if (bone) this.arm.push(bone);
    }
    const chain = (side: "R" | "L"): ArmChain | null => {
      const upper = boneNamed(`Bip01 ${side} UpperArm`), fore = boneNamed(`Bip01 ${side} Forearm`), hand = boneNamed(`Bip01 ${side} Hand`);
      return upper && fore && hand ? { upper, fore, hand } : null;
    };
    const right = chain("R"), left = chain("L");
    if (right && left) this.arms = { right, left };
    this.hands = new HandRig(this.root);
    this.play("idle");
  }

  // Plays a knife stroke on the right arm over whatever the body is doing, or a shot: the gun
  // kicks and flashes, or without a gun held the arm kicks.
  attack(kind: "slash" | "stab" | "shot"): void {
    if (kind === "shot" && this.gun) { this.recoil = 1; this.flashFor = FLASH_SECONDS; this.ready = 0; return; }
    this.stroke = { kind, time: 0 };
  }

  setCarrying(carrying: boolean): void { this.carrying = carrying; }
  // Where the hands go on what is carried, when that is known.
  setHold(hold: Hold | null): void { this.hold = hold; }
  setKnife(out: boolean): void { this.knife = out; }

  // The gun to hold to the shoulder (it must be a child of root), or null for the knife or
  // empty hands, which the animation carries on the hand socket.
  holdGun(object: Object3D | null): void {
    if ((this.gun?.object ?? null) === object) return;
    const grip = object?.userData.grip as HeldGrip | null | undefined;
    if (this.gun?.flash) this.gun.flash.visible = false;
    this.gun = object && grip && this.arms ? { object, grip, flash: object.getObjectByName("muzzle") ?? null } : null;
  }

  // Where the held gun's muzzle is in the world, for tracers and the flash's light.
  muzzle(): Vector3 | null {
    return this.gun ? this.gun.object.localToWorld(this.gun.grip.muzzle.clone()) : null;
  }

  // Where spent cases leave the held gun: its ejection port, on the right just ahead of the grip.
  port(): Vector3 | null {
    if (!this.gun) return null;
    return this.gun.object.localToWorld(new Vector3(0.02, 0.05, this.gun.grip.muzzle.z * 0.2));
  }

  setStance(stance: PlayerStance): void {
    if (this.dead || stance === this.stance) return;
    this.play(stance);
  }

  setPitch(degrees: number): void { this.pitch = degrees; }

  // -1 to 1; the upper body bends toward the character's right for positive values.
  setLean(lean: number): void { this.lean = lean; }

  // A hit snaps the upper body back; it recovers over a fraction of a second.
  flinch(strength: number): void { this.flinchAmount = Math.min(1, this.flinchAmount + strength); }

  freeze(): void {
    if (this.frozen) return;
    this.mixer.stopAllAction();
    this.frozen = [];
    this.root.traverse((bone) => { if (bone.type === "Bone") this.frozen!.push({ bone, position: bone.position.clone(), quaternion: bone.quaternion.clone(), scale: bone.scale.clone() }); });
  }

  unfreeze(): void {
    if (!this.frozen) return;
    for (const saved of this.frozen) { saved.bone.position.copy(saved.position); saved.bone.quaternion.copy(saved.quaternion); saved.bone.scale.copy(saved.scale); }
    this.frozen = null;
    this.dead = false;
    this.play(this.stance || "idle");
  }

  setDead(dead: boolean): void {
    if (dead === this.dead) return;
    this.dead = dead;
    if (dead) this.play("death");
    else this.play(this.stance || "idle");
  }

  private play(name: string): void {
    const next = this.actions.get(name) ?? this.actions.get("idle");
    if (!next) return;
    for (const [other, action] of this.actions) if (action !== next && action.isRunning()) action.fadeOut(other === "death" ? FADE * 2 : FADE);
    next.reset().fadeIn(FADE).play();
    if (name !== "death") this.stance = name as PlayerStance;
  }

  update(seconds: number): void {
    if (this.frozen) return;
    this.mixer.update(seconds);
    this.flinchAmount *= Math.exp(-seconds * 9);
    if (this.dead) return;
    const angle = (-this.pitch * Math.PI / 180 - this.flinchAmount * 0.35) / this.spine.length;
    const bend = this.lean * 0.25 / this.spine.length;
    for (const { bone, axis, forward } of this.spine) {
      bone.quaternion.multiply(this.scratch.setFromAxisAngle(axis, angle));
      if (bend) bone.quaternion.multiply(this.scratch.setFromAxisAngle(forward, bend));
    }
    this.strike(seconds);
    this.aimGun(seconds);
    this.carryOut(seconds);
    if (this.knife && !this.gun && this.carried < 0.02) this.hands?.curl("R", FIST);
  }

  // Something carried in both hands: the hands come forward from the chest, to either side of
  // it, a little higher or lower as the player looks up or down.
  private carryOut(seconds: number): void {
    this.carried += (Number(this.carrying) - this.carried) * Math.min(1, seconds * 10);
    if (this.carried < 0.02 || !this.arms) return;
    const { a, b, c, q, m, n } = this.temp;
    this.root.updateWorldMatrix(true, true);
    this.root.getWorldQuaternion(q);
    if (this.hold && this.hands) {
      this.hands.reach("R", this.hold.right, new Vector3(-0.6, -1, -0.25).applyQuaternion(q), this.carried);
      this.hands.reach("L", this.hold.left, new Vector3(0.6, -1, -0.25).applyQuaternion(q), this.carried);
      this.hands.curl("R", this.hold.curl, this.carried);
      this.hands.curl("L", this.hold.curl, this.carried);
      return;
    }
    n.identity();
    for (const [arm, side] of [[this.arms.right, -1], [this.arms.left, 1]] as const) {
      const shoulder = arm.upper.getWorldPosition(a);
      const wrist = arm.hand.getWorldPosition(b);
      const want = c.set(side * CARRY_APART - shoulder.clone().sub(this.root.getWorldPosition(new Vector3())).applyQuaternion(q.clone().invert()).x, -CARRY_DROP + Math.sin(this.pitch * Math.PI / 180) * 0.25, CARRY_OUT).applyQuaternion(q).add(shoulder);
      this.reach(arm, m.makeTranslation(wrist.lerp(want, this.carried)), n, side);
    }
  }

  // A gun held to the right shoulder, its barrel along where the player looks (dropping to a
  // low ready while running), and both hands on it where the first-person arms hold it: the
  // gun is placed so the right shoulder sits where the first-person shoulder does, then each
  // arm reaches its hand there with two-bone inverse kinematics.
  private aimGun(seconds: number): void {
    const gun = this.gun, arms = this.arms;
    if (!gun || !arms || this.dead) return;
    const { a, b, q, r, m, n } = this.temp;
    this.ready += ((this.stance === "run" ? 1 : 0) - this.ready) * Math.min(1, seconds * 8);
    this.recoil *= Math.exp(-seconds * 22);
    this.root.updateWorldMatrix(true, true);
    // The gun's turn in the character's frame: half round to face forward, the player's
    // pitch, the low ready, then the kick.
    const pitch = this.pitch * Math.PI / 180 + LOW_READY_PITCH * this.ready;
    q.copy(BARREL_FORWARD)
      .premultiply(r.setFromAxisAngle(WORLD_RIGHT, -pitch))
      .premultiply(r.setFromAxisAngle(WORLD_UP, LOW_READY_YAW * this.ready))
      .multiply(r.setFromAxisAngle(WORLD_RIGHT, KICK_UP * this.recoil));
    const turn = this.root.getWorldQuaternion(r).multiply(q);
    // The gun's grip, placed from the shoulder, and pushed back by the kick.
    const shoulder = arms.right.upper.getWorldPosition(a);
    const grip = b.copy(gun.grip.shoulder).applyQuaternion(turn).negate().add(shoulder);
    grip.add(this.temp.c.set(0, 0, KICK_BACK * this.recoil).applyQuaternion(turn));
    m.compose(grip, turn, this.temp.d.set(1, 1, 1));
    // Into the gun's parent frame (the character's root).
    n.copy(gun.object.parent!.matrixWorld).invert().multiply(m);
    n.decompose(gun.object.position, gun.object.quaternion, gun.object.scale);
    gun.object.updateMatrixWorld(true);
    // Each hand to its place on the gun, its elbow toward the ground and out from the body.
    this.reach(arms.right, gun.object.matrixWorld, gun.grip.right, -1);
    this.reach(arms.left, gun.object.matrixWorld, gun.grip.left, 1);
    this.gripHand("R", gun.object.matrixWorld, gun.grip.right);
    this.gripHand("L", gun.object.matrixWorld, gun.grip.left);
    if (gun.flash) {
      this.flashFor -= seconds;
      gun.flash.visible = this.flashFor > 0;
      if (gun.flash.visible) { gun.flash.scale.setScalar(0.85 + Math.random() * 0.3); gun.flash.rotation.z = Math.random() * Math.PI * 2; }
    }
  }

  // The first-person arms' hand bones run along the fingers with their third axis out of the
  // palm, so each hold on the gun says which way this hand must face, whichever skeleton it is.
  private gripHand(side: "R" | "L", gunWorld: Matrix4, hold: Matrix4): void {
    if (!this.hands) return;
    const m = new Matrix4().multiplyMatrices(gunWorld, hold);
    this.hands.turnHand(side, new Vector3().setFromMatrixColumn(m, 1), new Vector3().setFromMatrixColumn(m, 2));
    this.hands.curl(side, side === "R" ? TRIGGER : SUPPORT);
  }

  // Two-bone inverse kinematics: turns the upper arm and forearm so the wrist reaches where
  // the hand belongs on the gun (gunWorld x hold), the elbow bent toward the ground and to
  // the arm's own side (side: -1 right, 1 left, in the character's frame). The hand keeps its
  // turn on the forearm: the first-person arms' hand turns do not carry over, as the two
  // skeletons' hand bones point different ways, and a hand that follows its forearm faces the gun.
  private reach(arm: ArmChain, gunWorld: Matrix4, hold: Matrix4, side: number): void {
    const target = new Matrix4().multiplyMatrices(gunWorld, hold);
    const wrist = new Vector3().setFromMatrixPosition(target);
    const shoulder = arm.upper.getWorldPosition(new Vector3());
    const elbowNow = arm.fore.getWorldPosition(new Vector3());
    const wristNow = arm.hand.getWorldPosition(new Vector3());
    const upperLength = shoulder.distanceTo(elbowNow), foreLength = elbowNow.distanceTo(wristNow);
    const toWrist = wrist.clone().sub(shoulder);
    const reachLength = Math.min(Math.max(toWrist.length(), 0.05), upperLength + foreLength - 0.001);
    const along = toWrist.normalize();
    // The bend's direction: down and out to the arm's side, square to the reach.
    const rootTurn = this.root.getWorldQuaternion(new Quaternion());
    const pole = new Vector3(side * 0.6, -1, -0.25).applyQuaternion(rootTurn);
    pole.addScaledVector(along, -pole.dot(along)).normalize();
    const cosine = (upperLength ** 2 + reachLength ** 2 - foreLength ** 2) / (2 * upperLength * reachLength);
    const elbow = shoulder.clone().addScaledVector(along, upperLength * cosine).addScaledVector(pole, upperLength * Math.sqrt(Math.max(0, 1 - cosine * cosine)));
    this.pointBone(arm.upper, elbowNow, elbow);
    this.pointBone(arm.fore, arm.hand.getWorldPosition(new Vector3()), shoulder.clone().addScaledVector(along, reachLength));
  }

  // Turns a bone, in the world, so its child moves from where it is toward where it should be.
  private pointBone(bone: Object3D, childNow: Vector3, childWanted: Vector3): void {
    const origin = bone.getWorldPosition(new Vector3());
    const from = childNow.clone().sub(origin).normalize(), to = childWanted.clone().sub(origin).normalize();
    const swing = new Quaternion().setFromUnitVectors(from, to);
    const world = bone.getWorldQuaternion(new Quaternion()).premultiply(swing);
    bone.quaternion.copy(bone.parent!.getWorldQuaternion(new Quaternion()).invert().multiply(world));
    bone.updateMatrixWorld(true);
  }

  // A slash raises the arm forward and sweeps it across the body; a stab draws the arm back
  // and drives it straight out; a shot kicks it up a little. Each eases in and out.
  private strike(seconds: number): void {
    const stroke = this.stroke;
    if (!stroke || this.arm.length < 2) return;
    stroke.time += seconds;
    const length = stroke.kind === "slash" ? 0.5 : stroke.kind === "stab" ? 0.75 : 0.16;
    const t = stroke.time / length;
    if (t >= 1) { this.stroke = null; return; }
    const ease = (from: number, to: number): number => Math.max(0, Math.min(1, (t - from) / (to - from)));
    const bell = (from: number, peak: number, to: number): number => t < peak ? Math.sin(ease(from, peak) * Math.PI / 2) : 1 - ease(peak, to) ** 2;
    const [upper, fore] = this.arm;
    // Rotations about the character's own side-to-side and vertical axes, expressed in
    // each bone's parent frame as the animation has posed it this frame.
    const around = (bone: Object3D, axis: Vector3, angle: number): void => {
      const parent = bone.parent!.getWorldQuaternion(new Quaternion()).invert();
      const local = axis.clone().applyQuaternion(this.root.getWorldQuaternion(new Quaternion())).applyQuaternion(parent);
      bone.quaternion.premultiply(this.scratch.setFromAxisAngle(local, angle));
    };
    let raise = 0, sweep = 0, bend = 0;
    if (stroke.kind === "slash") {
      raise = 1.25 * bell(0, 0.25, 1);
      sweep = 0.7 - 1.6 * ease(0.15, 0.45);
      sweep *= bell(0, 0.2, 1);
      bend = 0.6 * bell(0, 0.2, 0.7);
    } else if (stroke.kind === "stab") {
      raise = 1.35 * bell(0.25, 0.42, 1) - 0.3 * bell(0, 0.2, 0.32);
      bend = 1.3 * bell(0, 0.22, 0.38);
    } else {
      raise = 0.12 * bell(0, 0.15, 1);
    }
    around(upper, WORLD_RIGHT, -raise);
    around(upper, WORLD_UP, sweep);
    if (bend) around(fore, WORLD_RIGHT, -bend);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
    for (const material of this.materials) material.dispose();
    this.root.traverse((object) => { if (object instanceof SkinnedMesh) object.skeleton.dispose(); });
  }
}
