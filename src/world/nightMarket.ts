import {
  AdditiveBlending, BoxGeometry, BufferGeometry, CanvasTexture, Color, CylinderGeometry, DoubleSide, DynamicDrawUsage, Group, InstancedBufferAttribute,
  InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D,
  MeshStandardNodeMaterial, PlaneGeometry, PointLight, Quaternion, RepeatWrapping, SRGBColorSpace, Scene, Sprite, SpriteMaterial,
  Vector3, type Material as SurfaceMaterial,
} from "three/webgpu";
import { bumpMap, clamp, color, float, instancedDynamicBufferAttribute, materialColor, materialNormal, materialRoughness, mix, mx_fractal_noise_float, mx_noise_float, positionWorld, smoothstep, texture3D, vec3 } from "three/tsl";
import { dampNode, outdoorAt, puddleNode, rippleHeight, setIndoors, WEATHER } from "./wetness";
import { noiseVolume } from "./noiseVolume";
import { SHOP_GLASS } from "./shopGlass";
import { LOOKS } from "./timeOfDay";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { type Arena, type ArenaData, type LayoutBox, type MapLayout } from "./arena";
import { type Material } from "./materials";
import { type InstanceRef, type WorldEntity } from "./entities";
import { type SurfaceTextures } from "./surfaceTextures";
import { FUEL_DRUM, FURNITURE, PALLET, propEntity, type PropModel } from "./props";
import { BREACH_ENTITIES } from "./breaches";
import { addClimbing, STAIR_RISE, STAIR_RUN, type Ladder, type Stair } from "./climbing";
import { TRUCK_SOLIDS, TRUCK_TOGGLES } from "./foodTruck";
import { Lamps, type LampPart } from "./lamps";
import { cardGeometry, glowing, instancedParts, kitObject, KitPlacer, splitGlow, type KitPiece } from "./kit";
import signCatalog from "./signs.json";
import posterCatalog from "./posters.json";
import { DOOR_ENTITIES, DOOR_TOGGLES, Doors } from "./doors";
import { inward, roomX, SHOP_BACK, SHOP_CEILING, SHOP_FOOD, SHOP_FRONT, SHOP_LAMPS, SHOP_ROOMS, shopBackWall, shopFrontWall, shopPane, SIDE_ROOMS, sideFrontWall, sidePane, type SideRoom } from "./shops";
import { dressFacades, wallMatrix } from "./facades";
import { PIPE_ENTITIES, placeSteamPipes, POWDER, SteamPipes } from "./steamPipes";
import { Stalls, type Goods } from "./stalls";
import type { LampCone } from "./lampHaze";

// The SoFA night market: a 60 m square back-alley block at dusk with three lanes. The market
// alley (x -8.5..0.5) is lined with wooden stalls; the service alley (x 8.5..17) runs behind
// the middle block; a restaurant on the west side is an indoor route beside the market alley.
// A cut-through and both ends join the alleys. A bar on the east side has a stair to an upper
// room and a balcony over the service alley; a fire escape overlooks the market.
//
// Everything here is plain data built the same way on every client, so solids, entity ids and
// prop ids agree without being sent. x is east, z is north, y is up, all in metres.

type Face = "px" | "nx" | "pz" | "nz";
interface Facade { face: Face; at: number; from: number; to: number; y0: number; y1: number; lit: number }
interface Shopfront { face: Face; at: number; along: number; width: number; photo: "cafe" | "stone"; sign: [text: string, background: string, ink: string]; open?: boolean }
interface Stall { x: number; z: number; side: 1 | -1; goods: Goods }
interface Pane { x: number; z0: number; z1: number; y0: number; y1: number }
interface Strand { x0: number; z0: number; x1: number; z1: number; y: number; sag: number }

const solids: LayoutBox[] = [];
const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };

