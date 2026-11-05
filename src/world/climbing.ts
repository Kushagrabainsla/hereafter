import { Matrix4, Quaternion, Vector3 } from "three/webgpu";
import { type KitPlacer } from "./kit";

export interface Vec3 { x: number; y: number; z: number }

// A ladder against a ledge: its foot in front of the face, the outward normal of the face,
// the direction along it, and the height of the ledge it reaches. Climbing to the top steps
// over the ledge in the direction opposite the normal.
export interface Ladder { foot: Vec3; normal: { x: number; z: number }; along: { x: number; z: number }; top: number }

// A straight stair: where it starts, its direction (t), the open side (n), the height it
// climbs over its run, and the landing at the top.
export interface Stair { start: { x: number; z: number }; tx: number; tz: number; nx: number; nz: number; ground: number; height: number; run: number; landing: { x: number; z: number }; top: number }

export const STAIR_RISE = 0.18;
export const STAIR_RUN = 0.28;
const STAIR_WIDTH = 1.3;

// Steel ladders and stairs from modelled pieces (buildings.glb): flat-bar stiles and welded
// rungs; open grating treads between channel stringers, with posts on the open side. Their
// solid ramps and railings are colliders in the map layout.
export function addClimbing(placer: KitPlacer, ladders: Ladder[], stairs: Stair[]): void {
  const up = new Vector3(0, 1, 0), one = new Vector3(1, 1, 1);
  // Turns a piece built along +X to run along (x, z).
  const toward = (x: number, z: number): Quaternion => new Quaternion().setFromAxisAngle(up, Math.atan2(-z, x));
  for (const ladder of ladders) {
    const height = ladder.top - ladder.foot.y + 1.0, turn = toward(ladder.along.x, ladder.along.z);
    for (const side of [-0.23, 0.23]) {
      placer.place("ladder_rail", new Matrix4().compose(new Vector3(ladder.foot.x + ladder.along.x * side, ladder.foot.y, ladder.foot.z + ladder.along.z * side), turn, new Vector3(1, height, 1)));
    }
    for (let y = 0.3; y < height - 0.1; y += 0.3) placer.place("ladder_rung", new Matrix4().compose(new Vector3(ladder.foot.x, ladder.foot.y + y, ladder.foot.z), turn, one));
  }
  for (const stair of stairs) {
    const count = Math.ceil(stair.height / STAIR_RISE);
    // Treads face down the stair, their nosing toward whoever climbs it.
    const tread = new Quaternion().setFromAxisAngle(up, Math.atan2(stair.tx, stair.tz) + Math.PI);
    for (let i = 0; i < count; i += 1) {
      const along = (i + 0.5) * STAIR_RUN, y = stair.ground + (i + 1) * (stair.height / count);
      placer.place("stair_tread", new Matrix4().compose(new Vector3(stair.start.x + stair.tx * along, y - 0.03, stair.start.z + stair.tz * along), tread, one));
      if (i % 4 === 0) {
        placer.place("rail_post", new Matrix4().compose(new Vector3(stair.start.x + stair.tx * along + stair.nx * STAIR_WIDTH / 2, y, stair.start.z + stair.tz * along + stair.nz * STAIR_WIDTH / 2), new Quaternion(), new Vector3(1, 1.05, 1)));
      }
    }
    placer.place("stair_tread", new Matrix4().compose(new Vector3(stair.landing.x, stair.top - 0.04, stair.landing.z), tread, one));
    // A stringer either side, along the slope just under the treads.
    const slope = Math.atan2(stair.height, stair.run), length = Math.hypot(stair.run, stair.height);
    const pitch = toward(stair.tx, stair.tz).multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), slope));
    for (const side of [-1, 1]) {
      const out = side * (STAIR_WIDTH / 2 + 0.02);
      const middle = new Vector3(stair.start.x + stair.tx * stair.run / 2 + stair.nx * out, stair.ground + stair.height / 2 - 0.14, stair.start.z + stair.tz * stair.run / 2 + stair.nz * out);
      placer.place("stair_stringer", new Matrix4().compose(middle, pitch, new Vector3(length, 1, 1)));
    }
  }
}
