import { Object3D, Quaternion, Vector3 } from "three/webgpu";
import { type MapToggle } from "./arena";
import { type Material } from "./materials";
import { type Vec3, type WorldEntity } from "./entities";
import { kitObject, type KitPiece } from "./kit";
import { SHOP_ROOMS } from "./shops";

// The market's doors: the restaurant's and the bar's double doors, the French doors onto the
// bar's balcony, and the front and back doors of the record shop and the shops beside it. Each
// leaf is a real body on a hinge (physics.ts) that opens inward: a shut door is latched, E swings
// it, a kick or a blast bursts it open, and an open one can be pushed and is stopped by whatever
// stands in its way, so furniture piled behind a door holds it. Rounds pass through a leaf and
// wear it down; enough of them, or a grenade, blows it off its hinges.
//
// Everything here is plain data shared by every client, except the view at the bottom.

type Face = "px" | "nx" | "pz" | "nz";
const FACE_YAW: Record<Face, number> = { px: Math.PI / 2, nx: -Math.PI / 2, pz: 0, nz: Math.PI };
// How far an open leaf turns, in radians.
const OPEN = 1.62;

// Masses are real ones: an aluminium shop door with its glass, a solid panelled door, a glazed
// French door and a steel back door. All are too heavy to lift off their hinges.
interface LeafModel { piece: string; width: number; height: number; material: Material; health: number; mass: number }
const MODELS: Record<string, LeafModel> = {
  glass: { piece: "door_glass", width: 0.79, height: 2.58, material: "wood", health: 100, mass: 40 },
  panel: { piece: "door_panel", width: 0.79, height: 2.58, material: "wood", health: 100, mass: 32 },
  french: { piece: "door_french", width: 0.79, height: 2.38, material: "wood", health: 100, mass: 27 },
  steel: { piece: "door_steel", width: 0.98, height: 2.12, material: "metal-thin", health: 60, mass: 45 },
};

// A doorway: the bottom centre of its opening in the middle of the wall, the way the wall
// faces, its leaves and whether it starts open.
interface Doorway { id: string; label: string; at: Vec3; face: Face; model: keyof typeof MODELS; leaves: 1 | 2; open: boolean; tint?: number }
export const DOORWAYS: Doorway[] = [
  { id: "door:restaurant-south", label: "the restaurant door", at: { x: -8.65, y: 0, z: -3.6 }, face: "px", model: "glass", leaves: 2, open: false },
  { id: "door:restaurant-north", label: "the restaurant door", at: { x: -8.65, y: 0, z: 11.6 }, face: "px", model: "glass", leaves: 2, open: true },
  { id: "door:bar-south", label: "the bar door", at: { x: 17.15, y: 0, z: -0.4 }, face: "nx", model: "panel", leaves: 2, open: true },
  { id: "door:bar-north", label: "the bar door", at: { x: 17.15, y: 0, z: 7.4 }, face: "nx", model: "panel", leaves: 2, open: false },
  { id: "door:balcony", label: "the balcony door", at: { x: 17.15, y: 4.2, z: 5.8 }, face: "nx", model: "french", leaves: 2, open: true },
  { id: "door:records-front", label: "the record shop door", at: { x: 0.65, y: 0, z: -9.9 }, face: "nx", model: "glass", leaves: 2, open: false },
  { id: "door:records-back", label: "the back door", at: { x: 8.35, y: 0, z: -8.1 }, face: "px", model: "steel", leaves: 1, open: false, tint: 0x3d5a4c },
  ...SHOP_ROOMS.flatMap((room): Doorway[] => [
    { id: `door:${room.id}-front`, label: `the ${room.label} door`, at: { x: 0.65, y: 0, z: (room.door[0] + room.door[1]) / 2 }, face: "nx", model: "glass", leaves: 2, open: room.doorOpen },
    ...("door" in room.back ? [{ id: `door:${room.id}-back`, label: "the back door", at: { x: 8.35, y: 0, z: room.back.door }, face: "px" as Face, model: "steel" as const, leaves: 1 as const, open: false, tint: room.back.paint }] : []),
  ]),
];

export const DOOR_TOGGLES: MapToggle[] = DOORWAYS.map((door) => ({ id: door.id, label: door.label, at: { x: door.at.x, y: door.at.y + 1.3, z: door.at.z }, open: door.open }));

