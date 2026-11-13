import { type FoodKind } from "./arena";

// The walk-in shops of the middle block, whose fronts were once photographs on a solid wall. Each
// runs back from the market alley like the record shop: a glass front with a pair of doors, and
// a steel back door onto the service alley or a boarded-up window a few rounds will clear.
//
// Plain data every client builds the same way; nightMarket.ts cuts the rooms and furnishes them
// and doors.ts hangs the doors. x is east, z is north, all in metres.

// The block's walls: the market alley's outer face, its inner face, and the same at the back.
export const SHOP_FRONT = { outer: 0.5, inner: 0.8 };
export const SHOP_BACK = { inner: 8.2, outer: 8.5 };
export const SHOP_CEILING = 3.6;

export interface ShopRoom {
  id: string;
  // How its door is named: "Press E to open the <label> door".
  label: string;
  z0: number;
  z1: number;
  // The top of the building above it, its outer walls' look and the looks of its shopfront and inside.
  roof: number;
  outer: string;
  front: string;
  inside: string;
  door: [number, number];
  doorOpen: boolean;
  window: [number, number];
  back: { door: number; paint: number } | { boards: number };
}

export const SHOP_ROOMS: ShopRoom[] = [
  { id: "boba", label: "boba shop", z0: 9.6, z1: 14.6, roof: 12, outer: "brickRed", front: "bobaFront", inside: "bobaWall", door: [10.2, 11.8], doorOpen: true, window: [12.0, 13.9], back: { boards: 13.25 } },
  { id: "dumplings", label: "dumpling shop", z0: 17.2, z1: 24.4, roof: 12, outer: "brickRed", front: "dumplingsFront", inside: "dumplingsWall", door: [17.7, 19.3], doorOpen: true, window: [20.0, 23.6], back: { door: 18, paint: 0x3d5a4c } },
  { id: "pho", label: "pho house", z0: -24.6, z1: -17.4, roof: 10, outer: "plasterTeal", front: "phoFront", inside: "phoWall", door: [-20.7, -19.1], doorOpen: false, window: [-24.0, -21.2], back: { door: -20, paint: 0x6e2a24 } },
];

// A stretch of wall from z0 to z1 as boxes around its openings: [z0, z1, y0, y1].
export type WallPiece = [number, number, number, number];
type Opening = [from: number, to: number, sill: number, head: number];
function wall(z0: number, z1: number, openings: Opening[]): WallPiece[] {
  const pieces: WallPiece[] = [];
  let at = z0;
  for (const [from, to, sill, head] of [...openings].sort((a, b) => a[0] - b[0])) {
    if (from > at) pieces.push([at, from, 0, SHOP_CEILING]);
    if (sill > 0) pieces.push([from, to, 0, sill]);
    pieces.push([from, to, head, SHOP_CEILING]);
    at = to;
  }
  if (z1 > at) pieces.push([at, z1, 0, SHOP_CEILING]);
  return pieces;
}

const DOOR_HEAD = 2.6, WINDOW_SILL = 0.55, WINDOW_HEAD = 2.9;
export const shopFrontWall = (room: ShopRoom): WallPiece[] => wall(room.z0, room.z1, [[...room.door, 0, DOOR_HEAD], [...room.window, WINDOW_SILL, WINDOW_HEAD]]);
export const shopBackWall = (room: ShopRoom): WallPiece[] => wall(room.z0, room.z1, ["door" in room.back ? [room.back.door - 0.5, room.back.door + 0.5, 0, 2.2] : [room.back.boards - 1, room.back.boards + 1, 0.6, 2.5]]);
export const shopPane = (room: ShopRoom): { x: number; z0: number; z1: number; y0: number; y1: number } => ({ x: 0.65, z0: room.window[0], z1: room.window[1], y0: WINDOW_SILL, y1: WINDOW_HEAD });

