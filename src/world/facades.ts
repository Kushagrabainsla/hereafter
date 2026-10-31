import { Matrix4, Quaternion, Vector3 } from "three/webgpu";
import { type KitPlacer } from "./kit";

// What hangs on the market's walls besides windows and signs: downpipes from the roofs,
// window air conditioners, condensers, meter cabinets, vents, steel back doors under small
// canopies and fire escapes up four facades. All of it is out of reach or flat against a
// wall, so it is drawn only and has no colliders.

export type Face = "px" | "nx" | "pz" | "nz";
export const FACE_YAW: Record<Face, number> = { px: Math.PI / 2, nx: -Math.PI / 2, pz: 0, nz: Math.PI };
// Which way a piece's +X runs along the wall, in the wall's own coordinate (z on walls facing
// east or west, x on walls facing north or south).
export const ALONG_SIGN: Record<Face, 1 | -1> = { px: -1, nx: 1, pz: 1, nz: -1 };
const NORMAL: Record<Face, [number, number]> = { px: [1, 0], nx: [-1, 0], pz: [0, 1], nz: [0, -1] };
const UP = new Vector3(0, 1, 0);

// A kit piece's place on a wall: `at` is the wall's surface coordinate, `along` the position
// along it, `out` how far in front of it.
export function wallMatrix(face: Face, at: number, along: number, y: number, out = 0, stretch = 1): Matrix4 {
  const [nx, nz] = NORMAL[face];
  const position = nx ? new Vector3(at + nx * out, y, along) : new Vector3(along, y, at + nz * out);
  return new Matrix4().compose(position, new Quaternion().setFromAxisAngle(UP, FACE_YAW[face]), new Vector3(stretch, 1, 1));
}

// Downpipes from the roof to the ground: wall, surface, position along it and the height of
// the facade's top row of windows (the cornice sits above it).
const DOWNPIPES: [Face, number, number, number][] = [
  ["px", -8.5, 20.65, 10.5], ["px", -8.5, 14.25, 10.5], ["px", -8.5, -6.25, 9.2], ["px", -8.5, -12.6, 9.2],
  ["nx", 0.5, 4.25, 10.5], ["nx", 0.5, 17.6, 10.5], ["nx", 0.5, -25.6, 8.5],
  ["px", 8.5, 4.25, 10.5], ["px", 8.5, 16.2, 10.5], ["px", 8.5, 25.6, 10.5], ["px", 8.5, -2.4, 8.5], ["px", 8.5, -25.6, 8.5],
  ["nx", 17, 10.25, 12], ["nx", 17, 27.5, 12], ["nx", 17, -2.25, 11], ["nx", 17, -8.0, 11], ["nx", 17, -27.5, 11],
  ["pz", -30, 1.5, 14], ["pz", -30, 7.5, 14], ["pz", -30, 16.5, 14],
  ["nz", 30, -7.6, 13], ["nz", 30, 1.5, 13], ["nz", 30, 7.5, 13], ["nz", 30, 16.5, 13],
];

// Split air-conditioner units: wall, surface, along, height of the unit's base.
const CONDENSERS: [Face, number, number, number][] = [
  ["px", 8.5, 21.4, 3.3], ["px", 8.5, -4.0, 6.6], ["px", 8.5, -21.3, 3.0], ["nx", 17, 18.2, 5.5], ["nx", 17, -23.6, 2.8], ["nx", 0.5, 25, 3.25],
];

const VENTS: [Face, number, number, number][] = [
  ["px", 8.5, 7.0, 1.7], ["nx", 17, -12.5, 2.4], ["px", 8.5, -14.6, 2.3], ["nx", 0.5, 6.0, 2.6], ["pz", -2, 7.0, 2.2], ["nz", 30, 4.5, 2.6],
];

// Steel back doors that stay shut: wall, surface, along, paint, and whether a meter cabinet
// hangs beside it.
export const BACK_DOORS: [Face, number, number, number, boolean][] = [
  ["px", 8.5, 18, 0x3d5a4c, true], ["px", 8.5, -20, 0x6e2a24, true], ["nx", 17, 15.5, 0x2f4a66, true],
  ["nx", 17, -10.5, 0x4a4036, true], ["px", -8.5, 15.9, 0x5a5a52, true], ["nx", 0.5, 25, 0x2e3a2c, false],
];

