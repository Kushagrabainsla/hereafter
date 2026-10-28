import {
  BoxGeometry, CapsuleGeometry, Color, CylinderGeometry, Group, Mesh, MeshStandardMaterial,
  Scene, SphereGeometry,
} from "three/webgpu";
import { terrainHeight, type ArenaData } from "../world/arena";
import { type PlayerPose } from "./playerController";

interface RemoteAvatar {
  root: Group;
  head: Group;
  leftArm: Group;
  rightArm: Group;
  leftLeg: Group;
  rightLeg: Group;
  pose: PlayerPose;
  heading: number;
  stride: number;
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
  const hue = [...peerId].reduce((value, character) => value + character.charCodeAt(0), 0) % 360 / 360;
  const jacket = new MeshStandardMaterial({ color: new Color().setHSL(hue, 0.31, 0.3), roughness: 0.9 });
  const dark = new MeshStandardMaterial({ color: 0x253038, roughness: 0.9 });
  const trim = new MeshStandardMaterial({ color: 0x9ec6bf, roughness: 0.68, metalness: 0.2 });
  const skin = new MeshStandardMaterial({ color: 0xb58c72, roughness: 0.95 });
  addPart(root, new CapsuleGeometry(0.23, 0.48, 5, 10), jacket, 0, 1.13, 0);
  addPart(root, new BoxGeometry(0.42, 0.13, 0.07), trim, 0, 1.26, 0.21);
  addPart(root, new CylinderGeometry(0.16, 0.18, 0.2, 8), dark, 0, 0.73, 0);

  const head = new Group();
  head.position.set(0, 1.64, 0);
  addPart(head, new SphereGeometry(0.19, 12, 10), skin, 0, 0, 0);
  addPart(head, new BoxGeometry(0.3, 0.07, 0.04), dark, 0, 0.025, 0.18);
  addPart(head, new CapsuleGeometry(0.205, 0.015, 3, 10), dark, 0, 0.17, -0.005);
  root.add(head);

  const leftArm = new Group();
  const rightArm = new Group();
  for (const [arm, side] of [[leftArm, -1], [rightArm, 1]] as const) {
    arm.position.set(side * 0.3, 1.35, 0);
    addPart(arm, new CylinderGeometry(0.09, 0.075, 0.62, 8), jacket, side * 0.02, -0.32, 0);
    addPart(arm, new SphereGeometry(0.09, 8, 7), dark, side * 0.02, -0.65, 0);
    root.add(arm);
  }

  const leftLeg = new Group();
  const rightLeg = new Group();
  for (const [leg, side] of [[leftLeg, -1], [rightLeg, 1]] as const) {
    leg.position.set(side * 0.135, 0.73, 0);
    addPart(leg, new CylinderGeometry(0.105, 0.095, 0.63, 8), dark, 0, -0.32, 0);
    addPart(leg, new BoxGeometry(0.2, 0.13, 0.31), dark, 0, -0.66, 0.07);
    root.add(leg);
  }

  return { root, head, leftArm, rightArm, leftLeg, rightLeg, pose: {
    east: 0, north: 0, heading: 0, pitch: 0, jumpHeight: 0,
    moving: false, running: false, crouching: false,
  }, heading: 0, stride: 0 };
}

export class RemotePlayers {
  private avatars = new Map<string, RemoteAvatar>();

  constructor(private scene: Scene, private data: ArenaData) {}

  setPose(peerId: string, pose: PlayerPose): void {
    let avatar = this.avatars.get(peerId);
    if (!avatar) {
      avatar = createAvatar(peerId);
      avatar.root.position.set(pose.east, terrainHeight(this.data, pose.east, pose.north) + pose.jumpHeight, pose.north);
      avatar.heading = pose.heading;
      this.avatars.set(peerId, avatar);
      this.scene.add(avatar.root);
    }
    avatar.pose = pose;
  }

  remove(peerId: string): void {
    const avatar = this.avatars.get(peerId);
    if (!avatar) return;
    this.scene.remove(avatar.root);
    avatar.root.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      object.geometry.dispose();
      if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
      else object.material.dispose();
    });
    this.avatars.delete(peerId);
  }

  clear(): void {
    for (const peerId of this.avatars.keys()) this.remove(peerId);
  }

  update(seconds: number): void {
    const delta = Math.min(seconds, 0.1);
    const blend = 1 - Math.exp(-delta * 12);
    for (const avatar of this.avatars.values()) {
      const { pose, root } = avatar;
      root.position.x += (pose.east - root.position.x) * blend;
      root.position.z += (pose.north - root.position.z) * blend;
      const ground = terrainHeight(this.data, root.position.x, root.position.z) + pose.jumpHeight;
      root.position.y += (ground - root.position.y) * blend;
      const difference = ((pose.heading - avatar.heading + 540) % 360) - 180;
      avatar.heading = (avatar.heading + difference * blend + 360) % 360;
      root.rotation.y = avatar.heading * Math.PI / 180;
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
