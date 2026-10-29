import {
  BoxGeometry, CapsuleGeometry, Color, CylinderGeometry, Group, Mesh, MeshStandardMaterial,
  Scene, SphereGeometry, Vector3, type Object3D,
} from "three/webgpu";
import { terrainHeight, type ArenaData } from "../world/arena";
import { type PlayerPose } from "./playerController";
import { type WeaponKind } from "./combatRules";
import { makeWeapon } from "./weaponVisuals";
import { PlayerModelLibrary, type PlayerModelInstance } from "./playerModel";
import { CharacterRagdoll } from "./ragdoll";
import { type PhysicsWorld, type Vec3 } from "../world/physics";

// Other players are drawn this far behind their latest pose, interpolating between pose
// packets placed on the sender's own clock, so they move smoothly despite network jitter.
const INTERP_DELAY_MS = 100;
const EXTRAPOLATE_MS = 100;

interface PoseSample { time: number; pose: PlayerPose }

function lerpHeading(a: number, b: number, t: number): number {
  return (a + ((((b - a) % 360) + 540) % 360 - 180) * t + 360) % 360;
}

// Where each procedural weapon's grip sits, so it can be moved onto the character's hand socket.
const GRIP_OFFSET: Record<WeaponKind, [number, number, number]> = { knife: [0, 0.065, -0.015], pistol: [0, 0.165, -0.012], rifle: [0, 0.165, -0.012] };

interface RemoteAvatar {
  root: Group;
  mannequin: Group;
  model: PlayerModelInstance | null;
  tint: Color;
  head: Group;
  leftArm: Group;
  rightArm: Group;
  leftLeg: Group;
  rightLeg: Group;
  pose: PlayerPose;
  heading: number;
  stride: number;
  weapons: Map<WeaponKind, Group>;
  samples: PoseSample[];
  dying: boolean;
  ragdoll: CharacterRagdoll | null;
  impulse?: { part: string; vector: Vec3 };
  previous: Vector3;
  velocity: Vector3;
  // Smallest observed (receive clock - send clock), relaxed slowly so clock drift is followed.
  offset: number | null;
  offsetAt: number;
  displayTime: number;
}

function addPart(parent: Group, geometry: BoxGeometry | CapsuleGeometry | CylinderGeometry | SphereGeometry, material: MeshStandardMaterial, x: number, y: number, z: number): void {
  const mesh = new Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
}

function createAvatar(peerId: string): RemoteAvatar {
  const root = new Group();
  const mannequin = new Group();
  root.add(mannequin);
  const hue = [...peerId].reduce((value, character) => value + character.charCodeAt(0), 0) % 360 / 360;
  const jacket = new MeshStandardMaterial({ color: new Color().setHSL(hue, 0.31, 0.3), roughness: 0.9 });
  const dark = new MeshStandardMaterial({ color: 0x253038, roughness: 0.9 });
  const trim = new MeshStandardMaterial({ color: 0x9ec6bf, roughness: 0.68, metalness: 0.2 });
  const skin = new MeshStandardMaterial({ color: 0xb58c72, roughness: 0.95 });
  addPart(mannequin, new CapsuleGeometry(0.23, 0.48, 5, 10), jacket, 0, 1.13, 0);
  addPart(mannequin, new BoxGeometry(0.42, 0.13, 0.07), trim, 0, 1.26, 0.21);
  addPart(mannequin, new CylinderGeometry(0.16, 0.18, 0.2, 8), dark, 0, 0.73, 0);

  const head = new Group();
  head.position.set(0, 1.64, 0);
  addPart(head, new SphereGeometry(0.19, 12, 10), skin, 0, 0, 0);
  addPart(head, new BoxGeometry(0.3, 0.07, 0.04), dark, 0, 0.025, 0.18);
  addPart(head, new CapsuleGeometry(0.205, 0.015, 3, 10), dark, 0, 0.17, -0.005);
  mannequin.add(head);

  const leftArm = new Group();
  const rightArm = new Group();
  for (const [arm, side] of [[leftArm, -1], [rightArm, 1]] as const) {
    arm.position.set(side * 0.3, 1.35, 0);
    addPart(arm, new CylinderGeometry(0.09, 0.075, 0.62, 8), jacket, side * 0.02, -0.32, 0);
    addPart(arm, new SphereGeometry(0.09, 8, 7), dark, side * 0.02, -0.65, 0);
    mannequin.add(arm);
  }

  const leftLeg = new Group();
  const rightLeg = new Group();
  for (const [leg, side] of [[leftLeg, -1], [rightLeg, 1]] as const) {
    leg.position.set(side * 0.135, 0.73, 0);
    addPart(leg, new CylinderGeometry(0.105, 0.095, 0.63, 8), dark, 0, -0.32, 0);
    addPart(leg, new BoxGeometry(0.2, 0.13, 0.31), dark, 0, -0.66, 0.07);
    mannequin.add(leg);
  }

  const weapons = new Map<WeaponKind, Group>();
  for (const kind of ["knife", "pistol", "rifle"] as const) {
    const model = makeWeapon(kind, false);
    model.position.set(0.03, -0.69, 0.09);
    model.rotation.set(kind === "knife" ? 0.2 : -0.08, Math.PI, kind === "knife" ? -0.18 : 0);
    model.scale.setScalar(kind === "rifle" ? 0.75 : kind === "pistol" ? 0.68 : 0.62);
    model.visible = kind === "knife";
    rightArm.add(model);
    weapons.set(kind, model);
  }

  return { root, mannequin, model: null, tint: new Color().setHSL(hue, 0.5, 0.78), head, leftArm, rightArm, leftLeg, rightLeg, pose: {
    east: 0, north: 0, heading: 0, pitch: 0, jumpHeight: 0,
    moving: false, running: false, crouching: false,
  }, heading: 0, stride: 0, weapons, samples: [], offset: null, offsetAt: 0, displayTime: 0, dying: false, ragdoll: null, previous: new Vector3(), velocity: new Vector3() };
}

