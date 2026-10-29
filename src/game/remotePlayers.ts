import {
  BoxGeometry, CapsuleGeometry, Color, CylinderGeometry, Group, Mesh, MeshStandardMaterial,
  Scene, SphereGeometry, Vector3,
} from "three/webgpu";
import { terrainHeight, type ArenaData } from "../world/arena";
import { type PlayerPose } from "./playerController";
import { type WeaponKind } from "./combatRules";
import { makeWeapon } from "./weaponVisuals";
import { PlayerModelLibrary, type PlayerModelInstance } from "./playerModel";

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
  }, heading: 0, stride: 0, weapons };
}

export class RemotePlayers {
  private avatars = new Map<string, RemoteAvatar>();
  private dead = new Set<string>();
  private equipped = new Map<string, WeaponKind>();

  constructor(private scene: Scene, private data: ArenaData, private models: PlayerModelLibrary) {}

  // Swap a mannequin for the shared character once the model has loaded.
  private attachModel(avatar: RemoteAvatar): void {
    const model = this.models.instantiate(avatar.tint);
    if (!model) return;
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
  }

  setPose(peerId: string, pose: PlayerPose): void {
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
    avatar.pose = pose;
  }

  setWeapon(peerId: string, weapon: WeaponKind): void {
    this.equipped.set(peerId, weapon);
    const avatar = this.avatars.get(peerId);
    if (avatar) for (const [kind, model] of avatar.weapons) model.visible = kind === weapon;
  }

  setHealth(peerId: string, health: number): void {
    if (health <= 0) this.dead.add(peerId);
    else this.dead.delete(peerId);
    const avatar = this.avatars.get(peerId);
    if (!avatar) return;
    // The character plays its death clip and stays down; the mannequin simply hides.
    avatar.root.visible = avatar.model !== null || health > 0;
    avatar.model?.setDead(health <= 0);
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
    for (const avatar of this.avatars.values()) {
      const { pose, root } = avatar;
      if (!avatar.model && this.models.ready()) this.attachModel(avatar);
      root.position.x += (pose.east - root.position.x) * blend;
      root.position.z += (pose.north - root.position.z) * blend;
      const ground = terrainHeight(this.data, root.position.x, root.position.z) + pose.jumpHeight;
      root.position.y += (ground - root.position.y) * blend;
      const difference = ((pose.heading - avatar.heading + 540) % 360) - 180;
      avatar.heading = (avatar.heading + difference * blend + 360) % 360;
      root.rotation.y = avatar.heading * Math.PI / 180;
      if (avatar.model) {
        avatar.model.setStance(pose.crouching ? "crouch" : pose.moving ? pose.running ? "run" : "walk" : "idle");
        avatar.model.setPitch(pose.pitch);
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