function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, material: Material, look: string): void {
  solids.push({ half: [(x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2], center: { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: (z0 + z1) / 2 }, material, look });
}

// A building with a shop room cut out of its ground floor (shops.ts, SIDE_ROOMS): the block as the
// boxes round the room, and the room's front wall round its door and window.
function carved(x0: number, x1: number, y1: number, z0: number, z1: number, look: string, room: SideRoom): void {
  const rx0 = Math.min(room.wall, room.deep), rx1 = Math.max(room.wall, room.deep);
  if (rx0 > x0) box(x0, rx0, 0, y1, z0, z1, "brick", look);
  if (x1 > rx1) box(rx1, x1, 0, y1, z0, z1, "brick", look);
  if (room.z0 > z0) box(rx0, rx1, 0, y1, z0, room.z0, "brick", look);
  if (z1 > room.z1) box(rx0, rx1, 0, y1, room.z1, z1, "brick", look);
  box(rx0, rx1, SHOP_CEILING, y1, room.z0, room.z1, "brick", look);
  const [f0, f1] = [room.wall, roomX(room, 0.3)].sort((a, b) => a - b);
  for (const [a, b, y0, y1top] of sideFrontWall(room)) box(f0, f1, y0, y1top, a, b, "brick", room.front);
}

// ---------- west block: two buildings and the restaurant between them ----------
carved(-30, -8.5, 12, 14, 30, "brickWarm", SIDE_ROOMS[0]);
carved(-30, -8.5, 11, -30, -6, "brickDark", SIDE_ROOMS[1]);
box(-30, -15, 0, 3.6, -6, 14, "brick", "tile");
box(-30, -8.5, 3.6, 14.5, -6, 14, "brick", "plasterCream");
// Restaurant front: piers, two doors and two glass storefronts on low sills.
const front = (z0: number, z1: number, y0 = 0, y1 = 3.6): void => box(-8.8, -8.5, y0, y1, z0, z1, "brick", "shopGreen");
front(-6, -4.4); front(-4.4, -2.8, 2.6); front(-2.8, 0.2);
front(0.2, 4.6, 0, 0.55); front(0.2, 4.6, 2.9);
front(4.6, 5.4);
front(5.4, 9.8, 0, 0.55); front(5.4, 9.8, 2.9);
front(9.8, 10.8); front(10.8, 12.4, 2.6); front(12.4, 14);
// Inside: a pass counter splits the dining room from the kitchen walkway.
box(-12.6, -11.8, 0, 1.05, 0.5, 8.5, "wood", "woodDark");
box(-15, -14.3, 0, 0.95, -5.4, -1, "metal-solid", "steel");
box(-15, -14.3, 0, 0.95, 3, 13.4, "metal-solid", "steel");
box(-15, -14.2, 0, 1.0, -0.6, 2.4, "metal-solid", "steelDark");

// ---------- market alley ----------
// Food truck across the north end, with gaps either side: a hollow kitchen players can enter.
solids.push(...TRUCK_SOLIDS);
// Fire escape on the west building: a grated platform with railings, reached by a ladder.
box(-8.5, -7.1, 4.42, 4.6, -20.5, -14.5, "metal-thin", "grating");
box(-7.16, -7.1, 4.6, 5.65, -20.5, -17.7, "boundary", "rail");
box(-7.16, -7.1, 4.6, 5.65, -16.3, -14.5, "boundary", "rail");
box(-8.5, -7.1, 4.6, 5.65, -20.56, -20.5, "boundary", "rail");
box(-8.5, -7.1, 4.6, 5.65, -14.5, -14.44, "boundary", "rail");

// ---------- middle block, with a cut-through and passages at both ends ----------
// Solid brick between the shops; the shops themselves are cut out below (shops.ts).
box(0.5, 8.5, 0, 12, 4, 9.6, "brick", "brickRed");
box(0.5, 8.5, 0, 12, 14.6, 17.2, "brick", "brickRed");
box(0.5, 8.5, 0, 12, 24.4, 26, "brick", "brickRed");
box(0.5, 8.5, 0, 10, -26, -24.6, "brick", "plasterTeal");
box(0.5, 8.5, 0, 10, -17.4, -14.4, "brick", "plasterTeal");
for (const room of SHOP_ROOMS) {
  box(SHOP_FRONT.outer, SHOP_BACK.outer, SHOP_CEILING, room.roof, room.z0, room.z1, "brick", room.outer);
  for (const [z0, z1, y0, y1] of shopFrontWall(room)) box(SHOP_FRONT.outer, SHOP_FRONT.inner, y0, y1, z0, z1, "brick", room.front);
  for (const [z0, z1, y0, y1] of shopBackWall(room)) box(SHOP_BACK.inner, SHOP_BACK.outer, y0, y1, z0, z1, "brick", room.outer);
}
// Inside the shops: a counter with a cooking line behind it, and tables by the window.
box(2.4, 7.0, 0, 1.05, 10.4, 11.05, "wood", "none");
box(5.6, 6.8, 0, 2.0, 13.9, 14.6, "metal-solid", "none");
box(5.6, 6.3, 0, 1.05, 20.4, 24.4, "wood", "none");
box(7.4, 8.2, 0, 1.05, 20.6, 24.4, "metal-solid", "none");
box(5.6, 6.3, 0, 1.05, -24.6, -21.2, "wood", "none");
box(7.4, 8.2, 0, 1.05, -24.4, -21.4, "metal-solid", "none");
// Inside the shops of the outer blocks: the noodle bar's counter and cooking line, the tea house's
// counter, and the laundry's washers stacked two high along its north wall.
box(-12.95, -12.25, 0, 1.05, 25.4, 28.8, "wood", "none");
box(-14.8, -14.0, 0, 1.05, 25.2, 29.0, "metal-solid", "none");
box(-13.35, -12.65, 0, 1.05, -28.2, -25.8, "wood", "none");
box(17.4, 23.3, 0, 1.71, -18.25, -17.6, "metal-solid", "none");
box(0.5, 8.5, 0, 10, -6.6, -2, "brick", "plasterTeal");
box(0.5, 8.5, 3.6, 10, -14.4, -6.6, "brick", "plasterTeal");
// The record shop runs through the block: a glass front and double doors on the market alley,
// a steel back door and a boarded-up window on the service alley.
const recordsFront = (z0: number, z1: number, y0 = 0, y1 = 3.6): void => box(0.5, 0.8, y0, y1, z0, z1, "brick", "recordsFront");
recordsFront(-14.4, -13.9); recordsFront(-13.9, -11.1, 0, 0.55); recordsFront(-13.9, -11.1, 2.9);
recordsFront(-11.1, -10.7); recordsFront(-10.7, -9.1, 2.6); recordsFront(-9.1, -6.6);
const recordsBack = (z0: number, z1: number, y0 = 0, y1 = 3.6): void => box(8.2, 8.5, y0, y1, z0, z1, "brick", "plasterTeal");
recordsBack(-14.4, -11.8); recordsBack(-11.8, -9.8, 0, 0.6); recordsBack(-11.8, -9.8, 2.5);
recordsBack(-9.8, -8.6); recordsBack(-8.6, -7.6, 2.2); recordsBack(-7.6, -6.6);
// Inside: record bins down the middle, shelves along both side walls and a counter at the back.
const RECORD_BINS: [number, number][] = [[2.8, -12.6], [4.6, -12.6], [3.6, -9.3]];
for (const [x, z] of RECORD_BINS) box(x - 0.7, x + 0.7, 0, 0.78, z - 0.38, z + 0.38, "wood", "none");
box(1.1, 4.75, 0, 2.2, -14.4, -14.0, "wood", "none");
box(1.1, 6.6, 0, 2.2, -7.0, -6.6, "wood", "none");
box(6.6, 7.3, 0, 1.0, -14.3, -12.0, "wood", "woodBar");

// ---------- service alley ----------
for (const [x0, x1, z0, z1] of [[8.65, 9.75, 14, 15.9], [8.65, 9.75, 10.6, 12.5], [15.85, 16.95, -10.2, -8.3], [8.65, 9.75, -18, -16.1]]) box(x0, x1, 0, 1.3, z0, z1, "metal-solid", "dumpster");

// ---------- east block and the bar ----------
box(17, 30, 0, 14, 10, 30, "brick", "plasterSand");
carved(17, 30, 13, -30, -2, "plasterOchre", SIDE_ROOMS[2]);
box(24.5, 30, 0, 7.4, -2, 10, "brick", "plasterInside");
box(17, 30, 7.4, 14, -2, 10, "brick", "plasterSand");
const barFront = (z0: number, z1: number, y0 = 0, y1 = 3.95): void => box(17, 17.3, y0, y1, z0, z1, "brick", "barRed");
barFront(-2, -1.2); barFront(-1.2, 0.4, 2.6); barFront(0.4, 1.2);
barFront(1.2, 5.6, 0, 0.55); barFront(1.2, 5.6, 2.9);
barFront(5.6, 6.6); barFront(6.6, 8.2, 2.6); barFront(8.2, 10);
// Upper floor with a stairwell along the back wall, the upper room's front wall and a balcony door.
box(17, 23.2, 3.95, 4.2, -2, 10, "concrete", "slab");
box(23.2, 24.5, 3.95, 4.2, 5.32, 10, "concrete", "slab");
box(23.2, 24.5, 3.95, 4.2, -2, -1.4, "concrete", "slab");
box(17, 17.3, 4.2, 7.4, -2, 5, "brick", "plasterSand");
box(17, 17.3, 6.6, 7.4, 5, 6.6, "brick", "plasterSand");
box(17, 17.3, 4.2, 7.4, 6.6, 10, "brick", "plasterSand");
box(15.4, 17, 3.95, 4.2, 1.6, 10.4, "concrete", "slab");
box(15.4, 15.46, 4.2, 5.25, 2.9, 10.4, "boundary", "rail");
box(15.4, 17, 4.2, 5.25, 1.6, 1.66, "boundary", "rail");
box(15.4, 17, 4.2, 5.25, 10.34, 10.4, "boundary", "rail");
box(20.6, 21.4, 0, 1.1, -0.8, 5.2, "wood", "woodBar");
box(19.4, 20.8, 0, 0.85, 7.4, 9.6, "wood", "poolTable");
box(21.2, 22.2, 4.2, 5.0, 7.2, 9.6, "wood", "sofa");
// The bar stair: a ramp rising north along the back wall from the bar floor to the upper room.
const stair: Stair = (() => {
  const height = 4.2, run = Math.ceil(height / STAIR_RISE) * STAIR_RUN, start = { x: 23.85, z: -1.4 };
  return { start, tx: 0, tz: 1, nx: -1, nz: 0, ground: 0, height, run, landing: { x: 23.85, z: start.z + run + 0.7 }, top: height };
})();
{
  const slope = Math.atan2(stair.height, stair.run), length = Math.hypot(stair.run, stair.height);
  const tilt = { x: Math.sin(-slope / 2), y: 0, z: 0, w: Math.cos(-slope / 2) };
  const upY = Math.cos(slope), upZ = -Math.sin(slope);
  solids.push({ half: [0.65, 0.08, length / 2], center: { x: stair.start.x, y: stair.height / 2 - upY * 0.08, z: stair.start.z + stair.run / 2 - upZ * 0.08 }, rotation: tilt, material: "metal-thin", look: "none" });
  const railFrom = 1, railMid = (railFrom + stair.run) / 2, railLength = (stair.run - railFrom) / Math.cos(slope);
  solids.push({ half: [0.03, 0.5, railLength / 2], center: { x: 23.2, y: stair.height * railMid / stair.run + 0.55, z: stair.start.z + railMid }, rotation: tilt, material: "boundary", look: "stairRail" });
}

// ---------- end buildings beyond both ends of the alleys ----------
box(-30, 30, 0, 16, -40, -30, "brick", "concreteCap");
box(-30, 30, 0, 15, 30, 40, "brick", "brickCap");

const ladders: Ladder[] = [
  { foot: { x: -6.8, y: 0, z: -17 }, normal: { x: 1, z: 0 }, along: { x: 0, z: 1 }, top: 4.6 },
  { foot: { x: 15.1, y: 0, z: 2.25 }, normal: { x: -1, z: 0 }, along: { x: 0, z: 1 }, top: 4.2 },
];

const facades: Facade[] = [
  { face: "px", at: -8.5, from: 14, to: 30, y0: 5.2, y1: 10.5, lit: 0.45 },
  { face: "px", at: -8.5, from: -6, to: 14, y0: 5.2, y1: 12.8, lit: 0.5 },
  { face: "px", at: -8.5, from: -30, to: -6, y0: 5.2, y1: 9.2, lit: 0.4 },
  { face: "nx", at: 0.5, from: 4, to: 26, y0: 5.2, y1: 10.5, lit: 0.45 },
  { face: "px", at: 8.5, from: 4, to: 26, y0: 5.2, y1: 10.5, lit: 0.35 },
  { face: "nx", at: 0.5, from: -26, to: -2, y0: 5.2, y1: 8.5, lit: 0.45 },
  { face: "px", at: 8.5, from: -26, to: -2, y0: 5.2, y1: 8.5, lit: 0.35 },
  { face: "pz", at: 26, from: 0.5, to: 8.5, y0: 5.2, y1: 10.5, lit: 0.4 },
  { face: "nz", at: 4, from: 0.5, to: 8.5, y0: 5.2, y1: 10.5, lit: 0.4 },
  { face: "pz", at: -2, from: 0.5, to: 8.5, y0: 5.2, y1: 8.5, lit: 0.4 },
  { face: "nz", at: -26, from: 0.5, to: 8.5, y0: 5.2, y1: 8.5, lit: 0.4 },
  { face: "nx", at: 17, from: 10, to: 30, y0: 5.2, y1: 12, lit: 0.4 },
  { face: "nx", at: 17, from: -30, to: -2, y0: 5.2, y1: 11, lit: 0.4 },
  { face: "nx", at: 17, from: -2, to: 10, y0: 8.6, y1: 12, lit: 0.4 },
  { face: "pz", at: -30, from: -30, to: 30, y0: 5.2, y1: 14, lit: 0.35 },
  { face: "nz", at: 30, from: -30, to: 30, y0: 5.2, y1: 13, lit: 0.35 },
];
// Upper bar room windows, either side of the balcony door.
const upperWindows: { z: number }[] = [{ z: -0.6 }, { z: 2.6 }, { z: 8.4 }];

const shopfronts: Shopfront[] = [
  { face: "px", at: -8.5, along: 27, width: 5.2, photo: "cafe", sign: ["NOODLE BAR", "#18322f", "#ffd27a"], open: true },
  { face: "px", at: -8.5, along: -27, width: 4.6, photo: "stone", sign: ["TEA HOUSE", "#2f1830", "#ffd2ef"], open: true },
  { face: "nx", at: 0.5, along: 21.7, width: 5.2, photo: "stone", sign: ["DUMPLINGS", "#401818", "#ffe0a0"], open: true },
  { face: "nx", at: 0.5, along: 11.9, width: 3.6, photo: "cafe", sign: ["BOBA", "#173a52", "#bfe9ff"], open: true },
  { face: "nx", at: 0.5, along: -11.5, width: 4.4, photo: "cafe", sign: ["RECORDS", "#1b2240", "#c8e4ff"], open: true },
  { face: "nx", at: 0.5, along: -21, width: 4.6, photo: "stone", sign: ["PHO HOUSE", "#3a2a12", "#ffe6b0"], open: true },
  { face: "nx", at: 17, along: -20, width: 4.6, photo: "stone", sign: ["LAUNDRY", "#e9e2d2", "#2d5a8a"], open: true },
];

// What each stall sells; the noodle stall's pot is where the steam rises.
const stalls: Stall[] = [
  { x: -7.7, z: 19, side: 1, goods: "noodles" }, { x: -7.7, z: -10.5, side: 1, goods: "fruit" }, { x: -7.7, z: -22.5, side: 1, goods: "grill" },
  { x: -0.3, z: 15.5, side: -1, goods: "tea" }, { x: -0.3, z: 8.5, side: -1, goods: "trinkets" }, { x: -0.3, z: -7.5, side: -1, goods: "fruit" }, { x: -0.3, z: -15.5, side: -1, goods: "grill" },
];
const AWNINGS = [0xc63c3c, 0x1f7a74, 0xe0a030, 0x3654a8];
export const STALL_SPOTS = stalls.map((stall, index) => ({ ...stall, awning: AWNINGS[index % AWNINGS.length] }));
const panes: Pane[] = [
  { x: -8.65, z0: 0.2, z1: 4.6, y0: 0.55, y1: 2.9 },
  { x: -8.65, z0: 5.4, z1: 9.8, y0: 0.55, y1: 2.9 },
  { x: 17.15, z0: 1.2, z1: 5.6, y0: 0.55, y1: 2.9 },
  { x: 0.65, z0: -13.9, z1: -11.1, y0: 0.55, y1: 2.9 },
  ...SHOP_ROOMS.map(shopPane),
  ...SIDE_ROOMS.map(sidePane),
];
const strands: Strand[] = [
  ...[23, 15, 8, 1, -6, -13, -20].map((z) => ({ x0: -8.5, z0: z, x1: 0.5, z1: z + 1.5, y: 5.4, sag: 0.7 })),
  ...[17, 7, -3, -13, -23].map((z) => ({ x0: 8.5, z0: z, x1: 17, z1: z + 2.5, y: 5.0, sag: 0.5 })),
  { x0: 2.5, z0: -1.6, x1: 6.5, z1: 3.6, y: 4.6, sag: 0.4 },
];
const lanternRows = [18.5, 4.5, -9.5];
// Props: [model, x, z, base height, yaw]. Wooden and cardboard ones break; all can be shoved.
const propSpots: [string, number, number, number, number][] = [
  ["crate_wood_large", -7.9, 16.3, 0, 0.2], ["crate_wood", -7.9, 16.3, 0.46, 0.5], ["cardboard_box", -7.7, -6.8, 0, 0.3],
  ["plastic_crate", 0.0, 12.4, 0, 0.1], ["plastic_crate", 0.0, 12.4, 0.31, 0.7], ["trash_can", 0.0, -4.3, 0, 0],
  ["oil_drum", -8.0, -13.5, 0, 0], ["crate_wood", -1.0, -21.4, 0, 1.2],
  ["crate_wood_large", 2.6, 0.2, 0, 1.4], ["crate_wood", 2.7, 0.2, 0.46, 1.1], ["oil_drum", 6.8, -1.1, 0, 0], ["oil_drum", 7.4, -0.5, 0, 0],
  ["plastic_crate", 6.6, 3.2, 0, 0.4], ["cardboard_box", 2.0, 3.2, 0, 0.9],
  ["oil_drum", 16.2, 2.9, 0, 0], ["trash_can", 16.3, -6.0, 0, 0], ["trash_can", 9.2, 20.5, 0, 0], ["cardboard_box", 16.2, 13.2, 0, 0.2],
  ["crate_wood", 9.3, -4.0, 0, 0.6], ["plastic_crate", 16.3, 22.0, 0, 0.3], ["oil_drum", 9.3, -22.5, 0, 0],
  ["crate_wood_large", 19.0, 1.5, 4.2, 0.3], ["cardboard_box", 18.2, -1.0, 4.2, 0.5],
  ["plastic_crate", -13.9, -5.6, 0, 0.2], ["cardboard_box", -14.0, 13.6, 0, 0.4],
  // Clutter stacked against the service alley's walls, clear of its doors, dumpsters and breaker.
  ["crate_wood_large", 8.9, -14.6, 0, 1.6], ["cardboard_box", 8.95, -14.9, 0.47, 0.3], ["crate_wood", 8.95, -14.2, 0.47, 1.5],
  ["crate_wood", 8.95, -10.6, 0, 1.55],
  ["plastic_crate", 8.85, 5.4, 0, 0.1], ["plastic_crate", 8.85, 5.4, 0.26, 0.4], ["plastic_crate", 8.85, 6.0, 0, 1.6],
  ["cardboard_box", 8.8, 7.6, 0, 0.2], ["cardboard_box", 8.85, 7.6, 0.35, 0.9],
  ["oil_drum", 16.6, -13.3, 0, 0], ["oil_drum", 16.6, -14.0, 0, 0.8], ["trash_can", 16.6, -15.1, 0, 0.3],
  ["cardboard_box", 16.7, 17.6, 0, 0.3], ["cardboard_box", 16.7, 18.2, 0, 1.2], ["cardboard_box", 16.7, 17.9, 0.35, 0.7],
  ["crate_wood", 16.75, -20.8, 0, 1.6], ["crate_wood", 16.75, -20.8, 0.35, 1.5], ["plastic_crate", 16.65, -21.9, 0, 0.1], ["cardboard_box", 16.7, -23.0, 0, 0.7],
  // Red fuel drums: shot open, they vent fire and burst.
  ["fuel_drum", -7.6, 13.0, 0, 0], ["fuel_drum", 16.3, -3.0, 0, 0.6],
  ["fuel_drum", -7.8, -5.2, 0, 0.3], ["fuel_drum", 0.0, 4.6, 0, 1.1], ["fuel_drum", 9.0, 21.8, 0, 0.4], ["fuel_drum", 16.4, 11.6, 0, 2.0],
  // Street clutter heaped against the walls, clear of doors, stalls, spawns and pickups: pallets
  // stacked with sacks of cement, tyres and jerrycans; rubbish bags and boxes round a bin; crates and
  // bottles of a shop's stock; a chair with plant pots by the restaurant's window and a wet floor sign
  // by the dumpling shop. Each heap is one recipe laid against its wall, checked clear of the rest.
  // All of it can be shoved, knocked over or shot; tyres roll off their stacks.
  ["trash_can", -8.16, 23.35, 0, -1.659], ["rubbish_bag", -8.2, 24, 0, -1.487], ["rubbish_bag", -8.2, 24.57, 0, -1.507], ["rubbish_bag", -7.68, 24.28, 0, -1.63], ["cardboard_box", -8.2, 25.16, 0, -0.001],
  ["cardboard_box", -8.2, 25.16, 0.341, -0.012], ["cardboard_box", -7.65, 24.9, 0, -1.534], ["water_bottle", -7.28, 24.4, 0, -1.502], ["pallet", -7.94, -16.5, 0, -1.534], ["pallet", -7.94, -16.5, 0.144, -1.535],
  ["cement_sack", -7.94, -16.24, 0.288, -1.677], ["cement_sack", -7.94, -16.76, 0.288, -1.67], ["cement_sack", -7.94, -16.5, 0.468, 0.081], ["tyre", -8.14, -17.55, 0, -1.514], ["tyre", -8.14, -17.55, 0.165, -1.53],
  ["tyre", -8.14, -17.55, 0.33, -1.617], ["jerrycan_steel", -8.38, -15.55, 0, -1.545], ["jerrycan_steel", -8.18, -15.55, 0, -1.545], ["crate_wood_large", -8.14, 1, 0, -1.634], ["crate_wood_large", -8.14, 1.05, 0.464, -1.56],
  ["crate_wood", -8.2, 0.95, 0.928, -1.602], ["plastic_crate", -8.24, 2, 0, -1.546], ["plastic_crate", -8.24, 2, 0.254, -1.541], ["plastic_crate", -8.24, 2, 0.508, -1.675], ["plastic_crate", -8.24, 2, 0.762, -1.688],
  ["cardboard_box", -7.55, 0.7, 0, -1.49], ["rubbish_bag", -7.6, 1.55, 0, -1.629], ["crate_wood_large", 0.14, 22.8, 0, -1.634], ["crate_wood_large", 0.14, 22.75, 0.464, -1.666], ["crate_wood", 0.2, 22.85, 0.928, -1.596],
  ["plastic_crate", 0.24, 21.8, 0, -1.654], ["plastic_crate", 0.24, 21.8, 0.254, -1.675], ["plastic_crate", 0.24, 21.8, 0.508, -1.594], ["plastic_crate", 0.24, 21.8, 0.762, -1.47], ["cardboard_box", -0.45, 23.1, 0, -1.499],
  ["rubbish_bag", -0.4, 22.25, 0, -1.507], ["plastic_crate", 0.24, -13.35, 0, -1.541], ["plastic_crate", 0.24, -13.35, 0.254, -1.513], ["plastic_crate", 0.24, -13.35, 0.508, -1.5], ["crate_wood", 0.24, -12.45, 0, -1.465],
  ["crate_wood", 0.24, -12.45, 0.347, -1.513], ["cardboard_box", 0.2, -11.75, 0, 0.101], ["water_bottle", -0.15, -12.85, 0, -1.684], ["water_bottle", -0.2, -12.65, 0, -1.579], ["jerrycan", -0.25, -12.1, 0, -1.464],
  ["trash_can", 0.16, -22.65, 0, -1.5], ["rubbish_bag", 0.2, -23.3, 0, -1.494], ["rubbish_bag", 0.2, -23.87, 0, -1.574], ["rubbish_bag", -0.32, -23.58, 0, -1.628], ["cardboard_box", 0.2, -24.46, 0, -0.12],
  ["cardboard_box", 0.2, -24.46, 0.341, 0.039], ["cardboard_box", -0.35, -24.2, 0, -1.578], ["water_bottle", -0.72, -23.7, 0, -1.508], ["pallet", 9.06, 24.6, 0, -1.585], ["pallet", 9.06, 24.6, 0.144, -1.599],
  ["cement_sack", 9.06, 24.34, 0.288, -1.535], ["cement_sack", 9.06, 24.86, 0.288, -1.673], ["cement_sack", 9.06, 24.6, 0.468, 0.009], ["tyre", 8.86, 25.65, 0, -1.603], ["tyre", 8.86, 25.65, 0.165, -1.677],
  ["tyre", 8.86, 25.65, 0.33, -1.569], ["jerrycan_steel", 8.62, 23.65, 0, -1.682], ["jerrycan_steel", 8.82, 23.65, 0, -1.587], ["pallet", 9.06, -5.4, 0, -1.593], ["pallet", 9.06, -5.4, 0.144, -1.534],
  ["pallet", 9.06, -5.4, 0.288, -1.601], ["tyre", 8.86, -6.4, 0, -1.522], ["tyre", 8.86, -6.4, 0.165, -1.67], ["trash_can", 8.84, -26.25, 0, -1.58], ["rubbish_bag", 8.8, -25.6, 0, -1.601],
  ["rubbish_bag", 8.8, -25.03, 0, -1.658], ["rubbish_bag", 9.32, -25.32, 0, -1.483], ["cardboard_box", 8.8, -24.44, 0, -0.118], ["cardboard_box", 8.8, -24.44, 0.341, 0.001], ["cardboard_box", 9.35, -24.7, 0, -1.475],
  ["water_bottle", 9.72, -25.2, 0, -1.671], ["oil_drum", 16.64, 25.5, 0, -1.554], ["oil_drum", 16.64, 24.8, 0, -1.588], ["pallet", 16.44, 23.5, 0, -1.565], ["jerrycan", 16.05, 25.15, 0, -1.641],
  ["jerrycan_steel", 16.1, 24.35, 0, -1.496], ["tyre", 16.64, 26.2, 0, -1.493], ["tyre", 16.64, 26.2, 0.165, -1.534], ["plastic_crate", 16.74, -18.55, 0, -1.582], ["plastic_crate", 16.74, -18.55, 0.254, -1.556],
  ["plastic_crate", 16.74, -18.55, 0.508, -1.469], ["crate_wood", 16.74, -17.65, 0, -1.579], ["crate_wood", 16.74, -17.65, 0.347, -1.569], ["cardboard_box", 16.7, -16.95, 0, 0.021], ["water_bottle", 16.35, -18.05, 0, -1.646],
  ["water_bottle", 16.3, -17.85, 0, -1.568], ["jerrycan", 16.25, -17.3, 0, -1.54], ["monobloc_chair", -7.9, 5, 0, 1.4], ["clay_pot", -8.2, 4.2, 0, 0], ["clay_pot", -8.2, 5.85, 0, 1.1],
  ["water_bottle", -7.6, 4.45, 0, 0.6], ["wet_floor_sign", -0.5, 20.4, 0, 0.6], ["pallet", 15.8, 18, 0, 0], ["pallet", 15.8, 18.1, 0.144, 0.07],
];
// Furniture is loose too: [model, x, z, yaw, tint for the plastic stools].
const furnitureSpots: [string, number, number, number, number?][] = [];
const stoolsRound = (x: number, z: number, angles: number[], tints: number[]): void => angles.forEach((a, k) => { furnitureSpots.push(["plastic_stool", x + Math.cos(a) * 0.95, z + Math.sin(a) * 0.95, a, tints[k]]); });
// The restaurant's tables, four chairs round each, every chair facing its table.
for (const z of [-2, 2.4, 6.8]) {
  furnitureSpots.push(["dining_table", -10.3, z, 0]);
  for (const [dx, dz] of [[-0.75, 0], [0.75, 0], [0, 0.7], [0, -0.7]]) furnitureSpots.push(["dining_chair", -10.3 + dx, z + dz, Math.atan2(-dx, -dz)]);
}
// The market alley's folding tables, three plastic stools round each.
for (const [x, z] of [[-4, 12.5], [-3.6, -4.5], [-4.2, -15]]) {
  furnitureSpots.push(["cafe_table", x, z, 0]);
  stoolsRound(x, z, [0.4, 0.4 + Math.PI * 2 / 3, 0.4 + Math.PI * 4 / 3], [0xc9302c, 0x2f6fb5, 0x3c9d6b]);
}
for (let z = -0.4; z <= 4.8; z += 0.9) furnitureSpots.push(["bar_stool", 20.0, z, 0]);
// The shops of the middle block.
for (const x of [3.3, 4.7, 6.1]) furnitureSpots.push(["bar_stool", x, 11.5, 0]);
furnitureSpots.push(["cafe_table", 2.2, 13.4, 0]);
stoolsRound(2.2, 13.4, [0.5, 3.6], [0xc94f6d, 0x3fa7a0]);
for (const z of [21.0, 23.0]) {
  furnitureSpots.push(["cafe_table", 2.4, z, 0]);
  stoolsRound(2.4, z, [0.1, 3.3], [0xc9402f, 0xe0a030]);
}
for (const [x, z] of [[2.2, -22.6], [4.3, -22.6], [3.2, -18.25]]) {
  furnitureSpots.push(["dining_table", x, z, 0]);
  for (const dx of [-0.75, 0.75]) furnitureSpots.push(["dining_chair", x + dx, z, Math.atan2(-dx, 0)]);
}
// The shops of the outer blocks: stools at the noodle bar's counter and a table by its window,
// tables and chairs in the tea house, and stools along the laundry's front while the washers run.
for (const z of [25.9, 26.9, 27.9]) furnitureSpots.push(["bar_stool", -11.9, z, 0]);
furnitureSpots.push(["cafe_table", -10.0, 28.4, 0]);
stoolsRound(-10.0, 28.4, [0.2, 3.4], [0xc9302c, 0xe0a030]);
for (const [x, z] of [[-10.4, -28.3], [-11.2, -26.6]]) {
  furnitureSpots.push(["dining_table", x, z, 0]);
  for (const dx of [-0.75, 0.75]) furnitureSpots.push(["dining_chair", x + dx, z, Math.atan2(-dx, 0)]);
}
for (const x of [18.3, 19.1, 21.6, 22.4]) furnitureSpots.push(["plastic_stool", x, -21.9, 0, [0x2f6fb5, 0x3c9d6b, 0xc9302c, 0xe0a030][Math.round(x) % 4]]);
furnitureSpots.push(["cafe_table", 21.2, -19.8, 0]);
// Fire extinguishers on walls: shot, they burst into a cloud of powder. [wall, surface, along, height]
const EXTINGUISHERS: [Face, number, number, number][] = [
  ["px", -15, 13.6, 1.05], ["pz", -2, 18.5, 0.9], ["nx", 8.19, -12.1, 0.9], ["px", 8.5, 21.3, 0.9], ["nx", 17, -11.8, 0.9], ["nx", 0.5, 5.2, 0.9],
];
// Each can also be lifted off its wall and used.
const EXTINGUISHER_PICKUPS = EXTINGUISHERS.map(([face, at, along], index) => {
  const [nx, nz] = ({ px: [1, 0], nx: [-1, 0], pz: [0, 1], nz: [0, -1] } as const)[face];
  return { id: `extinguisher:${index}`, item: "extinguisher" as const, east: nx ? at + nx * 0.1 : along, north: nx ? along : at + nz * 0.1 };
});
// The gas rings a player can light: over the restaurant's range and the two shops' cooking lines.
// long is how far they run along the line. What stands on a lit ring catches.
export const STOVES = [
  { id: "stove:restaurant", at: { x: -14.6, y: 1.0, z: 0.9 }, long: 1.3 },
  { id: "stove:dumplings", at: { x: 7.8, y: 0.97, z: 22.5 }, long: 0.6 },
  { id: "stove:pho", at: { x: 7.8, y: 0.97, z: -22.9 }, long: 0.6 },
];
// The key lights used where the renderer cannot cluster many lights (WebGL 2).
const pointLights: [number, number, number, number, number][] = [
  [-4, 4.6, 14, 0xffb066, 30], [-4, 4.6, -9, 0xffb066, 30], [-11.6, 3.1, 4, 0xffc887, 18],
  [20.2, 3.4, 4, 0xff9ab0, 10], [12.75, 4.2, 12, 0xffa860, 26], [12.75, 4.2, -14, 0xffa860, 26],
];

export const NIGHT_MARKET: MapLayout = {
  id: "night-market",
  name: "Night Market",
  spawns: [
    { east: -4, north: 27.6, heading: 180 }, { east: 12.75, north: -27.6, heading: 0 },
    { east: -7.8, north: -28.6, heading: 0 }, { east: 12.75, north: 27.6, heading: 180 },
    { east: -6.5, north: 27.6, heading: 180 }, { east: 15, north: -27.6, heading: 0 },
    { east: 4.5, north: -28, heading: 0 }, { east: 4.5, north: 28, heading: 180 },
  ],
  pickups: [
    { id: "pistol-south", weapon: "pistol", east: -4, north: 22.5 },
    { id: "pistol-north", weapon: "pistol", east: 12.75, north: -21.5 },
    { id: "rifle-cut", weapon: "rifle", east: 4.5, north: 1 },
    { id: "rifle-kitchen", weapon: "rifle", east: -13.45, north: 3.6 },
    // Spare magazines, two to a pickup, on counters, the ground and the high ground.
    { id: "mags-table-south", weapon: "pistol", item: "magazines", east: -2.7, north: 13.6 },
    { id: "mags-dining", weapon: "pistol", item: "magazines", east: -12.2, north: 2.0, y: 1.05 },
    { id: "mags-bar", weapon: "pistol", item: "magazines", east: 21, north: 3.6, y: 1.1 },
    { id: "mags-cut", weapon: "pistol", item: "magazines", east: 2.2, north: -1.2 },
    { id: "mags-table-north", weapon: "rifle", item: "magazines", east: -2.9, north: -16.1 },
    { id: "mags-fire-escape", weapon: "rifle", item: "magazines", east: -7.8, north: -19.4, y: 4.6 },
    { id: "mags-upstairs", weapon: "rifle", item: "magazines", east: 18.4, north: 8.8, y: 4.2 },
    { id: "mags-dumpster", weapon: "rifle", item: "magazines", east: 16.4, north: -9.25, y: 1.3 },
    { id: "mags-records", weapon: "pistol", item: "magazines", east: 6.95, north: -12.5, y: 1.0 },
    ...SHOP_FOOD,
    ...EXTINGUISHER_PICKUPS,
  ],
  solids,
  toggles: [
    ...TRUCK_TOGGLES, ...DOOR_TOGGLES,
    ...STOVES.map((stove) => ({ id: stove.id, label: "the stove", at: stove.at, open: false, verbs: ["light", "turn off"] as [string, string] })),
    { id: "switch:breaker", label: "the alley lights", at: { x: 8.62, y: 1.55, z: -12.5 }, open: true, verbs: ["switch on", "switch off"] as [string, string], entity: "lamp:breaker" },
  ],
};

// The sun: where it lies from the market (any length), its colour and strength. At dusk it is low in
// the north-northwest, so it shines down the main alley and rakes across the cross alleys; at 4.4
// it is the one strong key light over the many lamps, which won a blind test against 3.2. The
// viewer sets it (and MARKET_FILL) to the chosen time of day before building (timeOfDay.ts); the
// light bake reads it too.
export const MARKET_SUN = { ...LOOKS.dusk.sun };
// The lamps burn at this share of their night strength: by day the sun and sky outshine them.
export const LAMP_LEVEL = 0.5;
// The even light from the grey sky above and the dark paving below. It fills what neither the sun
// nor a lamp reaches; the arms and weapon get the same, so they match the world around them. It
// is cool and kept low, so the shade stays blue and deep against the warm sunlight.
export const MARKET_FILL = { ...LOOKS.dusk.fill };

// The playable square: 60 m across, centred on the origin.
export const MARKET_ARENA: Arena = { sizeMeters: 60 };

export function nightMarketData(): ArenaData {
  return { extentMeters: 80, elevation: { gridSize: 5, meters: new Array(25).fill(0), baseMeters: 0 }, layout: NIGHT_MARKET };
}

// ---------- drawing ----------

function canvasTexture(width: number, height: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, tileMeters = 0): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas textures are unavailable");
  draw(context, width, height);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  if (tileMeters) { texture.wrapS = texture.wrapT = RepeatWrapping; texture.repeat.set(1 / tileMeters, 1 / tileMeters); }
  return texture;
}
function seeded(seed: number): () => number {
  let s = Math.abs(Math.round(seed)) % 2147483646 + 1;
  return () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
}
function softSpot(): CanvasTexture {
  return canvasTexture(128, 128, (g, w, h) => {
    const gradient = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gradient.addColorStop(0, "rgba(255,255,255,0.9)"); gradient.addColorStop(0.4, "rgba(255,255,255,0.35)"); gradient.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gradient; g.fillRect(0, 0, w, h);
  });
}


