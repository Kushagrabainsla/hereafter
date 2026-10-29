import { Matrix4, Object3D, Quaternion, SkinnedMesh, Vector3 } from "three/webgpu";
import { type PhysicsWorld, type Ragdoll, type RagdollJoint, type RagdollPart, type Vec3 } from "../world/physics";

// Rocketbox Biped bones driven by ragdoll parts, parents before children.
const DRIVEN: [string, string][] = [
  ["pelvis", "Bip01 Pelvis"], ["chest", "Bip01 Spine1"], ["head", "Bip01 Head"],
  ["upperArmL", "Bip01 L UpperArm"], ["forearmL", "Bip01 L Forearm"], ["upperArmR", "Bip01 R UpperArm"], ["forearmR", "Bip01 R Forearm"],
  ["thighL", "Bip01 L Thigh"], ["calfL", "Bip01 L Calf"], ["thighR", "Bip01 R Thigh"], ["calfR", "Bip01 R Calf"],
];
const UP = new Vector3(0, 1, 0);
const ONE = new Vector3(1, 1, 1);

// A character falling as linked physical bodies from its current animated pose. Joints
// follow the body: hips, shoulders, spine and neck swing freely; knees and elbows hinge
// about the character's left-right axis and only bend the natural way.
export class CharacterRagdoll {
  private ragdoll: Ragdoll;
  private driven: { bone: Object3D; part: string; offset: Matrix4 }[] = [];
  private body = new Matrix4();
  private world = new Matrix4();
  private inverse = new Matrix4();
  private position = new Vector3();
  private quaternion = new Quaternion();

  constructor(physics: PhysicsWorld, private root: Object3D, velocity: Vec3, impulse?: { part: string; vector: Vec3 }) {
    root.updateMatrixWorld(true);
    // GLTFLoader replaces spaces in node names with underscores.
    const bone = (name: string): Object3D => {
      const found = root.getObjectByName(name.replace(/\s+/g, "_")) ?? root.getObjectByName(name);
      if (!found) throw new Error(`Ragdoll bone ${name} missing`);
      return found;
    };
    const at = (name: string): Vector3 => bone(name).getWorldPosition(new Vector3());
    const frame = root.getWorldQuaternion(new Quaternion());
    const toLocal = frame.clone().invert();
    const parts: RagdollPart[] = [];
    const capsule = (name: string, from: Vector3, to: Vector3, radius: number): void => {
      const direction = to.clone().sub(from);
      const length = direction.length();
      const rotation = new Quaternion().setFromUnitVectors(UP, direction.normalize().applyQuaternion(toLocal));
      parts.push({ name, position: from.clone().add(to).multiplyScalar(0.5), rotation: frame, shape: { type: "capsule", halfHeight: Math.max(0.02, length / 2 - radius), radius, rotation } });
    };
    const ball = (name: string, center: Vector3, radius: number): void => { parts.push({ name, position: center, rotation: frame, shape: { type: "ball", radius } }); };
    const extend = (from: Vector3, to: Vector3, extra: number): Vector3 => to.clone().add(to.clone().sub(from).normalize().multiplyScalar(extra));
    ball("pelvis", at("Bip01 Pelvis"), 0.13);
    capsule("chest", at("Bip01 Spine1"), at("Bip01 Neck"), 0.15);
    ball("head", extend(at("Bip01 Neck"), at("Bip01 Head"), 0.08), 0.11);
    for (const side of ["L", "R"]) {
      capsule(`upperArm${side}`, at(`Bip01 ${side} UpperArm`), at(`Bip01 ${side} Forearm`), 0.05);
      capsule(`forearm${side}`, at(`Bip01 ${side} Forearm`), extend(at(`Bip01 ${side} Forearm`), at(`Bip01 ${side} Hand`), 0.08), 0.045);
      capsule(`thigh${side}`, at(`Bip01 ${side} Thigh`), at(`Bip01 ${side} Calf`), 0.075);
      capsule(`calf${side}`, at(`Bip01 ${side} Calf`), at(`Bip01 ${side} Foot`), 0.06);
    }
    // In the shared starting frame, local +x is the character's left; flexing a knee turns
    // the calf backward (positive about +x) and an elbow brings the forearm forward (negative).
    const left = { x: 1, y: 0, z: 0 };
    const joints: RagdollJoint[] = [
      { a: "pelvis", b: "chest", anchor: at("Bip01 Spine1") },
      { a: "chest", b: "head", anchor: at("Bip01 Head") },
    ];
    for (const side of ["L", "R"]) {
      joints.push({ a: "chest", b: `upperArm${side}`, anchor: at(`Bip01 ${side} UpperArm`) });
      joints.push({ a: `upperArm${side}`, b: `forearm${side}`, anchor: at(`Bip01 ${side} Forearm`), hinge: { axis: left, limits: [-2.4, 0.3] } });
      joints.push({ a: "pelvis", b: `thigh${side}`, anchor: at(`Bip01 ${side} Thigh`) });
      joints.push({ a: `thigh${side}`, b: `calf${side}`, anchor: at(`Bip01 ${side} Calf`), hinge: { axis: left, limits: [-0.3, 2.4] } });
    }
    this.ragdoll = physics.createRagdoll(parts, joints, velocity, impulse);
    // Each driven bone keeps its offset from its part, so the mesh follows the bodies.
    for (const [part, name] of DRIVEN) {
      const target = parts.find((item) => item.name === part)!;
      const bodyMatrix = new Matrix4().compose(new Vector3(target.position.x, target.position.y, target.position.z), frame, ONE);
      this.driven.push({ bone: bone(name), part, offset: bodyMatrix.invert().multiply(bone(name).matrixWorld.clone()) });
    }
    root.traverse((object) => { if (object instanceof SkinnedMesh) object.frustumCulled = false; });
  }

  update(): void {
    for (const { bone, part, offset } of this.driven) {
      const pose = this.ragdoll.pose(part);
      if (!pose || !bone.parent) continue;
      this.body.compose(this.position.set(pose.position.x, pose.position.y, pose.position.z), this.quaternion.set(pose.rotation.x, pose.rotation.y, pose.rotation.z, pose.rotation.w), ONE);
      this.world.multiplyMatrices(this.body, offset);
      bone.parent.updateWorldMatrix(true, false);
      this.inverse.copy(bone.parent.matrixWorld).invert();
      bone.matrix.multiplyMatrices(this.inverse, this.world);
      bone.matrix.decompose(bone.position, bone.quaternion, bone.scale);
    }
  }

  remove(): void {
    this.ragdoll.remove();
    this.root.traverse((object) => { if (object instanceof SkinnedMesh) object.frustumCulled = true; });
  }
}