// Fire escapes: wall, surface, the window column they serve and how many landings, one per
// floor from the first upper floor. Their bottom landings are 4.25 m up, beyond reach.
export const ESCAPES: [Face, number, number, number][] = [
  ["nx", 17, 25.3, 3], ["px", 8.5, -20.9, 2], ["pz", -30, 12.5, 3], ["nx", 0.5, 9.1, 2],
];
const LANDING_DROP = 0.95, FLOOR = 3.3;

// Blade signs stick out from these spots, so nothing hangs in front of them.
export interface BladeSpot { face: Face; at: number; along: number; y0: number; y1: number }

export interface WindowSpot { x: number; y: number; z: number; face: Face }

const AC_TINTS = [0xffffff, 0xf0ead8, 0xdcd8cc, 0xe8e2d0];
const PIPE_TINTS = [0x8d9396, 0x5f6466, 0x9a8f7c, 0x4f5a52];

function seeded(seed: number): () => number {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

export function dressFacades(placer: KitPlacer, windows: WindowSpot[], blades: BladeSpot[]): void {
  const random = seeded(4242);
  for (const [face, at, along, top] of DOWNPIPES) {
    const tint = PIPE_TINTS[Math.floor(random() * PIPE_TINTS.length)];
    const head = top + 1.18, start = 0.4, count = Math.max(1, Math.round(head - start)), length = (head - start) / count;
    placer.place("pipe_shoe", wallMatrix(face, at, along, 0), tint);
    for (let k = 0; k < count; k += 1) placer.place("pipe_seg", new Matrix4().multiplyMatrices(wallMatrix(face, at, along, start + k * length), new Matrix4().makeScale(1, length, 1)), tint);
    placer.place("pipe_head", wallMatrix(face, at, along, head), tint);
  }
  for (const [face, at, along, y] of CONDENSERS) placer.place("condenser", wallMatrix(face, at, along, y), AC_TINTS[Math.floor(random() * AC_TINTS.length)]);
  for (const [face, at, along, y] of VENTS) placer.place("vent", wallMatrix(face, at, along, y));
  for (const [face, at, along, paint, meter] of BACK_DOORS) {
    placer.place("frame_steel", wallMatrix(face, at, along, 0));
    // The leaf sits just proud of the wall, hinged at the left of the frame.
    placer.place("door_steel", wallMatrix(face, at, along - ALONG_SIGN[face] * 0.49, 0, 0.03), paint);
    if (meter) placer.place("meter_box", wallMatrix(face, at, along + ALONG_SIGN[face] * 1.15, 1.1), 0xb9bdb8);
  }
  for (const [face, at, along, landings] of ESCAPES) {
    for (let k = 0; k < landings; k += 1) {
      const y = 5.2 - LANDING_DROP + k * FLOOR;
      placer.place("escape_platform", wallMatrix(face, at, along, y));
      if (k < landings - 1) placer.place("escape_stair", wallMatrix(face, at, along, y));
      if (k === 0) placer.place("escape_ladder", wallMatrix(face, at, along, y));
    }
  }
  // Window air conditioners sit on the sills of about a quarter of the windows, but not
  // behind a fire escape or a blade sign.
  const alongOf = (spot: WindowSpot): number => (spot.face === "px" || spot.face === "nx" ? spot.z : spot.x);
  const atOf = (spot: WindowSpot): number => (spot.face === "px" || spot.face === "nx" ? spot.x : spot.z);
  windows.forEach((spot) => {
    if (random() > 0.25) return;
    const along = alongOf(spot), at = atOf(spot);
    if (ESCAPES.some(([face, wall, column]) => face === spot.face && Math.abs(wall - at) < 0.1 && Math.abs(column - along) < 2)) return;
    if (blades.some((blade) => blade.face === spot.face && Math.abs(blade.at - at) < 0.1 && Math.abs(blade.along - along) < 1.1 && spot.y + 1 > blade.y0 && spot.y - 1 < blade.y1)) return;
    placer.place("ac_window", wallMatrix(spot.face, at, along, spot.y - 0.92, 0.06), AC_TINTS[Math.floor(random() * AC_TINTS.length)]);
  });
}