// What a lit window shows: eight kinds of room seen from the alley.
function windowInterior(kind: number): CanvasTexture {
  return canvasTexture(128, 160, (g, w, h) => {
    const vertical = (top: string, bottom: string): void => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, top); gr.addColorStop(1, bottom); g.fillStyle = gr; g.fillRect(0, 0, w, h); };
    const glowAt = (x: number, y: number, radius: number, color: string): void => { const gr = g.createRadialGradient(x, y, 0, x, y, radius); gr.addColorStop(0, color); gr.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = gr; g.fillRect(0, 0, w, h); };
    switch (kind) {
      case 0: // warm room between heavy curtains
        vertical("#a8603a", "#ffcf8a"); glowAt(w * 0.5, h * 0.35, w * 0.6, "rgba(255,230,170,0.7)");
        for (const [x0, x1] of [[0, w * 0.27], [w * 0.73, w]]) { g.fillStyle = "#5e1a1e"; g.fillRect(x0, 0, x1 - x0, h); for (let x = x0; x < x1; x += 6) { g.fillStyle = "rgba(255,120,100,0.12)"; g.fillRect(x, 0, 2, h); } }
        break;
      case 1: // blinds
        vertical("#f3d49a", "#ffe9bd");
        for (let y = 4; y < h; y += 9) { g.fillStyle = "rgba(150,105,60,0.75)"; g.fillRect(0, y, w, 4); }
        break;
      case 2: // television light
        vertical("#16233f", "#2c4c80"); glowAt(w * 0.3, h * 0.55, w * 0.7, "rgba(140,200,255,0.75)");
        g.fillStyle = "#0b0f18"; g.beginPath(); g.roundRect(w * 0.1, h * 0.72, w * 0.8, h * 0.32, 14); g.fill();
        break;
      case 3: // plant against a warm room
        vertical("#c88a52", "#ffd59a");
        g.fillStyle = "#15200f";
        for (let i = 0; i < 9; i += 1) { g.beginPath(); g.ellipse(w * (0.62 + Math.sin(i * 2.3) * 0.18), h * (0.55 + Math.cos(i * 1.7) * 0.14), w * 0.13, h * 0.05, i, 0, 7); g.fill(); }
        g.fillRect(w * 0.55, h * 0.8, w * 0.22, h * 0.2);
        break;
      case 4: // kitchen
        vertical("#fff6de", "#ffe7b6");
        g.fillStyle = "#d6bf98"; for (let x = 6; x < w; x += 30) g.fillRect(x, 6, 26, h * 0.3);
        g.fillStyle = "rgba(90,70,40,0.6)"; g.fillRect(0, h * 0.72, w, 5);
        break;
      case 5: // a dim room with one lamp
        vertical("#1e130d", "#3a2418"); glowAt(w * 0.68, h * 0.6, w * 0.55, "rgba(255,180,100,0.85)");
        g.fillStyle = "#2a1a10"; g.beginPath(); g.moveTo(w * 0.58, h * 0.48); g.lineTo(w * 0.78, h * 0.48); g.lineTo(w * 0.74, h * 0.38); g.lineTo(w * 0.62, h * 0.38); g.fill();
        break;
      case 6: // half curtain
        vertical("#ffe0a8", "#ffd090");
        g.fillStyle = "#efe2c8"; g.fillRect(0, h * 0.52, w, h * 0.48);
        for (let x = 0; x < w; x += 8) { g.fillStyle = "rgba(160,130,90,0.25)"; g.fillRect(x, h * 0.52, 2, h * 0.48); }
        break;
      default: // a room lit by a pink sign
        vertical("#5a1438", "#ff4fa0"); glowAt(w * 0.5, h * 0.8, w * 0.7, "rgba(255,150,210,0.6)");
    }
    // The window's own grime and a soft vignette from the reveal.
    const edge = g.createRadialGradient(w / 2, h / 2, w * 0.35, w / 2, h / 2, w * 0.85);
    edge.addColorStop(0, "rgba(0,0,0,0)"); edge.addColorStop(1, "rgba(0,0,0,0.45)");
    g.fillStyle = edge; g.fillRect(0, 0, w, h);
  });
}


