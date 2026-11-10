import { Matrix4, Quaternion, Vector3, type Object3D } from "three/webgpu";

// Puts a hand where it belongs on something: the arm reaches there, the hand turns to meet it and
// the fingers close. The first-person arms and the other players' character have different bones
// under the same names, so everything is worked out from where the wrist and knuckles sit in the
// bind pose and neither skeleton's bone axes are assumed.

export type Side = "R" | "L";
// Bend at each finger's three joints in degrees, thumb first.
export type Curl = readonly (readonly [number, number, number])[];
// Where the palm goes, the way the fingers run from it, and the way the palm faces.
export interface HandTarget { grip: Vector3; fingers: Vector3; palm: Vector3 }

// Fingers hooked under an edge, with the thumb lying along it.
export const HOOK: Curl = [[12, 22, 18], [28, 42, 24], [30, 46, 26], [32, 48, 28], [34, 50, 28]];
// Closed around a handle or a hose.
export const FIST: Curl = [[22, 35, 30], [62, 80, 55], [66, 84, 58], [68, 86, 60], [72, 88, 62]];
// On a pistol grip with the finger along the trigger.
export const TRIGGER: Curl = [[20, 32, 24], [18, 30, 22], [58, 72, 48], [64, 78, 52], [70, 82, 56]];
// Under a handguard, or cupped around the other hand.
export const SUPPORT: Curl = [[18, 30, 24], [48, 66, 42], [52, 70, 46], [56, 74, 48], [60, 78, 50]];

// From the middle of the palm back to the wrist, and how far the wrist sits off the surface held.
const PALM_TO_WRIST = 0.06;
const PALM_THICKNESS = 0.02;

interface Joint { bone: Object3D; rest: Quaternion; axis: Vector3 }
interface Arm {
  upper: Object3D; fore: Object3D; hand: Object3D;
  twist: Object3D | null; twistRest: Quaternion;
  handRest: Quaternion;
  // The hand bone's turn relative to the frame made by the fingers and the palm.
  offset: Quaternion;
  fingers: Joint[][];
}

const toY = new Vector3();
const basisMatrix = new Matrix4();
function frame(fingers: Vector3, palm: Vector3, out: Quaternion): Quaternion {
  const y = fingers.clone().normalize();
  const z = palm.clone().addScaledVector(y, -palm.dot(y)).normalize();
  toY.crossVectors(y, z);
  return out.setFromRotationMatrix(basisMatrix.makeBasis(toY, y, z));
}

export class HandRig {
  private arms = new Map<Side, Arm>();

  // The root must be in its bind pose, before any animation has moved it.
  constructor(root: Object3D) {
    const bone = (name: string): Object3D | null => root.getObjectByName(name.replace(/\s+/g, "_")) ?? root.getObjectByName(name) ?? null;
    root.updateMatrixWorld(true);
    for (const side of ["R", "L"] as const) {
      const upper = bone(`Bip01 ${side} UpperArm`), fore = bone(`Bip01 ${side} Forearm`), hand = bone(`Bip01 ${side} Hand`);
      if (!upper || !fore || !hand) continue;
      const chains = [0, 1, 2, 3, 4].map((finger) => ["", "1", "2"].map((joint) => bone(`Bip01 ${side} Finger${finger}${joint}`)));
      if (chains.some((chain) => chain.some((link) => !link))) continue;
      const where = (object: Object3D): Vector3 => object.getWorldPosition(new Vector3());
      const wrist = where(hand), index = where(chains[1][0]!), pinky = where(chains[4][0]!);
      const along = index.clone().add(pinky).multiplyScalar(0.5).sub(wrist).normalize();
      const across = index.clone().sub(pinky).normalize();
      // Toward the thumb and along the fingers, the palm faces the way they cross: opposite ways
      // on the two hands.
      const palm = side === "R" ? new Vector3().crossVectors(across, along) : new Vector3().crossVectors(along, across);
      palm.addScaledVector(along, -palm.dot(along)).normalize();
      const offset = frame(along, palm, new Quaternion()).invert().multiply(hand.getWorldQuaternion(new Quaternion()));
      const fingers = chains.map((chain) => chain.map((link, joint) => {
        const object = link!;
        const next = joint < 2 ? where(chain[joint + 1]!) : where(object).multiplyScalar(2).sub(where(chain[joint - 1]!));
        const direction = next.sub(where(object)).normalize();
        // Turning a finger about this axis brings it in toward the palm.
        const axis = new Vector3().crossVectors(direction, palm).normalize().applyQuaternion(object.getWorldQuaternion(new Quaternion()).invert());
        return { bone: object, rest: object.quaternion.clone(), axis };
      }));
      const twist = bone(`Bip01 ${side} Forearm Twist`);
      this.arms.set(side, { upper, fore, hand, twist, twistRest: twist?.quaternion.clone() ?? new Quaternion(), handRest: hand.quaternion.clone(), offset, fingers });
    }
  }

