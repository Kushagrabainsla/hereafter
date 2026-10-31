import { Object3D, Quaternion, Vector3 } from "three/webgpu";
import { type MapToggle } from "./arena";
import { type Material } from "./materials";
import { type Vec3, type WorldEntity } from "./entities";
import { kitObject, type KitPiece } from "./kit";

// The market's doors: the restaurant's and the bar's double doors, the French doors onto the
// bar's balcony, and the record shop's front and back doors. Each opens inward, all its
// leaves together, when a player presses E at it or kicks it with the knife. Rounds pass
// through a leaf and wear it down; enough of them, or a grenade, blows it off its hinges.
//
// Everything here is plain data shared by every client, except the view at the bottom.

type Face = "px" | "nx" | "pz" | "nz";
const FACE_YAW: Record<Face, number> = { px: Math.PI / 2, nx: -Math.PI / 2, pz: 0, nz: Math.PI };
// How far an open leaf turns, in radians.
const OPEN = 1.62;

interface LeafModel { piece: string; width: number; height: number; material: Material; health: number }
const MODELS: Record<string, LeafModel> = {
  glass: { piece: "door_glass", width: 0.79, height: 2.58, material: "wood", health: 100 },
  panel: { piece: "door_panel", width: 0.79, height: 2.58, material: "wood", health: 100 },
  french: { piece: "door_french", width: 0.79, height: 2.38, material: "wood", health: 100 },
  steel: { piece: "door_steel", width: 0.98, height: 2.12, material: "metal-thin", health: 60 },
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

// Each leaf is an entity without a fixed collider: its collider is the moving one the
// physics world keeps for it (see mapViewer.ts).
export const DOOR_ENTITIES: WorldEntity[] = DOOR_LEAVES.map((leaf) => ({
  id: leaf.id, kind: "door", material: leaf.model.material, maxHealth: leaf.model.health, yaw: leaf.yaw, center: leafPose(leaf, 0).center,
}));

// The doorway a leaf belongs to.
export function doorOf(entity: string): string | null {
  return DOOR_LEAVES.find((leaf) => leaf.id === entity)?.door.id ?? null;
}

// ---------- the view ----------

// Leaves swing toward their doorway's state over about half a second, easing in and out.
export class Doors {
  readonly groups = new Map<string, Object3D[]>();
  private leaves: { leaf: DoorLeaf; pivot: Object3D }[] = [];
  private share = new Map<string, number>();
  private target = new Map<string, number>();

  constructor(parent: Object3D, pieces: Map<string, KitPiece>, private onSwing: (leaf: DoorLeaf, pose: { center: Vec3; rotation: Quaternion }) => void = () => undefined) {
    for (const leaf of DOOR_LEAVES) {
      const pivot = new Object3D();
      pivot.position.set(leaf.hinge.x, leaf.hinge.y, leaf.hinge.z);
      pivot.rotation.y = leaf.yaw;
      pivot.add(kitObject(pieces.get(leaf.model.piece), leaf.door.tint));
      parent.add(pivot);
      this.leaves.push({ leaf, pivot });
      this.groups.set(leaf.id, [pivot]);
    }
    for (const door of DOORWAYS) { this.share.set(door.id, door.open ? 1 : 0); this.target.set(door.id, door.open ? 1 : 0); }
    this.pose();
  }

  setSwing(onSwing: (leaf: DoorLeaf, pose: { center: Vec3; rotation: Quaternion }) => void): void { this.onSwing = onSwing; this.pose(); }

  setOpen(open: Record<string, boolean>, instant = false): void {
    for (const door of DOORWAYS) {
      const target = (open[door.id] ?? door.open) ? 1 : 0;
      this.target.set(door.id, target);
      if (instant) this.share.set(door.id, target);
    }
    if (instant) this.pose();
  }

  update(seconds: number): void {
    let moved = false;
    for (const door of DOORWAYS) {
      const now = this.share.get(door.id)!, target = this.target.get(door.id)!;
      if (now === target) continue;
      const step = seconds * 2.2;
      this.share.set(door.id, Math.abs(target - now) <= step ? target : now + Math.sign(target - now) * step);
      moved = true;
    }
    if (moved) this.pose();
  }

  private pose(): void {
    for (const { leaf, pivot } of this.leaves) {
      const t = this.share.get(leaf.door.id)!, eased = t * t * (3 - 2 * t);
      pivot.rotation.y = leaf.yaw + leaf.turn * OPEN * eased;
      this.onSwing(leaf, leafPose(leaf, eased));
    }
  }
}
