import { Matrix4, Quaternion, Vector3, type Camera } from "three/webgpu";
import { type WorldEntity } from "../world/entities";
import { FIST, HOOK, type Curl, type HandTarget } from "./handPose";

// Where two hands go on what a player is holding. The same places serve the holder's own view
// and everybody else's, so the hands are on the thing itself in both.

export interface Hold { right: HandTarget; left: HandTarget; curl: Curl }
export interface HeldThing { id: string; prop: string; shape: NonNullable<WorldEntity["shape"]>; position: { x: number; y: number; z: number }; rotation: { x: number; y: number; z: number; w: number } }

// Held in front of you, these fill the view and your hands are round the far side of them or out
// past the edge of what you can see, so the holder sees just the thing.
const NO_HANDS_IN_VIEW = new Set(["crate_wood_large", "trash_can", "oil_drum", "fuel_drum", "aircon_unit", "dining_table", "cafe_table"]);
export const handsOutOfView = (prop: string): boolean => NO_HANDS_IN_VIEW.has(prop);

// People carry a box, a crate or a piece of furniture from underneath: hands under the bottom
// corners nearest them, or under a seat or a table top, palms up and fingers curled in under it,
// so from their own eyes the fingers are out of sight below it. Where under it the hands go: how
// high, as a share of the half height above the middle (-1 the bottom), and how far in from the
// outer side and from the near side.
interface Under { share: number; inset: number; near: number }
// The seats are round and narrower than the legs splayed under them, so hands go well in from
// the corners of the space the chair or stool takes up.
const UNDER: Record<string, Under> = {
  dining_chair: { share: 0.02, inset: 0.03, near: 0.14 },
  plastic_stool: { share: 0.8, inset: 0.07, near: 0.17 },
  bar_stool: { share: 0.79, inset: 0.03, near: 0.14 },
  dining_table: { share: 0.91, inset: 0.05, near: 0.1 },
  cafe_table: { share: 0.84, inset: 0.05, near: 0.1 },
};
const UNDER_A_BOX: Under = { share: -1, inset: 0.05, near: 0.1 };
// Hands sit just off the surface.
const OFF_SURFACE = 0.012;
// A round thing is held round its sides, low down, to the near side of its widest point.
const LOWER_EDGE = -0.55;
// Round things are held to the near side of their widest point.
const ROUND_ACROSS = 0.82;
const ROUND_NEAR = 0.57;

export function propHold(held: HeldThing, right: Vector3, forward: Vector3): Hold {
  const { shape, prop } = held;
  const at = new Vector3(held.position.x, held.position.y, held.position.z);
  const turn = new Quaternion(held.rotation.x, held.rotation.y, held.rotation.z, held.rotation.w);
  const up = new Vector3(0, 1, 0).applyQuaternion(turn);
  const hand = (side: 1 | -1): HandTarget => {
    if (shape.type !== "box") {
      const radial = right.clone().multiplyScalar(side * ROUND_ACROSS).addScaledVector(forward, -ROUND_NEAR).normalize();
      const grip = at.clone().addScaledVector(radial, shape.radius + OFF_SURFACE).addScaledVector(up, shape.halfHeight * LOWER_EDGE);
      return { grip, fingers: forward.clone().multiplyScalar(0.7).addScaledVector(up, -0.6), palm: radial.clone().negate() };
    }
    const x = new Vector3(1, 0, 0).applyQuaternion(turn), z = new Vector3(0, 0, 1).applyQuaternion(turn);
    const sideways = Math.abs(x.dot(right)) >= Math.abs(z.dot(right));
    const across = sideways ? x : z, along = sideways ? z : x;
    const halfAcross = sideways ? shape.half[0] : shape.half[2], halfAlong = sideways ? shape.half[2] : shape.half[0];
    const outward = across.clone().multiplyScalar(Math.sign(across.dot(right)) * side);
    const near = along.clone().multiplyScalar(-Math.sign(along.dot(forward)));
    const under = UNDER[prop] ?? UNDER_A_BOX;
    const grip = at.clone().addScaledVector(outward, Math.max(0, halfAcross - under.inset)).addScaledVector(near, Math.max(0, halfAlong - under.near)).addScaledVector(up, shape.half[1] * under.share - OFF_SURFACE);
    return { grip, fingers: outward.clone().multiplyScalar(-0.75).addScaledVector(near, -0.55), palm: up.clone().multiplyScalar(0.85).addScaledVector(outward, -0.5) };
  };
  return { right: hand(1), left: hand(-1), curl: HOOK };
}

// The extinguisher (extinguisher_held in the kit), whose origin is in the carrying handle: the
// right hand closes over the handle and lever with the can hanging from it, and the left holds
// the end of the hose as you would a torch, the palm against its side and the thumb on top.
const TOOL_RIGHT = { grip: new Vector3(0, 0, 0), fingers: new Vector3(0, -0.7, -0.7), palm: new Vector3(-1, 0, 0) };
const TOOL_LEFT = { grip: new Vector3(-0.295, -0.14, -0.247), fingers: new Vector3(0.7, 0, -0.7), palm: new Vector3(0.7, 0, 0.7) };
export function toolHold(world: Matrix4): Hold {
  const place = (hand: typeof TOOL_RIGHT): HandTarget => ({ grip: hand.grip.clone().applyMatrix4(world), fingers: hand.fingers.clone().transformDirection(world), palm: hand.palm.clone().transformDirection(world) });
  return { right: place(TOOL_RIGHT), left: place(TOOL_LEFT), curl: FIST };
}

// A hold in the world, as seen from the camera.
export function inCameraFrame(hold: Hold, camera: Camera): Hold {
  const place = (hand: HandTarget): HandTarget => ({ grip: hand.grip.clone().applyMatrix4(camera.matrixWorldInverse), fingers: hand.fingers.clone().transformDirection(camera.matrixWorldInverse), palm: hand.palm.clone().transformDirection(camera.matrixWorldInverse) });
  return { right: place(hold.right), left: place(hold.left), curl: hold.curl };
}