// The pendants of each shop, a pair in the middle of the room. They feed one real light between
// them, kept small: a light also costs every pixel it reaches through the walls, and two per
// shop cost 2 to 3 FPS at a MacBook's resolution.
export const SHOP_LAMPS: { id: string; room: string; x: number; z: number }[] = [
  { id: "boba-0", room: "boba", x: 3.8, z: 12.1 }, { id: "boba-1", room: "boba", x: 5.2, z: 12.1 },
  { id: "dumplings-0", room: "dumplings", x: 3.8, z: 20.8 }, { id: "dumplings-1", room: "dumplings", x: 5.2, z: 20.8 },
  { id: "pho-0", room: "pho", x: 3.8, z: -21 }, { id: "pho-1", room: "pho", x: 5.2, z: -21 },
];

// What lies on each shop's counter for a player to eat or drink, at the height of the counter top.
const COUNTER_TOP = 1.05;
export const SHOP_FOOD: { id: string; item: "food"; food: FoodKind; east: number; north: number; y: number }[] = [
  { id: "food-boba", item: "food", food: "boba", east: 4.7, north: 10.72, y: COUNTER_TOP },
  { id: "food-dumplings", item: "food", food: "dumplings", east: 5.95, north: 21.9, y: COUNTER_TOP },
  { id: "food-pho", item: "food", food: "pho", east: 5.95, north: -22.9, y: COUNTER_TOP },
  { id: "food-noodles", item: "food", food: "pho", east: -12.6, north: 26.0, y: COUNTER_TOP },
];

// The three shops on the outer blocks' market faces: the noodle bar and the tea house in the west
// buildings, the laundry in the east one. Their fronts were photographs, then shutters; now each is
// a room cut into its building, 6 m deep, with a glass front, a pair of glass doors and one light.
// They have no back way out, so the window is the second way: it shatters and can be climbed through.
// `wall` is the front's outer face on the market alley, `deep` the room's back wall; the room runs
// from z0 to z1.
export interface SideRoom {
  id: string;
  label: string;
  face: "px" | "nx";
  wall: number;
  deep: number;
  z0: number;
  z1: number;
  door: [number, number];
  doorOpen: boolean;
  window: [number, number];
  front: string;
  inside: string;
  // The pendants' colour, and their places along the room's depth (metres in from the front) and its length.
  tint: number;
  lamps: [number, number][];
}

export const SIDE_ROOMS: SideRoom[] = [
  { id: "noodles", label: "noodle bar", face: "px", wall: -8.5, deep: -14.8, z0: 24.6, z1: 29.6, door: [24.95, 26.55], doorOpen: true, window: [26.9, 29.2], front: "noodlesFront", inside: "noodlesWall", tint: 0xffcf96, lamps: [[3.0, 26.4], [3.0, 28.0]] },
  { id: "tea", label: "tea house", face: "px", wall: -8.5, deep: -14.8, z0: -29.4, z1: -24.6, door: [-26.45, -24.85], doorOpen: false, window: [-29.0, -26.8], front: "teaFront", inside: "teaWall", tint: 0xffc890, lamps: [[3.2, -28.0], [3.2, -26.2]] },
  { id: "laundry", label: "laundry", face: "nx", wall: 17, deep: 23.3, z0: -22.4, z1: -17.6, door: [-22.15, -20.55], doorOpen: true, window: [-20.2, -17.95], front: "laundryFront", inside: "laundryWall", tint: 0xeef2ff, lamps: [[3.0, -20.8], [3.0, -19.2]] },
];

// Which way is into the room, along x: -1 for the west buildings, +1 for the east one.
export const inward = (room: SideRoom): number => (room.face === "px" ? -1 : 1);
// x a given distance in from the room's front face.
export const roomX = (room: SideRoom, metres: number): number => room.wall + inward(room) * metres;
export const sideFrontWall = (room: SideRoom): WallPiece[] => wall(room.z0, room.z1, [[...room.door, 0, DOOR_HEAD], [...room.window, WINDOW_SILL, WINDOW_HEAD]]);
export const sidePane = (room: SideRoom): { x: number; z0: number; z1: number; y0: number; y1: number } => ({ x: roomX(room, 0.15), z0: room.window[0], z1: room.window[1], y0: WINDOW_SILL, y1: WINDOW_HEAD });
