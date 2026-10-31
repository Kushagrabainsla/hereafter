import { Matrix4, Quaternion, Vector3 } from "three/webgpu";
import { type InstanceRef, type Vec3 } from "./entities";
import { type KitPlacer } from "./kit";

// The market's wooden stalls, modelled in the kit (scripts/kit/build.py): a counter with a
// back rack and shelves, a striped awning and the goods of its trade. A stall shows its
// damage: below half health its awning is shot to rags, and when it breaks it collapses into
// a low pile that is still cover, about 0.7 m high, which players can climb onto.

export type Goods = "noodles" | "fruit" | "grill" | "tea" | "trinkets";
export interface StallSpot { x: number; z: number; side: 1 | -1; goods: Goods; awning: number }

// The pile a broken stall leaves, in the stall's own frame (counter facing +x).
const WRECK = { center: new Vector3(0.15, 0.35, 0), half: [0.75, 0.35, 1.6] as [number, number, number] };
const HIDDEN = new Matrix4().makeScale(0, 0, 0);

interface Part { refs: InstanceRef[]; matrix: Matrix4 }
interface Stall { whole: Part[]; awning: Part; torn: Part; wreck: Part; stage: number }

export class Stalls {
  private stalls = new Map<string, Stall>();

  // Places every stall's pieces; build the placer, then call show() to hide what starts hidden.
  constructor(placer: KitPlacer, spots: StallSpot[]) {
    spots.forEach((spot, index) => {
      const matrix = new Matrix4().compose(new Vector3(spot.x, 0, spot.z), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), spot.side > 0 ? 0 : Math.PI), new Vector3(1, 1, 1));
      const part = (name: string, tint?: number): Part => ({ refs: placer.place(name, matrix, tint), matrix });
      this.stalls.set(`stall:${index}`, {
        whole: [part("stall_body"), part(`goods_${spot.goods}`)],
        awning: part("stall_awning", spot.awning), torn: part("stall_awning_torn", spot.awning), wreck: part("stall_wreck", spot.awning),
        stage: -1,
      });
    });
  }

  // Where each broken stall's pile sits, for its collider.
  static wreck(spot: StallSpot): { center: Vec3; half: [number, number, number]; rotation: Quaternion } {
    const rotation = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), spot.side > 0 ? 0 : Math.PI);
    const center = WRECK.center.clone().applyQuaternion(rotation).add(new Vector3(spot.x, 0, spot.z));
    return { center: { x: center.x, y: center.y, z: center.z }, half: WRECK.half, rotation };
  }

  show(): void { for (const id of this.stalls.keys()) this.setHealth(id, 1); }

  // 1 whole, at or below one half torn, 0 collapsed. Returns the new stage when it changes:
  // 0 whole, 1 torn, 2 collapsed; otherwise -1.
  setHealth(id: string, share: number): number {
    const stall = this.stalls.get(id);
    if (!stall) return -1;
    const stage = share <= 0 ? 2 : share <= 0.5 ? 1 : 0;
    if (stage === stall.stage) return -1;
    stall.stage = stage;
    for (const part of stall.whole) this.visible(part, stage < 2);
    this.visible(stall.awning, stage === 0);
    this.visible(stall.torn, stage === 1);
    this.visible(stall.wreck, stage === 2);
    return stage;
  }

  private visible(part: Part, visible: boolean): void {
    for (const ref of part.refs) {
      ref.mesh.setMatrixAt(ref.index, visible ? part.matrix : HIDDEN);
      ref.mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