// Box geometry whose texture coordinates are in metres, so tiled materials keep their scale.
function meterBox(w: number, h: number, d: number): BoxGeometry {
  const geometry = new BoxGeometry(w, h, d);
  const uv = geometry.attributes.uv;
  const sizes = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let face = 0; face < 6; face += 1) for (let i = 0; i < 4; i += 1) { const k = face * 4 + i; uv.setXY(k, uv.getX(k) * sizes[face][0], uv.getY(k) * sizes[face][1]); }
  return geometry;
}

const FACE_YAW: Record<Face, number> = { px: Math.PI / 2, nx: -Math.PI / 2, pz: 0, nz: Math.PI };
const FACE_NORMAL: Record<Face, [number, number]> = { px: [1, 0], nx: [-1, 0], pz: [0, 1], nz: [0, -1] };
const UP = new Vector3(0, 1, 0);

// Looks that make their own light take none from the lightmap.
const UNBAKED = new Set(["lampGlow", "sconce", "bottle", "photoCafe", "photoStone"]);

// Static geometry merged per material, so the whole map draws in a few dozen calls.
class Batch {
  private parts = new Map<string, BufferGeometry[]>();
  constructor(private materials: Record<string, SurfaceMaterial>) {}
  add(look: string, geometry: BufferGeometry, matrix: Matrix4): void {
    if (!this.materials[look]) throw new Error(`No material for ${look}`);
    geometry.applyMatrix4(matrix);
    const list = this.parts.get(look) ?? [];
    list.push(geometry);
    this.parts.set(look, list);
  }
  box(look: string, w: number, h: number, d: number, x: number, y: number, z: number, yaw = 0): void {
    this.add(look, meterBox(w, h, d), new Matrix4().compose(new Vector3(x, y + h / 2, z), new Quaternion().setFromAxisAngle(UP, yaw), new Vector3(1, 1, 1)));
  }
  cylinder(look: string, radius: number, height: number, x: number, y: number, z: number, segments = 12, top = radius): void {
    this.add(look, new CylinderGeometry(top, radius, height, segments), new Matrix4().makeTranslation(x, y + height / 2, z));
  }
  plane(look: string, w: number, h: number, x: number, y: number, z: number, face: Face): void {
    this.add(look, new PlaneGeometry(w, h), new Matrix4().compose(new Vector3(x, y, z), new Quaternion().setFromAxisAngle(UP, FACE_YAW[face]), new Vector3(1, 1, 1)));
  }
  // Surfaces that take baked light are unindexed, so every triangle owns its corners and
  // can sit anywhere in the lightmap; they are named static:<look> for the bake to find.
  build(parent: Object3D, shadows: (look: string) => boolean = () => true, baked: Mesh[] | null = null): void {
    for (const [look, list] of this.parts) {
      let merged = mergeGeometries(list, false);
      for (const geometry of list) geometry.dispose();
      if (!merged) continue;
      if (baked && !UNBAKED.has(look)) {
        const unindexed = merged.toNonIndexed();
        merged.dispose();
        merged = unindexed;
      }
      const mesh = new Mesh(merged, this.materials[look]);
      mesh.castShadow = shadows(look);
      mesh.receiveShadow = true;
      if (baked && !UNBAKED.has(look)) { mesh.name = `static:${look}`; baked.push(mesh); }
      parent.add(mesh);
    }
    this.parts.clear();
  }
}

// Vertical blade signs sticking out over the alleys: wall position, height, the wall it hangs
// from, text and neon colour.
const blades: [number, number, number, Face, string, string][] = [
  [-8.5, 24.0, 6.6, "px", "HOTEL", "#ff4f7d"], [-8.5, -3.6, 6.4, "px", "KARAOKE", "#57e6ff"],
  [0.5, 18.4, 6.2, "nx", "NOODLES", "#ffb347"], [0.5, -18.2, 5.9, "nx", "CAFE", "#7dff9a"],
  [17, 13.5, 6.2, "nx", "GAME BAR", "#c28bff"], [8.5, -11.5, 5.6, "px", "TATTOO", "#ff5f5f"],
];
// Power and phone cables across the alleys: [x0, z0, x1, z1, height, sag].
const cables: [number, number, number, number, number, number][] = [
  [-8.5, 26.5, 0.5, 25.5, 9.4, 0.7], [-8.5, 11.5, 0.5, 13.0, 8.4, 0.6], [-8.5, -2.5, 0.5, -1.0, 9.2, 0.8], [-8.5, -17.5, 0.5, -19.0, 8.6, 0.6],
  [-8.5, 20.0, 0.5, 5.0, 10.2, 0.9], [8.5, 24.5, 17, 22.5, 8.8, 0.6], [8.5, 9.5, 17, 11.0, 9.6, 0.7], [8.5, -6.5, 17, -4.5, 8.2, 0.6], [8.5, -18.5, 17, -21.0, 9.0, 0.8],
];
// Water tanks on the roofs that line the alleys, seen against the sky: [x, roof height, z].
const tanks: [number, number, number][] = [[-11.6, 12, 24], [-12.2, 11, -24], [20.4, 14, 22], [20.2, 13, -18], [4.5, 12, 18]];

export interface BuiltMap {
  refs: Map<string, InstanceRef[]>;
  // Plain objects drawn for an entity, hidden while it is destroyed.
  groups: Map<string, Object3D[]>;
  entities: WorldEntity[];
  props: WorldEntity[];
  ladders: Ladder[];
  // Static surfaces that can take baked light (see lightmap.ts), one mesh per look.
  surfaces: Mesh[];
  // The doors players open, kick and shoot off their hinges, and the steam pipes that burst.
  doors: Doors;
  pipes: SteamPipes;
  // Stalls show their damage: torn awnings, then a low pile with its own collider.
  stalls: Stalls;
  wrecks: { id: string; center: { x: number; y: number; z: number }; half: [number, number, number]; rotation: Quaternion }[];
  // Every breakable lamp and sign, and the lights they feed.
  lamps: Lamps;
  // Adds the market's lights: every lamp, bulb string, sign and lit shop when the renderer
  // can afford many lights, otherwise six key lights and painted pools of light. By day
  // (lampsOn false) the outdoor lamps and signs are off and get no light; lit rooms keep theirs.
  light: (many: boolean, lampsOn?: boolean) => void;
  // Every lamp, bulb string, lantern and sign as [x, y, z, colour, intensity, distance],
  // whichever renderer draws them, so the first-person view can be lit like the spot it is in.
  lightSources: [number, number, number, number, number, number][];
  // The shaded lamps' beams, by light source, for their glow in the air (lampHaze.ts).
  lightCones: Map<number, LampCone>;
  // Lanterns sway, a neon sign flickers and steam rises.
  update: (seconds: number) => void;
  dispose: () => void;
}

type NodeOptions = ConstructorParameters<typeof MeshStandardNodeMaterial>[0];