export class RemotePlayers {
  private avatars = new Map<string, RemoteAvatar>();
  private dead = new Set<string>();
  private equipped = new Map<string, WeaponKind>();
  private weaponModels: Map<WeaponKind, Object3D> | null = null;

  constructor(private scene: Scene, private data: ArenaData, private models: PlayerModelLibrary, private physics?: PhysicsWorld) {}

  // Swap a mannequin for the shared character once the model has loaded.
  private attachModel(avatar: RemoteAvatar, dead: boolean): void {
    const model = this.models.instantiate(avatar.tint);
    if (!model) return;
    if (dead && !this.physics) model.setDead(true);
    avatar.model = model;
    avatar.mannequin.visible = false;
    avatar.root.scale.y = 1;
    avatar.root.add(model.root);
    for (const [kind, weapon] of avatar.weapons) {
      const parent = model.weaponSocket ?? avatar.root;
      parent.add(weapon);
      weapon.position.set(...GRIP_OFFSET[kind]);
      weapon.rotation.set(0, 0, 0);
      weapon.scale.setScalar(1);
    }
    this.useRealWeapons(avatar);
  }

  // Characters hold the same weapon models the player sees in first person. Those share
  // the stand-ins' frame (grip at the origin, barrel along -Z), so they sit on the hand
  // socket unchanged.
  setWeaponModels(models: Map<WeaponKind, Object3D>): void {
    this.weaponModels = models;
    for (const avatar of this.avatars.values()) if (avatar.model) this.useRealWeapons(avatar);
  }

  private useRealWeapons(avatar: RemoteAvatar): void {
    if (!this.weaponModels || !avatar.model?.weaponSocket) return;
    for (const [kind, old] of avatar.weapons) {
      const source = this.weaponModels.get(kind);
      if (!source || old.userData.real) continue;
      const copy = source.clone(true) as Group;
      copy.userData.real = true;
      copy.visible = old.visible;
      avatar.model.weaponSocket.add(copy);
      old.removeFromParent();
      old.traverse((object) => {
        if (!(object instanceof Mesh)) return;
        object.geometry.dispose();
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose();
      });
      avatar.weapons.set(kind, copy);
    }
  }