// One leaf: where its hinge is, which way it faces when shut (a right-hand leaf is the
// left-hand one turned round) and which way it turns to open inward.
export interface DoorLeaf { id: string; door: Doorway; model: LeafModel; hinge: Vec3; yaw: number; turn: 1 | -1; half: [number, number, number] }

export const DOOR_LEAVES: DoorLeaf[] = DOORWAYS.flatMap((door) => {
  const model = MODELS[door.model], yaw = FACE_YAW[door.face];
  const along = { x: Math.cos(yaw), z: -Math.sin(yaw) }, span = model.width * door.leaves + 0.01;
  const leaf = (side: "l" | "r", offset: number, turned: boolean): DoorLeaf => ({
    id: `${door.id}:${side}`, door, model, yaw: yaw + (turned ? Math.PI : 0), turn: turned ? -1 : 1,
    hinge: { x: door.at.x + along.x * offset, y: door.at.y, z: door.at.z + along.z * offset },
    // A touch wider than the leaf, so a pair meets with no gap for a round or a blade.
    half: [model.width / 2 + 0.008, model.height / 2, 0.025],
  });
  return door.leaves === 2 ? [leaf("l", -span / 2, false), leaf("r", span / 2, true)] : [leaf("l", -span / 2, false)];
});

// Where a leaf's collider sits when its doorway is open by a share (0 shut, 1 open).
export function leafPose(leaf: DoorLeaf, open: number): { center: Vec3; rotation: Quaternion } {
  const rotation = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), leaf.yaw + leaf.turn * OPEN * open);
  const offset = new Vector3(leaf.model.width / 2, leaf.half[1], 0).applyQuaternion(rotation);
  return { center: { x: leaf.hinge.x + offset.x, y: leaf.hinge.y + offset.y, z: leaf.hinge.z + offset.z }, rotation };
}

// Each leaf is an entity with a body of its own, hung on its hinge, starting shut or open as its
// doorway does.
export const DOOR_ENTITIES: WorldEntity[] = DOOR_LEAVES.map((leaf) => {
  const open = leaf.door.open ? 1 : 0;
  return {
    id: leaf.id, kind: "door", material: leaf.model.material, maxHealth: leaf.model.health, mass: leaf.model.mass,
    yaw: leaf.yaw + leaf.turn * OPEN * open, center: leafPose(leaf, open).center, shape: { type: "box", half: leaf.half },
    hinge: { at: leaf.hinge, shutYaw: leaf.yaw, swing: leaf.turn * OPEN, offset: [leaf.model.width / 2, leaf.half[1], 0] },
  };
});

// The doorway a leaf belongs to.
export function doorOf(entity: string): string | null {
  return DOOR_LEAVES.find((leaf) => leaf.id === entity)?.door.id ?? null;
}

// ---------- the view ----------

// Each leaf is drawn where its body is.
export class Doors {
  readonly groups = new Map<string, Object3D[]>();
  private leaves = new Map<string, { leaf: DoorLeaf; pivot: Object3D }>();
  private offset = new Vector3();

  constructor(parent: Object3D, pieces: Map<string, KitPiece>) {
    for (const leaf of DOOR_LEAVES) {
      const pivot = new Object3D();
      pivot.position.set(leaf.hinge.x, leaf.hinge.y, leaf.hinge.z);
      pivot.rotation.y = leaf.yaw + (leaf.door.open ? leaf.turn * OPEN : 0);
      pivot.add(kitObject(pieces.get(leaf.model.piece), leaf.door.tint));
      parent.add(pivot);
      this.leaves.set(leaf.id, { leaf, pivot });
      this.groups.set(leaf.id, [pivot]);
    }
  }

  // The leaf's body has its centre here, turned so; the model hangs from the hinge edge.
  place(id: string, center: Vec3, rotation: { x: number; y: number; z: number; w: number }): void {
    const entry = this.leaves.get(id);
    if (!entry) return;
    const { leaf, pivot } = entry;
    pivot.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    this.offset.set(leaf.model.width / 2, leaf.half[1], 0).applyQuaternion(pivot.quaternion);
    pivot.position.set(center.x - this.offset.x, center.y - this.offset.y, center.z - this.offset.z);
  }
}