// By `day` the windows of the upper floors show no lit rooms, only dark glass.
export function buildNightMarket(scene: Scene, textures: SurfaceTextures, propModels: PropModel[], kit = new Map<string, KitPiece>(), day = false): BuiltMap {
  const owned: CanvasTexture[] = [];
  const own = <T extends CanvasTexture>(texture: T): T => { owned.push(texture); return texture; };
  const std = (options: ConstructorParameters<typeof MeshStandardMaterial>[0]): MeshStandardMaterial => new MeshStandardMaterial(options);
  // Walls darken and dirty toward the ground and in broad patches; the paving holds puddles
  // that turn dark and glossy and pick up the lights and the sky.
  const P = positionWorld;
  const patches = clamp(mx_fractal_noise_float(P.mul(vec3(0.21, 0.08, 0.21))).mul(0.5).add(0.5), 0, 1);
  const footing = smoothstep(0.05, 2.9, P.y.add(mx_noise_float(P.mul(0.75)).mul(0.5)));
  const grime = mix(float(0.46), float(1), footing).mul(mix(float(0.72), float(1.08), patches));
  const wall = (options: NodeOptions): MeshStandardNodeMaterial => { const material = new MeshStandardNodeMaterial(options); material.colorNode = materialColor.mul(grime); return material; };
  // In the rain (dusk) the whole street is wet: darker and glossy, its texture's relief softened so the
  // lamps do not glitter in it. Where water stands (wetness.ts) it is smooth, flat but for the
  // rings the rain makes, and only a little darker: a puddle at night shows mostly what it
  // mirrors, and painted too dark it reads as a hole. Not perfectly smooth, so each lamp draws
  // a long streak of light down the water instead of a pinpoint.
  // Round each puddle the ground is damp: darker and glossier than the rest of the wet street,
  // so the water fades out through a dark rim and does not end at a stamped line. And the wet
  // street is not one even gloss: broad patches (7 m across) of it shed the water sooner.
  const wet = puddleNode(P);
  const damp = dampNode(P);
  const sheen = mix(float(0.42), float(0.8), smoothstep(0.35, 0.65, texture3D(noiseVolume(), vec3(P.x.div(7), float(0.55), P.z.div(7))).g));
  const street = (options: NodeOptions): MeshStandardNodeMaterial => {
    const material = new MeshStandardNodeMaterial(options);
    material.normalScale.set(0.5, 0.5);
    // Dry by day (WEATHER.wet 0): the street keeps its own colour and roughness.
    material.colorNode = materialColor.mul(mix(mix(mix(float(1), float(0.78), WEATHER.wet), float(0.64), damp), float(0.72), wet));
    const wetRough = materialRoughness.mul(mix(float(1), sheen, WEATHER.wet));
    material.roughnessNode = mix(mix(wetRough, wetRough.mul(0.55), damp), float(0.14), wet);
    material.normalNode = mix(materialNormal, bumpMap(rippleHeight(P)) as unknown as typeof materialNormal, wet);
    return material;
  };
  const brick = (color: number): MeshStandardNodeMaterial => wall({ map: textures.brick, normalMap: textures.brickNormal, color, roughness: 0.92 });
  const plaster = (color: number): MeshStandardNodeMaterial => wall({ map: textures.plaster, normalMap: textures.plasterNormal, color, roughness: 0.95 });
  const concrete = (color: number): MeshStandardNodeMaterial => wall({ map: textures.concrete, normalMap: textures.concreteNormal, color, roughness: 0.9 });
  const glow = (color: number, intensity: number): MeshStandardMaterial => std({ color: 0x000000, emissive: color, emissiveIntensity: intensity });
  const materials: Record<string, SurfaceMaterial> = {
    brickWarm: brick(0xc9a48c), brickDark: brick(0x9b7d6a), brickRed: brick(0xb08a74), brickCap: brick(0xa88672),
    plasterCream: plaster(0xe6cfaa), plasterTeal: plaster(0xa8c0b9), plasterSand: plaster(0xd9b98f), plasterOchre: plaster(0xc9a46a), plasterInside: plaster(0xe8dcc6),
    concreteCap: concrete(0xb7b2aa), slab: concrete(0xbdb8b0),
    shopGreen: wall({ color: 0x1d3b36, metalness: 0.1, roughness: 0.55 }), barRed: wall({ color: 0x5a1a1f, metalness: 0.1, roughness: 0.55 }), tile: std({ map: textures.tiles, normalMap: textures.tilesNormal, roughness: 0.3 }),
    floor: std({ map: textures.woodFloor, normalMap: textures.woodFloorNormal, roughness: 0.62 }),
    lampGlow: glow(0xffc27a, 4), sconce: glow(0xffb070, 3.5), bottle: glow(0x6fd0c0, 0.9),
    pavement: street({ map: textures.pavement, normalMap: textures.pavementNormal, color: 0xa29d97, roughness: 0.85 }),
    asphalt: street({ map: textures.asphalt, normalMap: textures.asphaltNormal, color: 0x7d7d7d, roughness: 0.92 }),
    photoCafe: std({ map: textures.storefrontCafe, emissive: 0xffffff, emissiveMap: textures.storefrontCafe, emissiveIntensity: 0.62, roughness: 0.15, metalness: 0.2 }),
    photoStone: std({ map: textures.storefrontStone, emissive: 0xffffff, emissiveMap: textures.storefrontStone, emissiveIntensity: 0.62, roughness: 0.15, metalness: 0.2 }),
    recordsFront: wall({ color: 0x1b2a4a, metalness: 0.1, roughness: 0.55 }), recordsWall: plaster(0x8a4a3a),
    bobaFront: wall({ color: 0x1c5560, metalness: 0.1, roughness: 0.55 }), bobaWall: plaster(0xe2b8b0),
    dumplingsFront: wall({ color: 0x5a1a16, metalness: 0.1, roughness: 0.55 }), dumplingsWall: plaster(0xd9a860),
    phoFront: wall({ color: 0x3e3a18, metalness: 0.1, roughness: 0.55 }), phoWall: plaster(0xa8c09e),
    noodlesFront: wall({ color: 0x18322f, metalness: 0.1, roughness: 0.55 }), noodlesWall: plaster(0xc9ae84),
    teaFront: wall({ color: 0x2f1830, metalness: 0.1, roughness: 0.55 }), teaWall: plaster(0xb79a74),
    laundryFront: wall({ color: 0x23384f, metalness: 0.1, roughness: 0.55 }), laundryWall: plaster(0xd4d8d0),
  };
  const statics = new Batch(materials);
  // ---------- lights ----------
  // The dense set, on renderers that cluster lights, each kept by its index so the lamps that
  // feed it can dim it when they break.
  const many: [number, number, number, number, number, number][] = [];
  const light = ([x, y, z, color, intensity, distance]: [number, number, number, number, number, number]): number => many.push([x, y, z, color, intensity * LAMP_LEVEL, distance]) - 1;
  const strandLights = strands.map((strand) => [0.2, 0.5, 0.8].map((t) => light([strand.x0 + (strand.x1 - strand.x0) * t, strand.y - strand.sag * 4 * t * (1 - t) - 0.25, strand.z0 + (strand.z1 - strand.z0) * t, 0xffb46a, 9, 8.5])));
  const stallLights = stalls.map((stall) => light([stall.x + stall.side * 0.3, 2.05, stall.z, 0xffc27a, 8, 6]));
  const lanternLights = lanternRows.map((z) => [-6.3, -1.9].map((x) => light([x, 4.3, z, 0xff6a3a, 7, 7])));
  // Wall lamps along the service alley: where each hangs, and its light.
  const sconces: { x: number; z: number; light: number }[] = [];
  for (const z of [20, 10, 0, -10, -20]) for (const [x, at, dz] of [[9.0, 8.62, 0], [16.5, 16.88, 5]]) sconces.push({ x: at, z: z + dz, light: light([x, 3.3, z + dz, 0xffa860, 11, 8.5]) });
  for (const shop of shopfronts) { const [nx, nz] = FACE_NORMAL[shop.face]; light([nx ? shop.at + nx * 0.5 : shop.along, 2.7, nz ? shop.at + nz * 0.5 : shop.along, 0xffd7a0, 6, 6.5]); }
  const bladeLights = blades.map(([at, along, y, face, , color]) => light([at + FACE_NORMAL[face][0] * 0.9, y, along, Number.parseInt(color.slice(1), 16), 6, 6.5]));
  const lanternSignLight = light([15.0, 3.3, 6.2, 0xff6fae, 4, 5]);
  const archLight = light([-4, 5.0, 28.6, 0xffcf5a, 4, 6]);
  const bannerLight = light([-4, 5.6, -22.8, 0xffd0a8, 3, 5]);
  const pendantLights = [-2, 2.4, 6.8].map((z) => light([-10.3, 2.6, z, 0xffc887, 4.5, 6]));
  const recordsLights = [3.0, 6.0].map((x) => light([x, 3.0, -10.5, 0xffd6a0, 4.5, 6.5]));
  const shopLights = new Map(SHOP_ROOMS.map((room) => [room.id, light([4.5, 3.0, (room.z0 + room.z1) / 2, 0xffd6a0, 8, 5.5])]));
  const sideLights = new Map(SIDE_ROOMS.map((room) => [room.id, light([roomX(room, 3.0), 3.0, (room.z0 + room.z1) / 2, room.tint, 8, 5.5])]));
  light([-13.4, 3.1, -2, 0xfff0dd, 4, 6]);
  light([-13.4, 3.1, 9, 0xfff0dd, 4, 6]);
  const barLight = light([20.1, 3.4, 8.5, 0xff9ab0, 5, 7]);
  light([21.5, 3.4, 1.5, 0xffb070, 4, 6]);
  light([20.5, 6.9, 4, 0xffc887, 4, 7]);
  light([-3.6, 1.9, -24.0, 0xffdca8, 4, 5]);
  light([-4.6, 2.7, -26.0, 0xfff1dc, 1.6, 2.4]);
  const lamps = new Lamps(many);
  // The stalls' cage lamps light down and out from under their awnings, softly (a strong glow
  // fills the stall like fog); the barn lamps' shades send a bright, narrower beam down the wall.
  const lightCones = new Map<number, LampCone>([
    ...stallLights.map((index) => [index, { aim: [0, -1, 0], cos: -0.25, gain: 1.5 }] as [number, LampCone]),
    ...sconces.map((sconce) => [sconce.light, { aim: [0, -1, 0], cos: 0.3, gain: 6 }] as [number, LampCone]),
  ]);
  const darkGlass = std({ color: 0x2a2622, roughness: 0.25, metalness: 0.1 });
  // Kit pieces placed around the market: wall dressing, lamps and their fittings.
  const placer = new KitPlacer(kit);
  // The shops' furniture is drawn apart from the same chairs and shelves elsewhere, which would
  // otherwise all be drawn whenever any one copy is in view.
  const shopKit = new KitPlacer(kit), bobaKit = shopKit, dumplingsKit = shopKit, phoKit = shopKit;
  // Lamps drawn from a kit piece: the fittings instanced like any piece, and the glass once
  // per lamp, lit by a flag of its own, so that each goes dark on its own without a second,
  // hidden copy being drawn. One part per lamp, in order.
  const lampSet = (name: string, at: Matrix4[], glass: SurfaceMaterial): LampPart[] => {
    const lit = glass as MeshStandardMaterial;
    const { solid, glow } = splitGlow(kit.get(name));
    placer.define(`${name}:fittings`, solid);
    for (const matrix of at) placer.place(`${name}:fittings`, matrix);
    if (!glow || !at.length) return [];
    const flags = new InstancedBufferAttribute(new Float32Array(at.length).fill(1), 1);
    flags.setUsage(DynamicDrawUsage);
    const on = instancedDynamicBufferAttribute(flags, "float") as unknown as ReturnType<typeof float>;
    const surface = new MeshStandardNodeMaterial({ roughness: 0.25, metalness: 0.1 });
    surface.colorNode = mix(color(darkGlass.color), color(lit.color), on);
    surface.emissiveNode = color(lit.emissive).mul(lit.emissiveIntensity).mul(on);
    const mesh = new InstancedMesh(glow, surface, at.length);
    at.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
    root.add(mesh);
    return at.map((_, index) => ({ kind: "flag" as const, flags, index }));
  };
  // A lamp drawn from a kit piece as an object of its own, as one that hides with its stall;
  // its glass swaps to dark when it breaks.
  const lampObject = (name: string, matrix: Matrix4, parent: Object3D = root): LampPart[] => {
    const { solid, glow: glass } = splitGlow(kit.get(name));
    const object = kitObject(solid);
    object.applyMatrix4(matrix);
    parent.add(object);
    if (!glass) return [];
    const mesh = new Mesh(glass, materials.lampGlow);
    object.add(mesh);
    return [{ kind: "mesh", mesh, lit: materials.lampGlow, dark: darkGlass }];
  };
  const at = (x: number, y: number, z: number, scale = 1): Matrix4 => new Matrix4().compose(new Vector3(x, y, z), new Quaternion(), new Vector3(scale, scale, scale));
  const root = new Group();
  root.name = "night-market";
  scene.add(root);

  // Ground: paving in the market alley and passages, asphalt in the service alley, wooden
  // floors indoors.
  // Ground is cut into 4 m tiles so the parts under buildings can be left out of the lightmap.
  const indoors: [number, number, number, number][] = [];
  const ground = (look: string, x0: number, x1: number, z0: number, z1: number, y: number): void => {
    if (look === "floor" && y < 1) indoors.push([x0, x1, z0, z1]);
    const geometry = new PlaneGeometry(x1 - x0, z1 - z0, Math.ceil((x1 - x0) / 4), Math.ceil((z1 - z0) / 4));
    const uv = geometry.attributes.uv;
    for (let i = 0; i < uv.count; i += 1) uv.setXY(i, uv.getX(i) * (x1 - x0), uv.getY(i) * (z1 - z0));
    statics.add(look, geometry, new Matrix4().compose(new Vector3((x0 + x1) / 2, y, (z0 + z1) / 2), new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2), new Vector3(1, 1, 1)));
  };
  ground("pavement", -40, 40, -42, 42, 0.004);
  ground("asphalt", 8.5, 17, -30, 30, 0.008);
  ground("floor", -15, -8.8, -6, 14, 0.012);
  ground("floor", 17.3, 24.5, -2, 10, 0.012);
  ground("floor", 17.3, 23.2, -2, 10, 4.205);
  ground("floor", 23.2, 24.5, 5.32, 10, 4.205);

  // Furniture that is also a solid is drawn as its modelled piece, standing on the floor under
  // the solid and turned to face the room; the solid stays as its collider. Counters run along
  // the solid's longer side.
  const furnish = (solid: LayoutBox): [string, number] | null => {
    const [, , hz] = solid.half;
    if (solid.look === "woodDark") return ["pass_counter", Math.PI / 2];
    if (solid.look === "woodBar") return [hz > 2 ? "bar_counter" : "record_counter", -Math.PI / 2];
    if (solid.look === "poolTable") return ["pool_table", 0];
    if (solid.look === "sofa") return ["sofa", -Math.PI / 2];
    // Dumpsters stand with their backs to the nearer wall of the service alley.
    if (solid.look === "dumpster") return ["dumpster", solid.center.x < 12.75 ? Math.PI / 2 : -Math.PI / 2];
    return null;
  };
  // Long runs (the kitchen's counters and range, the fire escape's walkway) are laid as modules
  // along the solid's length, each stretched a little to fill it: [piece, module length, turn
  // to face the room, standing on the floor or centred in the solid].
  const MODULES: Record<string, [string, number, number, boolean]> = {
    steel: ["kitchen_counter", 1.0, Math.PI / 2, true], steelDark: ["kitchen_range", 1.5, Math.PI / 2, true], grating: ["grating_deck", 1.0, Math.PI / 2, false],
  };
  // Every other solid with a look is a wall or floor, drawn as its box.
  for (const solid of solids) {
    if (solid.look === "none" || solid.look === "rail" || solid.look === "stairRail") continue;
    const piece = furnish(solid);
    if (piece) {
      placer.place(piece[0], new Matrix4().compose(new Vector3(solid.center.x, solid.center.y - solid.half[1], solid.center.z), new Quaternion().setFromAxisAngle(UP, piece[1]), new Vector3(1, 1, 1)));
      continue;
    }
    const modular = MODULES[solid.look];
    if (modular) {
      const [name, size, yaw, standing] = modular, [hx, hy, hz] = solid.half;
      const alongZ = hz >= hx, length = 2 * (alongZ ? hz : hx), width = 2 * (alongZ ? hx : hz);
      const count = Math.max(1, Math.round(length / size)), step = length / count;
      const turn = new Quaternion().setFromAxisAngle(UP, alongZ ? yaw : yaw - Math.PI / 2);
      for (let i = 0; i < count; i += 1) {
        const offset = -length / 2 + (i + 0.5) * step;
        const position = new Vector3(solid.center.x + (alongZ ? 0 : offset), standing ? solid.center.y - hy : solid.center.y, solid.center.z + (alongZ ? offset : 0));
        placer.place(name, new Matrix4().compose(position, turn, new Vector3(step / size, 1, standing ? 1 : width)));
      }
      continue;
    }
    const [hx, hy, hz] = solid.half, r = solid.rotation ?? IDENTITY;
    statics.add(solid.look, meterBox(hx * 2, hy * 2, hz * 2), new Matrix4().compose(new Vector3(solid.center.x, solid.center.y, solid.center.z), new Quaternion(r.x, r.y, r.z, r.w), new Vector3(1, 1, 1)));
  }
  // Railings along the solid railing boxes: a top and a middle rail on posts every 1.1 m,
  // modelled pieces stretched to fit (buildings.glb).
  for (const solid of solids) {
    if (solid.look !== "rail" && solid.look !== "stairRail") continue;
    const [hx, hy, hz] = solid.half, r = solid.rotation ?? IDENTITY, q = new Quaternion(r.x, r.y, r.z, r.w);
    const center = new Vector3(solid.center.x, solid.center.y, solid.center.z);
    const alongX = hx > hz, length = (alongX ? hx : hz) * 2;
    const bar = alongX ? q : q.clone().multiply(new Quaternion().setFromAxisAngle(UP, Math.PI / 2));
    for (const level of [hy, 0]) placer.place("rail_bar", new Matrix4().compose(center.clone().add(new Vector3(0, level, 0).applyQuaternion(q)), bar, new Vector3(length, 1, 1)));
    for (let a = -length / 2; a <= length / 2 + 0.01; a += 1.1) {
      const foot = new Vector3(alongX ? a : 0, -hy, alongX ? 0 : a).applyQuaternion(q);
      placer.place("rail_post", new Matrix4().compose(center.clone().add(foot), q, new Vector3(1, hy * 2, 1)));
    }
  }

  // A cornice along the top of every alley-facing wall, and a string course under the windows,
  // each one moulding stretched along the wall.
  for (const facade of facades) {
    const length = facade.to - facade.from, mid = (facade.from + facade.to) / 2;
    placer.place("cornice", wallMatrix(facade.face, facade.at, mid, facade.y1 + 1.6, 0, length));
    placer.place("string_course", wallMatrix(facade.face, facade.at, mid, facade.y0 - 1.55, 0, length));
  }

  // ---------- windows: breakable glass on every upper floor ----------
  const windowSpots: { x: number; y: number; z: number; face: Face; lit: number }[] = [];
  facades.forEach((facade, index) => {
    const r = seeded(index * 131 + 7);
    for (let a = facade.from + 1.7; a <= facade.to - 1.6; a += 3.4) for (let y = facade.y0; y <= facade.y1; y += 3.3) {
      const [nx, nz] = FACE_NORMAL[facade.face];
      windowSpots.push({ x: nx ? facade.at : a, y, z: nz ? facade.at : a, face: facade.face, lit: r() < facade.lit && !day ? 1 + Math.floor(r() * 8) : 0 });
    }
  });
  upperWindows.forEach(({ z }, index) => windowSpots.push({ x: 17, y: 5.9, z, face: "nx", lit: day ? 0 : 1 + index }));
  // Each window is a modelled unit (frame, reveal, sash bars, sill and lintel) with its glass
  // a card in front of the reveal, drawn in one of these looks.
  const windowGeometry = cardGeometry(kit, "card_window");
  // Unlit panes are dark glass reflecting the dusk; lit ones show a room, dim enough that its
  // pale walls and curtains keep their colour instead of burning out to white.
  const intensities = [0.45, 0.42, 0.45, 0.42, 0.45, 0.42, 0.42, 0.47];
  const glassLooks = [std({ color: 0x0e1318, roughness: 0.04, metalness: 0.9 }), ...intensities.map((intensity, kind) => {
    const room = own(windowInterior(kind));
    return std({ map: room, emissive: 0xffffff, emissiveMap: room, emissiveIntensity: intensity, roughness: 0.08, metalness: 0.2 });
  })];
  const counts = glassLooks.map(() => 0);
  for (const spot of windowSpots) counts[spot.lit] += 1;
  const glassMeshes = glassLooks.map((material, i) => { const mesh = new InstancedMesh(windowGeometry, material, Math.max(1, counts[i])); mesh.count = counts[i]; return mesh; });
  const refs = new Map<string, InstanceRef[]>();
  const entities: WorldEntity[] = [];
  const used = glassLooks.map(() => 0);
  const matrix = new Matrix4(), q = new Quaternion(), one = new Vector3(1, 1, 1);
  windowSpots.forEach((spot, index) => {
    const [nx, nz] = FACE_NORMAL[spot.face];
    const at = (out: number, up = 0): Vector3 => new Vector3(spot.x + nx * out, spot.y + up, spot.z + nz * out);
    q.setFromAxisAngle(UP, FACE_YAW[spot.face]);
    placer.place("window_unit", matrix.compose(at(0), q, one));
    const mesh = glassMeshes[spot.lit], slot = used[spot.lit]++;
    mesh.setMatrixAt(slot, matrix.compose(at(0.06), q, one));
    const id = `window:${index}`;
    refs.set(id, [{ mesh, index: slot }]);
    entities.push({ id, kind: "window", material: "glass", maxHealth: 1, yaw: Math.atan2(nx, nz), center: { x: spot.x, y: spot.y, z: spot.z } });
  });
  for (const mesh of glassMeshes) { mesh.receiveShadow = true; root.add(mesh); }

  // ---------- shopfronts, signs, doors and shutters ----------
  // Every sign is a kit piece built from signs.json (scripts/assets/families/signs.py): neon
  // tubes, lit boxes with raised letters and blade signs on brackets. Its lit parts glow in its
  // colours at its intensity, and go dark when it is shot out. Returns those lit materials.
  const SIGNS = new Map(signCatalog.signs.map((entry) => [entry.id, entry]));
  const placeSign = (id: string, mount: Matrix4, collider: { center: { x: number; y: number; z: number }; half: [number, number, number]; yaw: number }, lights?: number[]): MeshStandardMaterial[] => {
    const entry = SIGNS.get(id);
    const lit: MeshStandardMaterial[] = [];
    if (!entry) return lit;
    const object = kitObject(kit.get(`sign_${id}`), undefined, (material) => {
      if (!glowing(material)) return material;
      const color = (material as MeshStandardMaterial).color;
      const surface = std({ color, emissive: color, emissiveIntensity: entry.intensity, roughness: entry.style === "lightbox" ? 0.5 : 0.3 });
      lit.push(surface);
      return surface;
    });
    object.applyMatrix4(mount);
    root.add(object);
    // A round through a sign's face or tube puts it out.
    lamps.add(`lamp:${id}`, collider.center, { type: "box", half: collider.half }, collider.yaw, lit.map((material) => ({ kind: "material" as const, material, base: entry.intensity })), lights);
    return lit;
  };
  // A sign flat against a wall, centred on (x, y, z) and facing out of it.
  const sign = (id: string, x: number, y: number, z: number, face: Face, lights?: number[]): MeshStandardMaterial[] => {
    const entry = SIGNS.get(id), [nx, nz] = FACE_NORMAL[face];
    return placeSign(id, new Matrix4().compose(new Vector3(x, y, z), new Quaternion().setFromAxisAngle(UP, FACE_YAW[face]), new Vector3(1, 1, 1)),
      { center: { x: x + nx * 0.06, y, z: z + nz * 0.06 }, half: [(entry?.width ?? 1) / 2, (entry?.height ?? 1) / 2, 0.08], yaw: FACE_YAW[face] }, lights);
  };
  shopfronts.forEach((shop, index) => {
    const [nx, nz] = FACE_NORMAL[shop.face];
    const x = nx ? shop.at + nx * 0.04 : shop.along, z = nz ? shop.at + nz * 0.04 : shop.along;
    sign(`shop-sign-${index}`, x + nx * 0.02, 3.55, z + nz * 0.02, shop.face);
  });
  sign("kitchen-sign", -8.46, 4.05, 4.5, "px");
  sign("lantern-sign", 15.38, 3.55, 6.2, "nx", [lanternSignLight]);
  sign("banner", -4, 6.3, -23.5, "pz", [bannerLight]);
  sign("arch", -4, 5.6, 29.5, "nz", [archLight]);
  const openSign = sign("open", 17.24, 2.1, 3.4, "nx");
  sign("menu", -11.5, 2.4, 13.96, "nz");
  // Blade signs: a double-sided neon box standing out from the wall on a bracket.
  blades.forEach(([at, along, y, face], index) => {
    const [nx] = FACE_NORMAL[face], height = SIGNS.get(`blade-${index}`)?.height ?? 1;
    placeSign(`blade-${index}`, wallMatrix(face, at, along, y), { center: { x: at + nx * 0.5, y, z: along }, half: [0.31, height / 2, 0.06], yaw: 0 }, [bladeLights[index]]);
  });
  // Downpipes, air conditioners, meters, vents, back doors and fire escapes from the kit.
  dressFacades(placer, windowSpots, blades.map(([at, along, y, face, text]) => {
    const height = 0.42 * text.replace(/ /g, "").length + 0.36;
    return { face, at, along, y0: y - height / 2, y1: y + height / 2 };
  }));
  placeSteamPipes(placer);
  for (const [x, z, face] of [[-4, 29.95, "nz"], [12.75, 29.95, "nz"], [-4, -29.95, "pz"], [12.75, -29.95, "pz"]] as [number, number, Face][]) {
    placer.place("shutter", wallMatrix(face, Math.sign(z) * 30, x, 0));
  }
  // Paper posters on the walls (posters.json) and the SOFA mural in the service alley.
  for (const poster of posterCatalog.posters) placer.place(`poster_${poster.id}`, wallMatrix(poster.face as Face, poster.at, poster.along, poster.y, 0.004));
  placer.place("mural", wallMatrix("nx", 17, 21, 1.6, 0.002));

  // ---------- the record shop ----------
  ground("floor", 0.8, 8.2, -14.4, -6.6, 0.012);
  // Painted walls and a ceiling just in front of the block's own faces.
  const lining = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, look = "recordsWall"): void => statics.box(look, x1 - x0, y1 - y0, z1 - z0, (x0 + x1) / 2, y0, (z0 + z1) / 2);
  lining(0.8, 8.2, 0, 3.6, -14.4, -14.39);
  lining(0.8, 8.2, 0, 3.6, -6.61, -6.6);
  for (const [z0, z1, y0, y1] of [[-14.4, -13.9, 0, 3.6], [-13.9, -11.1, 0, 0.55], [-13.9, -11.1, 2.9, 3.6], [-11.1, -10.7, 0, 3.6], [-10.7, -9.1, 2.6, 3.6], [-9.1, -6.6, 0, 3.6]]) lining(0.8, 0.81, y0, y1, z0, z1);
  for (const [z0, z1, y0, y1] of [[-14.4, -11.8, 0, 3.6], [-11.8, -9.8, 0, 0.6], [-11.8, -9.8, 2.5, 3.6], [-9.8, -8.6, 0, 3.6], [-8.6, -7.6, 2.2, 3.6], [-7.6, -6.6, 0, 3.6]]) lining(8.19, 8.2, y0, y1, z0, z1);
  lining(0.8, 8.2, 3.58, 3.6, -14.4, -6.6, "plasterInside");
  for (const [x, z] of RECORD_BINS) placer.place("record_bin", new Matrix4().makeTranslation(x, 0, z));
  for (const x of [1.95, 3.8]) placer.place("record_shelf", wallMatrix("pz", -14.39, x, 0));
  for (const x of [1.95, 3.8, 5.65]) placer.place("record_shelf", wallMatrix("nz", -6.61, x, 0));
  placer.place("turntable", new Matrix4().compose(new Vector3(6.95, 1.0, -13.4), new Quaternion().setFromAxisAngle(UP, -Math.PI / 2), new Vector3(1, 1, 1)));
  placer.place("frame_steel", wallMatrix("px", 8.5, -8.1, 0));
  // Two pendants over the bins, their cords running up through the ceiling.
  const recordLamps = lampSet("pendant", [3.0, 6.0].map((x) => at(x, 3.3, -10.5)), materials.lampGlow);
  [3.0, 6.0].forEach((x, index) => lamps.add(`lamp:records-${index}`, { x, y: 3.3, z: -10.5 }, { type: "box", half: [0.17, 0.12, 0.17] }, 0, recordLamps.slice(index, index + 1), [recordsLights[index]]));
  // The boarded-up back window: planks a few rounds or a grenade will clear.
  refs.set("boards:records", placer.place("boards", wallMatrix("px", 8.5, -10.8, 1.55)));
  entities.push({ id: "boards:records", kind: "boards", material: "wood", maxHealth: 120, yaw: 0, center: { x: 8.35, y: 1.55, z: -10.8 }, shape: { type: "box", half: [0.15, 0.95, 1.0] } });

  // ---------- the shops beside it ----------
  const turned = (x: number, y: number, z: number, yaw: number, stretch = 1): Matrix4 => new Matrix4().compose(new Vector3(x, y, z), new Quaternion().setFromAxisAngle(UP, yaw), new Vector3(stretch, 1, 1));
  for (const room of SHOP_ROOMS) {
    ground("floor", SHOP_FRONT.inner, SHOP_BACK.inner, room.z0, room.z1, 0.012);
    lining(0.8, 8.2, 0, 3.6, room.z0, room.z0 + 0.01, room.inside);
    lining(0.8, 8.2, 0, 3.6, room.z1 - 0.01, room.z1, room.inside);
    for (const [z0, z1, y0, y1] of shopFrontWall(room)) lining(0.8, 0.81, y0, y1, z0, z1, room.inside);
    for (const [z0, z1, y0, y1] of shopBackWall(room)) lining(8.19, 8.2, y0, y1, z0, z1, room.inside);
    lining(0.8, 8.2, SHOP_CEILING - 0.02, SHOP_CEILING, room.z0, room.z1, "plasterInside");
    if ("door" in room.back) placer.place("frame_steel", wallMatrix("px", SHOP_BACK.outer, room.back.door, 0));
    else {
      const id = `boards:${room.id}`;
      refs.set(id, placer.place("boards", wallMatrix("px", SHOP_BACK.outer, room.back.boards, 1.55)));
      entities.push({ id, kind: "boards", material: "wood", maxHealth: 120, yaw: 0, center: { x: 8.35, y: 1.55, z: room.back.boards }, shape: { type: "box", half: [0.15, 0.95, 1.0] } });
    }
  }
  const shopLamps = lampSet("pendant", SHOP_LAMPS.map(({ x, z }) => at(x, 3.3, z)), materials.lampGlow);
  SHOP_LAMPS.forEach(({ id, room, x, z }, index) => lamps.add(`lamp:${id}`, { x, y: 3.3, z }, { type: "box", half: [0.17, 0.12, 0.17] }, 0, shopLamps.slice(index, index + 1), [shopLights.get(room)!]));
  // A kitchen line against the back wall: units laid north to south, each stretched to its length.
  const kitchenLine = (shop: KitPlacer, units: [string, number, number][]): void => { for (const [name, z, length] of units) shop.place(name, turned(7.8, 0, z, -Math.PI / 2, length / (name === "kitchen_range" ? 1.5 : 1))); };
  const shelf = (shop: KitPlacer, face: "pz" | "nz", wall: number, x: number, goods: [string, string]): void => {
    shop.place("pantry_shelf", wallMatrix(face, wall, x, 0));
    shop.place(goods[0], wallMatrix(face, wall, x - 0.4, 1.725, 0.02));
    shop.place(goods[1], wallMatrix(face, wall, x + 0.4, 2.275, 0.02));
  };
  // Boba: a bar with stools, a drinks fridge and a table by the window.
  bobaKit.place("boba_bar", turned(4.7, 0, 10.725, 0));
  bobaKit.place("drink_fridge", turned(6.2, 0, 14.25, Math.PI));
  shelf(bobaKit, "pz", 9.61, 4.4, ["goods_jars", "goods_bowls"]);
  bobaKit.place("menu_boba", wallMatrix("nz", 14.59, 3.4, 2.0));
  // Dumplings: a counter with steamers behind it, and two tables by the window.
  dumplingsKit.place("dumpling_counter", turned(5.95, 0, 22.4, -Math.PI / 2));
  kitchenLine(dumplingsKit, [["kitchen_counter", 21.175, 1.15], ["kitchen_range", 22.5, 1.5], ["kitchen_counter", 23.825, 1.15]]);
  for (const z of [22.1, 22.9]) dumplingsKit.place("steamer_stack", turned(7.8, 1.0, z, z));
  shelf(dumplingsKit, "nz", 24.39, 2.85, ["goods_sacks", "goods_tins"]);
  dumplingsKit.place("menu_dumplings", wallMatrix("nx", 8.19, 22.5, 2.0));
  // Pho: stockpots behind the counter, and dining tables.
  phoKit.place("pho_counter", turned(5.95, 0, -22.9, -Math.PI / 2));
  kitchenLine(phoKit, [["kitchen_counter", -24.025, 0.75], ["kitchen_range", -22.9, 1.5], ["kitchen_counter", -21.775, 0.75]]);
  phoKit.place("stock_pots", turned(7.8, 1.0, -22.9, 0));
  shelf(phoKit, "nz", -17.41, 5.8, ["goods_bowls", "goods_jars"]);
  phoKit.place("menu_pho", wallMatrix("nx", 8.19, -22.9, 2.0));

  // ---------- the shops of the outer blocks (shops.ts, SIDE_ROOMS) ----------
  const sideKit = new KitPlacer(kit);
  for (const room of SIDE_ROOMS) {
    const front = roomX(room, 0.3), back = room.deep, [x0, x1] = [front, back].sort((a, b) => a - b);
    ground("floor", x0, x1, room.z0, room.z1, 0.012);
    lining(x0, x1, 0, SHOP_CEILING, room.z0, room.z0 + 0.01, room.inside);
    lining(x0, x1, 0, SHOP_CEILING, room.z1 - 0.01, room.z1, room.inside);
    lining(Math.min(back, back - inward(room) * 0.01), Math.max(back, back - inward(room) * 0.01), 0, SHOP_CEILING, room.z0, room.z1, room.inside);
    const [f0, f1] = [front, front + inward(room) * 0.01].sort((a, b) => a - b);
    for (const [z0, z1, y0, y1] of sideFrontWall(room)) lining(f0, f1, y0, y1, z0, z1, room.inside);
    lining(x0, x1, SHOP_CEILING - 0.02, SHOP_CEILING, room.z0, room.z1, "plasterInside");
    const pendants = room.lamps.map(([depth, z]) => at(roomX(room, depth), 3.3, z));
    const glass = lampSet("pendant", pendants, materials.lampGlow);
    room.lamps.forEach(([depth, z], index) => lamps.add(`lamp:${room.id}-${index}`, { x: roomX(room, depth), y: 3.3, z }, { type: "box", half: [0.17, 0.12, 0.17] }, 0, glass.slice(index, index + 1), [sideLights.get(room.id)!]));
  }
  // The west rooms face east, onto the market alley: their counters and back walls turn that way.
  const east = Math.PI / 2;
  // Noodle bar: a counter across the room with stools before it, and behind it a cooking line of
  // stockpots on a range against the back wall, under the menu.
  sideKit.place("pho_counter", turned(-12.6, 0, 27.1, east));
  for (const [name, z, length] of [["kitchen_counter", 25.6, 0.8], ["kitchen_range", 27.1, 1.5], ["kitchen_counter", 28.6, 0.8]] as [string, number, number][]) sideKit.place(name, turned(-14.4, 0, z, east, length / (name === "kitchen_range" ? 1.5 : 1)));
  sideKit.place("stock_pots", turned(-14.4, 1.0, 27.1, 0));
  sideKit.place("menu_noodles", wallMatrix("px", -14.79, 27.1, 2.25));
  shelf(sideKit, "nz", 29.59, -10.6, ["goods_bowls", "goods_jars"]);
  // Tea house: shelves of tins on the back wall, the counter in front of them, and tables by the window.
  sideKit.place("tea_counter", turned(-13.0, 0, -27.0, east));
  for (const z of [-28.0, -26.0]) {
    sideKit.place("pantry_shelf", wallMatrix("px", -14.79, z, 0));
    sideKit.place("goods_jars", wallMatrix("px", -14.79, z - 0.4, 1.725, 0.02));
    sideKit.place("goods_tins", wallMatrix("px", -14.79, z + 0.4, 2.275, 0.02));
  }
  sideKit.place("menu_tea", wallMatrix("pz", -29.39, -12.2, 2.0));
  // Laundry: washers along the north wall with dryers stacked on them, and detergent on a shelf.
  for (let k = 0; k < 8; k += 1) for (const y of [0, 0.86]) sideKit.place("washer", wallMatrix("nz", -17.6, 17.75 + k * 0.66, y, 0.33));
  sideKit.place("pantry_shelf", wallMatrix("nx", 23.29, -20.6, 0));
  sideKit.place("goods_sacks", wallMatrix("nx", 23.29, -21.0, 1.725, 0.02));
  sideKit.place("goods_tins", wallMatrix("nx", 23.29, -20.2, 2.275, 0.02));

  // ---------- restaurant and bar interiors ----------
  // Pendants over the dining tables and the pass, and a lamp over the pool table.
  const pendants = lampSet("pendant", [...[-2, 2.4, 6.8].map((z) => at(-10.3, 2.86, z)), ...[1, 4.5, 8].map((z) => at(-12.2, 2.9, z, 0.88))], materials.lampGlow);
  [-2, 2.4, 6.8].forEach((z, index) => lamps.add(`lamp:pendant-${index}`, { x: -10.3, y: 2.86, z }, { type: "box", half: [0.17, 0.12, 0.17] }, 0, pendants.slice(index, index + 1), [pendantLights[index]]));
  [1, 4.5, 8].forEach((z, index) => lamps.add(`lamp:pass-${index}`, { x: -12.2, y: 2.9, z }, { type: "box", half: [0.15, 0.11, 0.15] }, 0, pendants.slice(3 + index, 4 + index)));
  // The kitchen's 15 m of twin shelving on the west wall, stocked with jars, tins, sacks and bowls.
  for (let k = 0; k < 8; k += 1) placer.place("pantry_shelf", wallMatrix("px", -14.975, -2 + 1.875 * (k + 0.5), 0));
  const GOODS = ["goods_jars", "goods_tins", "goods_sacks"];
  for (let k = 0, z = -1.8; z <= 12.8; k += 1, z += 0.9) {
    placer.place(GOODS[k % 3], wallMatrix("px", -14.975, z, 1.725, 0.02));
    if (k % 2 === 0) placer.place("goods_bowls", wallMatrix("px", -14.975, z + 0.45, 2.275, 0.02));
  }
  // Leather stools along the bar, and behind it the mirror, the shelf and its bottles.
  placer.place("back_bar", wallMatrix("nx", 24.5, 8.0, 0));
  lamps.add("lamp:pool-table", { x: 20.1, y: 2.96, z: 8.5 }, { type: "box", half: [0.26, 0.08, 0.26] }, 0, lampSet("billiard_lamp", [at(20.1, 2.96, 8.5)], materials.lampGlow), [barLight]);

  // ---------- stalls: wooden counters that break apart ----------
  const groups = new Map<string, Object3D[]>();
  // The stalls themselves come from the kit (stalls.ts); each keeps its lamp in a group of
  // its own, hidden when the stall comes down.
  const stallViews = new Stalls(placer, STALL_SPOTS);
  const wrecks = STALL_SPOTS.map((spot, index) => ({ id: `stall:${index}:wreck`, ...Stalls.wreck(spot) }));
  stalls.forEach((stall, index) => {
    const group = new Group();
    group.position.set(stall.x, 0, stall.z);
    group.rotation.y = stall.side > 0 ? 0 : Math.PI;
    // The stall's lamp hangs under the awning; it goes out with the stall or on its own.
    lamps.add(`lamp:stall-${index}`, { x: stall.x + stall.side * 0.3, y: 2.05, z: stall.z }, { type: "box", half: [0.08, 0.11, 0.08] }, 0, lampObject("cage_lamp", at(0.3, 2.05, 0), group), [stallLights[index]]);
    root.add(group);
    const id = `stall:${index}`;
    groups.set(id, [group]);
    // The whole stall is cover, counter to awning: pistol rounds stop in it, carbine rounds get through weakened.
    entities.push({ id, kind: "stall", material: "wood", maxHealth: 200, yaw: 0, center: { x: stall.x, y: 1.3, z: stall.z }, shape: { type: "box", half: [0.6, 1.3, 1.5] } });
  });

  // ---------- fire extinguishers that burst into powder ----------
  const extinguishers = EXTINGUISHERS.map(([face, at, along, y], index) => {
    const [nx, nz] = FACE_NORMAL[face];
    const id = `extinguisher:${index}`;
    const on = (out: number, up: number): { x: number; y: number; z: number } => (nx ? { x: at + nx * out, y: y + up, z: along } : { x: along, y: y + up, z: at + nz * out });
    refs.set(id, placer.place("extinguisher", wallMatrix(face, at, along, y)));
    entities.push({ id, kind: "extinguisher", material: "metal-thin", maxHealth: 6, yaw: 0, center: on(0.1, 0.32), shape: { type: "cylinder", halfHeight: 0.32, radius: 0.09 } });
    return { id, source: on(0.25, 0.4), wall: on(0, 0.4), out: { x: nx, y: 0, z: nz } };
  });

  // ---------- glass storefronts that shatter and can be climbed through ----------
  // Plate glass: drawn after the screen effects, in the clouds' pass (shopGlass.ts).
  const paneMaterial = std({ color: 0x9fb0b6, transparent: true, opacity: 0.05, depthWrite: false, side: DoubleSide });
  paneMaterial.name = SHOP_GLASS;
  panes.forEach((pane, index) => {
    const mesh = new Mesh(cardGeometry(kit, "card_unit"), paneMaterial);
    mesh.position.set(pane.x, (pane.y0 + pane.y1) / 2, (pane.z0 + pane.z1) / 2);
    mesh.scale.set(pane.z1 - pane.z0, pane.y1 - pane.y0, 1);
    mesh.rotation.y = Math.PI / 2;
    root.add(mesh);
    const id = `pane:${index}`;
    groups.set(id, [mesh]);
    entities.push({ id, kind: "pane", material: "glass", maxHealth: 1, yaw: 0, center: { x: pane.x, y: (pane.y0 + pane.y1) / 2, z: (pane.z0 + pane.z1) / 2 }, shape: { type: "box", half: [0.025, (pane.y1 - pane.y0) / 2, (pane.z1 - pane.z0) / 2] } });
  });

  // ---------- market alley dressing ----------
  // The food truck is a model of its own (foodTruck.ts).

  // ---------- service alley dressing ----------
  // Two pallets stacked by the door, the top one askew, and a manhole cover.
  placer.place("manhole", new Matrix4().makeTranslation(12.75, 0, -6));
  // Barn lamps on the service alley walls, their shades 0.36 m out: lit and dark glass, so a
  // broken one goes dark on its own.
  const sconceParts = lampSet("sconce", sconces.map((sconce) => sconce.x < 12 ? wallMatrix("px", 8.5, sconce.z, 3.6) : wallMatrix("nx", 17, sconce.z, 3.6)), materials.sconce);
  sconces.forEach((sconce, index) => {
    lamps.add(`lamp:sconce-${index}`, { x: sconce.x < 12 ? 8.86 : 16.64, y: 3.48, z: sconce.z }, { type: "box", half: [0.18, 0.13, 0.18] }, 0, sconceParts.slice(index, index + 1), [sconce.light]);
  });
  // A breaker box on the service alley wall: shoot it and the alley's string lights and wall
  // lamps go out, and its green light with them.
  const breakerBox = splitGlow(kit.get("breaker_box"));
  const breaker = kitObject(breakerBox.solid);
  breaker.applyMatrix4(wallMatrix("px", 8.5, -12.5, 1.55));
  const led = new Mesh(breakerBox.glow ?? new BufferGeometry(), std({ color: 0x000000, emissive: 0x4dff6a, emissiveIntensity: 3 }));
  breaker.add(led);
  root.add(breaker);

  // ---------- rooftops against the sky ----------
  tanks.forEach(([x, roof, z], index) => placer.place("water_tank", new Matrix4().compose(new Vector3(x, roof, z), new Quaternion().setFromAxisAngle(UP, index * 1.9 + 0.4), new Vector3(1, 1, 1))));
  // TV antennas, all aimed the same way at the same far transmitter; the model's mast is 4 m.
  for (const [x, roof, z, height] of [[-20, 16, -33, 4.5], [10, 16, -34, 3.2], [-15, 15, 33, 3.8], [21, 15, 34, 5], [-24, 12, 18, 3]]) {
    placer.place("antenna", new Matrix4().compose(new Vector3(x, roof, z), new Quaternion().setFromAxisAngle(UP, 0.6), new Vector3(1, height / 4, 1)));
  }

  // ---------- string lights, lanterns and cables ----------
  const bulbSpots: Vector3[] = [], spans: [Vector3, Vector3, number][] = [];
  const hang = (x0: number, z0: number, x1: number, z1: number, y: number, sag: number, spacing: number, thickness: number, onPoint?: (p: Vector3, t: number) => void): void => {
    const count = Math.max(4, Math.round(Math.hypot(x1 - x0, z1 - z0) / spacing));
    let previous: Vector3 | null = null;
    for (let i = 0; i <= count; i += 1) {
      const t = i / count, p = new Vector3(x0 + (x1 - x0) * t, y - sag * 4 * t * (1 - t), z0 + (z1 - z0) * t);
      onPoint?.(p, t);
      if (previous) spans.push([previous, p, thickness]);
      previous = p;
    }
  };
  // Each string is three runs of bulbs, one per light; a round anywhere along a run pops it.
  const runs: Vector3[][][] = strands.map(() => [[], [], []]);
  strands.forEach((strand, index) => hang(strand.x0, strand.z0, strand.x1, strand.z1, strand.y, strand.sag, 0.45, 1, (p, t) => {
    runs[index][Math.min(2, Math.floor(t * 3))].push(p);
    bulbSpots.push(p);
  }));
  for (const [x0, z0, x1, z1, y, sag] of cables) hang(x0, z0, x1, z1, y, sag, 1.2, 2.4);
  // Globe bulbs hanging from their sockets under the cable.
  const bulbParts = lampSet("bulb", bulbSpots.map((p) => at(p.x, p.y, p.z)), glow(0xffc070, 4.5));
  const serviceLamps: string[] = sconces.map((_, index) => `lamp:sconce-${index}`);
  let bulb = 0;
  runs.forEach((strandRuns, index) => strandRuns.forEach((run, k) => {
    const first = run[0], last = run[run.length - 1];
    const low = Math.min(...run.map((p) => p.y)), high = Math.max(...run.map((p) => p.y));
    const id = `lamp:bulbs-${index}-${k}`;
    const parts: LampPart[] = run.map(() => bulbParts[bulb++]).filter((part) => !!part);
    lamps.add(id, { x: (first.x + last.x) / 2, y: (low + high) / 2 - 0.08, z: (first.z + last.z) / 2 }, { type: "box", half: [Math.hypot(last.x - first.x, last.z - first.z) / 2 + 0.1, (high - low) / 2 + 0.12, 0.12] }, Math.atan2(-(last.z - first.z), last.x - first.x), parts, [strandLights[index][k]]);
    if (strands[index].x0 > 8) serviceLamps.push(id);
  }));
  lamps.add("lamp:breaker", { x: 8.62, y: 1.55, z: -12.5 }, { type: "box", half: [0.09, 0.35, 0.25] }, 0, [{ kind: "object", object: led }], [], { material: "metal-thin", maxHealth: 30, circuit: serviceLamps });
  // Every span is the kit's metre of cable, stretched and turned to fit; power lines are thicker.
  const toward = new Vector3(), turn = new Quaternion(), X_AXIS = new Vector3(1, 0, 0);
  for (const [from, to, thickness] of spans) placer.place("cable", new Matrix4().compose(from, turn.setFromUnitVectors(X_AXIS, toward.subVectors(to, from).normalize()), new Vector3(from.distanceTo(to), thickness, thickness)));
  const lanternSpots: { at: Vector3; color: number; phase: number; id: string }[] = [];
  lanternRows.forEach((z, row) => {
    for (let k = 0; k < 6; k += 1) {
      const at = new Vector3(-7.6 + k * 1.45, 4.6 - Math.sin(k / 5 * Math.PI) * 0.5, z), id = `lamp:lantern-${row}-${k}`;
      lanternSpots.push({ at, color: k % 2, phase: k * 1.7 + z, id });
      // Each row's two lights each stand for three lanterns.
      lamps.add(id, { x: at.x, y: at.y, z: at.z }, { type: "box", half: [0.23, 0.3, 0.23] }, 0, [], [lanternLights[row][k < 3 ? 0 : 1]]);
    }
  });
  // Paper lanterns, orange and red, and the scorched, torn ones they become when shot.
  const lanternMeshes = [0, 1].map((color) => {
    const spots = lanternSpots.filter((spot) => spot.color === color), paper = glow(color ? 0xff4a2a : 0xffa040, 2.6);
    const lit = instancedParts(kit.get("lantern"), spots.length, (material) => glowing(material) ? paper : material);
    const dark = instancedParts(kit.get("lantern_torn"), spots.length);
    root.add(...lit, ...dark);
    return { lit, dark, spots, paper, hue: color ? 0xc8402c : 0xd88a3c };
  });
  // Lanterns sway; a broken one hangs scorched and torn.
  const ONE = new Vector3(1, 1, 1);
  const swing = (seconds: number): void => {
    // Whole and torn lanterns are packed into their own meshes, so only those showing are drawn.
    for (const { lit, dark, spots } of lanternMeshes) {
      let whole = 0, torn = 0;
      for (const spot of spots) {
        const angle = Math.sin(seconds * 1.15 + spot.phase) * 0.07;
        q.setFromAxisAngle(new Vector3(1, 0, 0), angle);
        matrix.compose(new Vector3(spot.at.x, spot.at.y - Math.abs(angle) * 0.05, spot.at.z + angle * 0.35), q, ONE);
        if (lamps.torn(spot.id)) { for (const mesh of dark) mesh.setMatrixAt(torn, matrix); torn += 1; }
        else { for (const mesh of lit) mesh.setMatrixAt(whole, matrix); whole += 1; }
      }
      for (const mesh of lit) { mesh.count = whole; mesh.instanceMatrix.needsUpdate = true; }
      for (const mesh of dark) { mesh.count = torn; mesh.instanceMatrix.needsUpdate = true; }
    }
  };
  swing(0);

  // ---------- steam ----------
  const steamMaterial = new SpriteMaterial({ map: own(softSpot()), color: 0xd8d2cc, transparent: true, opacity: 0.11, depthWrite: false });
  const vents = [new Vector3(-5.3, 3.4, -26.6), new Vector3(-7.4, 1.25, 19.4), new Vector3(12.75, 0.1, -6)];
  const puffs = Array.from({ length: 27 }, (_, i) => {
    const sprite = new Sprite(steamMaterial);
    sprite.renderOrder = 3;
    root.add(sprite);
    return { sprite, vent: vents[i % vents.length], age: (i / 27) * 4, life: 3.4 + (i % 5) * 0.3, drift: ((i * 37) % 11 - 5) * 0.02 };
  });
  const steam = (dt: number): void => {
    for (const puff of puffs) {
      puff.age += dt;
      if (puff.age > puff.life) puff.age -= puff.life;
      const t = puff.age / puff.life;
      puff.sprite.position.set(puff.vent.x + puff.drift * puff.age * 3, puff.vent.y + puff.age * 0.42, puff.vent.z + Math.sin(puff.age * 1.3 + puff.drift * 40) * 0.15);
      puff.sprite.scale.setScalar(0.35 + t * 1.6);
    }
  };

  const poolMesh = (() => {
    const pools: [number, number, number, number][] = [
      ...[23, 15, 8, 1, -6, -13, -20].map((z) => [-4, z + 0.75, 4.2, 0xffa858] as [number, number, number, number]),
      ...stalls.map((stall) => [stall.x + stall.side * 0.6, stall.z, 2.4, 0xffb870] as [number, number, number, number]),
      ...[17, 7, -3, -13, -23].map((z) => [12.75, z + 1.25, 3.6, 0xff9a50] as [number, number, number, number]),
      [-10.3, 4, 4.5, 0xffc080], [20.4, 4, 4.2, 0xff8aa8], [-4, -24, 3.2, 0xffd0a0],
    ];
    const mesh = new InstancedMesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ map: own(softSpot()), transparent: true, blending: AdditiveBlending, depthWrite: false, opacity: 0.2 }), pools.length);
    const flat = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);
    pools.forEach(([x, z, size, color], i) => {
      mesh.setMatrixAt(i, matrix.compose(new Vector3(x, 0.03, z), flat, new Vector3(size * 2, size * 2, 1)));
      mesh.setColorAt(i, new Color(color));
    });
    mesh.renderOrder = 2;
    mesh.visible = false;
    root.add(mesh);
    return mesh;
  })();

  // Steel ladders and the bar's stair.
  addClimbing(placer, ladders, [stair]);
  // The sun reaches the street, so every kit piece throws a shadow: stalls, signs, air conditioners.
  placer.build(root, () => true);
  shopKit.build(root);
  sideKit.build(root);
  const doors = new Doors(root, kit);
  for (const [id, objects] of doors.groups) groups.set(id, objects);
  stallViews.show();
  const pipes = new SteamPipes(root);
  for (const item of extinguishers) pipes.addSource(item.id, item.source, item.wall, item.out, POWDER);

  // Puddles stay off the floors indoors.
  setIndoors(indoors);
  const surfaces: Mesh[] = [];
  statics.build(root, (look) => !["pavement", "asphalt", "floor", "photoCafe", "photoStone", "sconce", "lampGlow", "bottle"].includes(look), surfaces);

  // Movable props, numbered in a fixed order so ids match on every client.
  const models = new Map([...propModels, FUEL_DRUM, PALLET].map((model) => [model.name, model]));
  const props: WorldEntity[] = [];
  for (const [name, x, z, base, yaw] of propSpots) {
    const model = models.get(name);
    if (model) props.push(propEntity(`prop:${props.length}`, model, x, z, base, yaw));
  }
  for (const [name, x, z, yaw, tint] of furnitureSpots) {
    const model = FURNITURE.find((entry) => entry.name === name)!;
    props.push({ ...propEntity(`prop:${props.length}`, model, x, z, 0, yaw), tint });
  }

  let last = 0;
  return {
    refs, groups, entities: [...entities, ...lamps.entities, ...DOOR_ENTITIES, ...PIPE_ENTITIES, ...BREACH_ENTITIES], props, ladders, surfaces, lamps, lightSources: many, lightCones, doors, pipes, stalls: stallViews, wrecks,
    light(manyLights, lampsOn = true) {
      const lit = ([x, , z]: [number, number, number, number, number, number]): boolean => lampsOn || !outdoorAt(x, z);
      if (!lampsOn) {
        // Off: every lamp and sign but those inside rooms (pendants, the pass, the record shop,
        // the pool table and the shops' lamps). A sign's place can fall inside a room's floor plan,
        // so lamps are told apart by name, not by place.
        lamps.daylight((id) => !/^lamp:(pendant|pass|records|pool-table|boba|dumplings|pho|noodles|tea|laundry)-?/.test(id));
        // Unlit by day, a paper lantern is coloured paper with only the sky glowing through it.
        for (const { paper, hue } of lanternMeshes) { (paper as MeshStandardMaterial).color.setHex(hue); (paper as MeshStandardMaterial).emissiveIntensity = 0.12; }
      }
      const list = manyLights ? many : pointLights.map(([x, y, z, color, intensity]) => [x, y, z, color, intensity * LAMP_LEVEL, 16] as [number, number, number, number, number, number]);
      const points = list.map((source) => {
        if (!lit(source)) return null;
        const [x, y, z, color, intensity, distance] = source;
        const point = new PointLight(color, intensity, distance, 2);
        point.position.set(x, y, z);
        root.add(point);
        return point;
      });
      lamps.setLights(manyLights ? points : many.map(() => null));
      if (!manyLights) lamps.setKeyLights(points.filter((point): point is PointLight => !!point));
      poolMesh.visible = !manyLights && lampsOn;
    },
    update(seconds) {
      const dt = last ? Math.min(0.1, seconds - last) : 0;
      last = seconds;
      lamps.update(dt);
      swing(seconds);
      steam(dt);
      pipes.update(dt);
      // The OPEN sign's tube is failing: it stutters off now and then, until it is shot out.
      const tick = Math.floor(seconds * 14), roll = Math.abs(Math.sin(tick * 12.9898) * 43758.5453) % 1;
      if (!lamps.broken("lamp:open")) for (const tube of openSign) tube.emissiveIntensity = roll < 0.07 ? 0.2 : roll < 0.1 ? 1.2 : 3.0;
    },
    dispose() { for (const texture of owned) texture.dispose(); pipes.dispose(); },
  };
}