  // sentAt is the moment on the sender's clock the pose was taken.
  setPose(peerId: string, pose: PlayerPose, sentAt = Date.now()): void {
    let avatar = this.avatars.get(peerId);
    if (!avatar) {
      avatar = createAvatar(peerId);
      avatar.root.position.set(pose.east, terrainHeight(this.data, pose.east, pose.north) + pose.jumpHeight, pose.north);
      avatar.heading = pose.heading;
      this.avatars.set(peerId, avatar);
      this.scene.add(avatar.root);
    }
    avatar.root.visible = avatar.model !== null || !this.dead.has(peerId);
    this.setWeapon(peerId, this.equipped.get(peerId) ?? "knife");
    const now = Date.now(), observed = now - sentAt;
    avatar.offset = avatar.offset === null ? observed : Math.min(observed, avatar.offset + (now - avatar.offsetAt) * 0.02);
    avatar.offsetAt = now;
    const samples = avatar.samples;
    if (!samples.length || sentAt > samples[samples.length - 1].time) samples.push({ time: sentAt, pose });
    while (samples.length > 2 && samples[0].time < sentAt - 1500) samples.shift();
    avatar.pose = pose;
  }

  // The moment of each live player's own timeline currently on screen, for lag compensation.
  seen(): Record<string, number> {
    const seen: Record<string, number> = {};
    for (const [peerId, avatar] of this.avatars) if (!this.dead.has(peerId) && avatar.samples.length) seen[peerId] = Math.round(avatar.displayTime);
    return seen;
  }

  flinch(peerId: string, damage: number): void {
    this.avatars.get(peerId)?.model?.flinch(Math.min(1, 0.35 + damage / 60));
  }

  private interpolated(avatar: RemoteAvatar): PlayerPose {
    const samples = avatar.samples;
    if (!samples.length) return avatar.pose;
    const time = avatar.displayTime;
    const last = samples[samples.length - 1];
    if (time >= last.time) {
      if (samples.length < 2) return last.pose;
      const previous = samples[samples.length - 2];
      const ahead = Math.min(time - last.time, EXTRAPOLATE_MS) / Math.max(1, last.time - previous.time);
      if (Math.hypot(last.pose.east - previous.pose.east, last.pose.north - previous.pose.north) > 4) return last.pose;
      return { ...last.pose, east: last.pose.east + (last.pose.east - previous.pose.east) * ahead, north: last.pose.north + (last.pose.north - previous.pose.north) * ahead };
    }
    for (let index = samples.length - 2; index >= 0; index -= 1) {
      const a = samples[index], b = samples[index + 1];
      if (a.time > time) continue;
      // Respawns and corrections teleport rather than glide.
      if (Math.hypot(b.pose.east - a.pose.east, b.pose.north - a.pose.north) > 4) return b.pose;
      const t = (time - a.time) / Math.max(1, b.time - a.time);
      return {
        ...a.pose,
        east: a.pose.east + (b.pose.east - a.pose.east) * t,
        north: a.pose.north + (b.pose.north - a.pose.north) * t,
        jumpHeight: a.pose.jumpHeight + (b.pose.jumpHeight - a.pose.jumpHeight) * t,
        heading: lerpHeading(a.pose.heading, b.pose.heading, t),
        pitch: a.pose.pitch + (b.pose.pitch - a.pose.pitch) * t,
        lean: (a.pose.lean ?? 0) + ((b.pose.lean ?? 0) - (a.pose.lean ?? 0)) * t,
      };
    }
    return samples[0].pose;
  }

  setWeapon(peerId: string, weapon: WeaponKind): void {
    this.equipped.set(peerId, weapon);
    const avatar = this.avatars.get(peerId);
    if (avatar) for (const [kind, model] of avatar.weapons) model.visible = kind === weapon;
  }

  setHealth(peerId: string, health: number): void {
    const avatar = this.avatars.get(peerId);
    const wasDead = this.dead.has(peerId);
    if (health <= 0) this.dead.add(peerId);
    else this.dead.delete(peerId);
    if (!avatar) return;
    // The character falls as a ragdoll (or plays its death clip without physics) and stays
    // down until respawn; the mannequin simply hides.
    avatar.root.visible = avatar.model !== null || health > 0;
    // A death waits for the character model if it has not attached yet (a peer that just
    // joined, or a tab that was in the background), so the body still falls when it appears.
    if (health <= 0 && !wasDead) {
      if (this.physics) avatar.dying = true;
      else avatar.model?.setDead(true);
    }
    if (health > 0 && wasDead) {
      avatar.dying = false;
      avatar.impulse = undefined;
      if (avatar.ragdoll) { avatar.ragdoll.remove(); avatar.ragdoll = null; }
      avatar.model?.unfreeze();
      avatar.model?.setDead(false);
    }
  }