  // Reaches the wrist to the target with the elbow bent toward the pole, and turns the hand to it.
  // The weight takes it part of the way from wherever the animation put the hand.
  reach(side: Side, target: HandTarget, pole: Vector3, weight: number): void {
    const arm = this.arms.get(side);
    if (!arm || weight <= 0) return;
    const fingers = target.fingers.clone().normalize(), palm = target.palm.clone().normalize();
    const shoulder = arm.upper.getWorldPosition(new Vector3());
    const elbowNow = arm.fore.getWorldPosition(new Vector3());
    const wristNow = arm.hand.getWorldPosition(new Vector3());
    const wrist = target.grip.clone().addScaledVector(fingers, -PALM_TO_WRIST).addScaledVector(palm, -PALM_THICKNESS);
    wrist.lerp(wristNow, 1 - weight);
    const upperLength = shoulder.distanceTo(elbowNow), foreLength = elbowNow.distanceTo(wristNow);
    const toWrist = wrist.sub(shoulder);
    const length = Math.min(Math.max(toWrist.length(), 0.05), upperLength + foreLength - 0.001);
    const along = toWrist.normalize();
    const bend = pole.clone().addScaledVector(along, -pole.dot(along)).normalize();
    const cosine = (upperLength ** 2 + length ** 2 - foreLength ** 2) / (2 * upperLength * length);
    const elbow = shoulder.clone().addScaledVector(along, upperLength * cosine).addScaledVector(bend, upperLength * Math.sqrt(Math.max(0, 1 - cosine * cosine)));
    this.point(arm.upper, elbowNow, elbow);
    this.point(arm.fore, arm.hand.getWorldPosition(new Vector3()), shoulder.addScaledVector(along, length));
    this.turn(arm, fingers, palm, weight);
  }

  // Turns the hand alone, for an arm already placed.
  turnHand(side: Side, fingers: Vector3, palm: Vector3, weight = 1): void {
    const arm = this.arms.get(side);
    if (arm) this.turn(arm, fingers, palm, weight);
  }

  // Closes the fingers, in place of whatever the animation had them doing.
  curl(side: Side, curl: Curl, weight = 1): void {
    const arm = this.arms.get(side);
    if (!arm || weight <= 0) return;
    const bend = new Quaternion(), wanted = new Quaternion();
    arm.fingers.forEach((chain, finger) => chain.forEach((joint, index) => {
      bend.setFromAxisAngle(joint.axis, curl[finger][index] * Math.PI / 180);
      joint.bone.quaternion.slerp(wanted.copy(joint.rest).multiply(bend), weight);
    }));
    arm.hand.updateMatrixWorld(true);
  }

  private turn(arm: Arm, fingers: Vector3, palm: Vector3, weight: number): void {
    const wanted = frame(fingers, palm, new Quaternion()).multiply(arm.offset);
    const parent = arm.hand.parent!.getWorldQuaternion(new Quaternion()).invert();
    arm.hand.quaternion.slerp(parent.multiply(wanted), weight);
    if (arm.twist) {
      // How far the hand has turned about its own length goes up the forearm, as it does in the
      // baked clips, or the wrist would wring.
      const pose = arm.handRest.clone().invert().multiply(arm.hand.quaternion);
      const half = Math.atan2(pose.y, pose.w);
      arm.twist.quaternion.copy(arm.twistRest).multiply(new Quaternion(0, Math.sin(half), 0, Math.cos(half)));
    }
    arm.fore.updateMatrixWorld(true);
  }

  private point(bone: Object3D, childNow: Vector3, childWanted: Vector3): void {
    const origin = bone.getWorldPosition(new Vector3());
    const from = childNow.clone().sub(origin).normalize(), to = childWanted.clone().sub(origin).normalize();
    const world = bone.getWorldQuaternion(new Quaternion()).premultiply(new Quaternion().setFromUnitVectors(from, to));
    bone.quaternion.copy(bone.parent!.getWorldQuaternion(new Quaternion()).invert().multiply(world));
    bone.updateMatrixWorld(true);
  }
}