  // The blow that killed a player, applied to the ragdoll when it is created.
  kill(peerId: string, part: string, vector: Vec3): void {
    const avatar = this.avatars.get(peerId);
    if (avatar) avatar.impulse = { part, vector };
  }

  // Smoothed feet positions and latest poses, for footsteps and other positioned sounds.
  each(visit: (peerId: string, feet: Vector3, pose: PlayerPose, dead: boolean) => void): void {
    for (const [peerId, avatar] of this.avatars) visit(peerId, avatar.root.position, avatar.pose, this.dead.has(peerId));
  }

  position(peerId: string): Vector3 | null {
    return this.avatars.get(peerId)?.root.position ?? null;
  }

  remove(peerId: string): void {
    const avatar = this.avatars.get(peerId);
    if (!avatar) return;
    avatar.ragdoll?.remove();
    this.scene.remove(avatar.root);
    if (avatar.model) { avatar.root.remove(avatar.model.root); avatar.model.dispose(); }
    avatar.root.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      object.geometry.dispose();
      if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
      else object.material.dispose();
    });
    this.avatars.delete(peerId);
    this.dead.delete(peerId);
    this.equipped.delete(peerId);
  }

  clear(): void {
    for (const peerId of this.avatars.keys()) this.remove(peerId);
    this.dead.clear();
    this.equipped.clear();
  }

  update(seconds: number): void {
    const delta = Math.min(seconds, 0.1);
    const blend = 1 - Math.exp(-delta * 12);
    for (const [peerId, avatar] of this.avatars) {
      const { root } = avatar;
      if (!avatar.model && this.models.ready()) this.attachModel(avatar, this.dead.has(peerId));
      if (avatar.ragdoll) { avatar.ragdoll.update(); continue; }
      if (avatar.dying && avatar.model && this.physics) {
        avatar.dying = false;
        try {
          avatar.model.freeze();
          avatar.ragdoll = new CharacterRagdoll(this.physics, avatar.model.root, { x: avatar.velocity.x, y: avatar.velocity.y, z: avatar.velocity.z }, avatar.impulse);
        } catch (error) {
          console.warn("Ragdoll unavailable; playing the death animation instead.", error);
          avatar.model.unfreeze();
          avatar.model.setDead(true);
        }
        continue;
      }
      avatar.displayTime = Date.now() - (avatar.offset ?? 0) - INTERP_DELAY_MS;
      const pose = this.interpolated(avatar);
      root.position.set(pose.east, terrainHeight(this.data, pose.east, pose.north) + pose.jumpHeight, pose.north);
      if (delta > 0) avatar.velocity.lerp(root.position.clone().sub(avatar.previous).divideScalar(delta), 0.3);
      if (avatar.velocity.length() > 15) avatar.velocity.setLength(0);
      avatar.previous.copy(root.position);
      avatar.heading = pose.heading;
      root.rotation.y = avatar.heading * Math.PI / 180;
      // Leaning rolls the whole body a little toward the character's right (local -x) and
      // bends the upper body the rest of the way, matching the shifted hit boxes.
      const lean = this.dead.has(peerId) ? 0 : pose.lean ?? 0;
      root.rotation.z = lean * 0.1;
      if (avatar.model) {
        avatar.model.setStance(pose.crouching ? "crouch" : pose.moving ? pose.running ? "run" : "walk" : "idle");
        avatar.model.setPitch(pose.pitch);
        avatar.model.setLean(lean);
        avatar.model.update(delta);
        continue;
      }
      root.scale.y += ((pose.crouching ? 0.72 : 1) - root.scale.y) * blend;
      avatar.head.rotation.x += ((-pose.pitch * Math.PI / 180 * 0.45) - avatar.head.rotation.x) * blend;
      if (pose.moving) avatar.stride += delta * (pose.running ? 13 : 8);
      const swing = pose.moving ? Math.sin(avatar.stride) * (pose.running ? 0.48 : 0.27) : 0;
      avatar.leftArm.rotation.x += (swing - avatar.leftArm.rotation.x) * blend;
      avatar.rightArm.rotation.x += (-swing - avatar.rightArm.rotation.x) * blend;
      avatar.leftLeg.rotation.x += (-swing - avatar.leftLeg.rotation.x) * blend;
      avatar.rightLeg.rotation.x += (swing - avatar.rightLeg.rotation.x) * blend;
    }
  }
}
