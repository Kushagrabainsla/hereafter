import {
  AdditiveBlending, BoxGeometry, BufferGeometry, CanvasTexture, Color, CylinderGeometry, DoubleSide, Float32BufferAttribute, Group,
  InstancedMesh, LineBasicMaterial, LineSegments, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D,
  MeshStandardNodeMaterial, PlaneGeometry, PointLight, Quaternion, RepeatWrapping, SRGBColorSpace, Scene, SphereGeometry, Sprite, SpriteMaterial,
  Vector3, type Material as SurfaceMaterial,
} from "three/webgpu";
import { clamp, float, materialColor, materialRoughness, mix, mx_fractal_noise_float, mx_noise_float, positionWorld, smoothstep, vec3 } from "three/tsl";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { type Arena, type ArenaData, type LayoutBox, type MapLayout } from "./arena";
import { type Material } from "./materials";
import { type InstanceRef, type WorldEntity } from "./entities";
import { type SurfaceTextures } from "./surfaceTextures";
import { propEntity, type PropModel } from "./props";
import { addClimbing, STAIR_RISE, STAIR_RUN, type Ladder, type Stair } from "./climbing";
import { TRUCK_SOLIDS, TRUCK_TOGGLES } from "./foodTruck";
import { Lamps, type LampPart } from "./lamps";
import { KitPlacer, type KitPiece } from "./kit";
import { DOOR_ENTITIES, DOOR_TOGGLES, Doors } from "./doors";
import { dressFacades, wallMatrix } from "./facades";
import { PIPE_ENTITIES, placeSteamPipes, SteamPipes } from "./steamPipes";

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
interface Stall { x: number; z: number; side: 1 | -1 }
interface Pane { x: number; z0: number; z1: number; y0: number; y1: number }
interface Strand { x0: number; z0: number; x1: number; z1: number; y: number; sag: number }

const solids: LayoutBox[] = [];
const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };

function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, material: Material, look: string): void {
  solids.push({ half: [(x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2], center: { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: (z0 + z1) / 2 }, material, look });
}

// ---------- west block: two buildings and the restaurant between them ----------
box(-30, -8.5, 0, 12, 14, 30, "brick", "brickWarm");
box(-30, -8.5, 0, 11, -30, -6, "brick", "brickDark");
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
for (const z of [-2, 2.4, 6.8]) box(-10.7, -9.9, 0, 0.76, z - 0.4, z + 0.4, "wood", "woodTable");

// ---------- market alley ----------
for (const [x, z] of [[-4, 12.5], [-3.6, -4.5], [-4.2, -15]]) box(x - 0.55, x + 0.55, 0, 0.76, z - 0.55, z + 0.55, "wood", "woodTable");
// Food truck across the north end, with gaps either side: a hollow kitchen players can enter.
solids.push(...TRUCK_SOLIDS);
// Fire escape on the west building: a grated platform with railings, reached by a ladder.
box(-8.5, -7.1, 4.42, 4.6, -20.5, -14.5, "metal-thin", "grating");
box(-7.16, -7.1, 4.6, 5.65, -20.5, -17.7, "boundary", "rail");
box(-7.16, -7.1, 4.6, 5.65, -16.3, -14.5, "boundary", "rail");
box(-8.5, -7.1, 4.6, 5.65, -20.56, -20.5, "boundary", "rail");
box(-8.5, -7.1, 4.6, 5.65, -14.5, -14.44, "boundary", "rail");

// ---------- middle block, with a cut-through and passages at both ends ----------
box(0.5, 8.5, 0, 12, 4, 26, "brick", "brickRed");
box(0.5, 8.5, 0, 10, -26, -14.4, "brick", "plasterTeal");
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
box(17, 30, 0, 13, -30, -2, "brick", "plasterOchre");
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
  { face: "px", at: -8.5, along: 27, width: 5.2, photo: "cafe", sign: ["NOODLE BAR", "#18322f", "#ffd27a"] },
  { face: "px", at: -8.5, along: -27, width: 4.6, photo: "stone", sign: ["TEA HOUSE", "#2f1830", "#ffd2ef"] },
  { face: "nx", at: 0.5, along: 21.7, width: 5.2, photo: "stone", sign: ["DUMPLINGS", "#401818", "#ffe0a0"] },
  { face: "nx", at: 0.5, along: 11.9, width: 3.6, photo: "cafe", sign: ["BOBA", "#173a52", "#bfe9ff"] },
  { face: "nx", at: 0.5, along: -11.5, width: 4.4, photo: "cafe", sign: ["RECORDS", "#1b2240", "#c8e4ff"], open: true },
  { face: "nx", at: 0.5, along: -21, width: 4.6, photo: "stone", sign: ["PHO HOUSE", "#3a2a12", "#ffe6b0"] },
  { face: "nx", at: 17, along: -20, width: 4.6, photo: "stone", sign: ["LAUNDRY", "#e9e2d2", "#2d5a8a"] },
];

const stalls: Stall[] = [
  { x: -7.7, z: 19, side: 1 }, { x: -7.7, z: -10.5, side: 1 }, { x: -7.7, z: -22.5, side: 1 },
  { x: -0.3, z: 15.5, side: -1 }, { x: -0.3, z: 8.5, side: -1 }, { x: -0.3, z: -7.5, side: -1 }, { x: -0.3, z: -15.5, side: -1 },
];
const panes: Pane[] = [
  { x: -8.65, z0: 0.2, z1: 4.6, y0: 0.55, y1: 2.9 },
  { x: -8.65, z0: 5.4, z1: 9.8, y0: 0.55, y1: 2.9 },
  { x: 17.15, z0: 1.2, z1: 5.6, y0: 0.55, y1: 2.9 },
  { x: 0.65, z0: -13.9, z1: -11.1, y0: 0.55, y1: 2.9 },
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
    // Spare magazines, two to a pickup, on tables, counters and the high ground.
    { id: "mags-table-south", weapon: "pistol", item: "magazines", east: -4, north: 12.5, y: 0.76 },
    { id: "mags-dining", weapon: "pistol", item: "magazines", east: -10.3, north: -2, y: 0.76 },
    { id: "mags-bar", weapon: "pistol", item: "magazines", east: 21, north: 3.6, y: 1.1 },
    { id: "mags-cut", weapon: "pistol", item: "magazines", east: 2.2, north: -1.2 },
    { id: "mags-table-north", weapon: "rifle", item: "magazines", east: -4.2, north: -15, y: 0.76 },
    { id: "mags-fire-escape", weapon: "rifle", item: "magazines", east: -7.8, north: -19.4, y: 4.6 },
    { id: "mags-upstairs", weapon: "rifle", item: "magazines", east: 18.4, north: 8.8, y: 4.2 },
    { id: "mags-dumpster", weapon: "rifle", item: "magazines", east: 9.2, north: 11.5, y: 1.3 },
    { id: "mags-records", weapon: "pistol", item: "magazines", east: 6.95, north: -12.5, y: 1.0 },
  ],
  solids,
  toggles: [...TRUCK_TOGGLES, ...DOOR_TOGGLES],
};

// The low sun just above the rooftops to the west-southwest: where it lies from the market
// (any length), its colour and strength. The baked bounce light uses it too.
export const MARKET_SUN = { offset: [-220, 62, -60] as [number, number, number], color: 0xff9452, intensity: 1.1 };

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
function stripes(a: string, b: string): CanvasTexture {
  return canvasTexture(256, 64, (g, w, h) => {
    for (let i = 0; i < 8; i += 1) { g.fillStyle = i % 2 ? b : a; g.fillRect(i * w / 8, 0, w / 8 + 1, h); }
    // Weathering: a darker scalloped hem and faint creases.
    const hem = g.createLinearGradient(0, h * 0.7, 0, h);
    hem.addColorStop(0, "rgba(0,0,0,0)"); hem.addColorStop(1, "rgba(0,0,0,0.35)");
    g.fillStyle = hem; g.fillRect(0, 0, w, h);
  });
}
function planks(base: string, tile = 1): CanvasTexture {
  const r = seeded(base.length * 97 + base.charCodeAt(2));
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 32) {
      g.fillStyle = `rgba(0,0,0,${0.2 + r() * 0.15})`; g.fillRect(0, y, w, 3);
      for (let i = 0; i < 12; i += 1) { g.fillStyle = `rgba(255,220,180,${r() * 0.08})`; g.fillRect(0, y + 4 + r() * 26, w, 1); }
      for (let i = 0; i < 3; i += 1) { g.fillStyle = `rgba(30,15,5,${0.15 + r() * 0.2})`; g.beginPath(); g.ellipse(r() * w, y + 8 + r() * 18, 3 + r() * 5, 1.5 + r() * 2, 0, 0, 7); g.fill(); }
    }
  }, tile);
}
function tiles(): CanvasTexture {
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = "#b9bdb6"; g.fillRect(0, 0, w, h);
    const r = seeded(41);
    for (let y = 0; y < h; y += 32) for (let x = -64; x < w; x += 64) {
      const shade = 226 + Math.floor(r() * 18);
      g.fillStyle = `rgb(${shade},${shade + 2},${shade - 4})`;
      g.fillRect(x + 2 + (y / 32 % 2) * 32, y + 2, 60, 28);
    }
  }, 1);
}
function corrugated(color: string): CanvasTexture {
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = color; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 32) { g.fillStyle = "rgba(255,255,255,0.12)"; g.fillRect(x, 0, 8, h); g.fillStyle = "rgba(0,0,0,0.25)"; g.fillRect(x + 20, 0, 6, h); }
    const rust = g.createLinearGradient(0, h * 0.6, 0, h);
    rust.addColorStop(0, "rgba(90,50,30,0)"); rust.addColorStop(1, "rgba(90,50,30,0.45)");
    g.fillStyle = rust; g.fillRect(0, 0, w, h);
  }, 1.2);
}
function softSpot(): CanvasTexture {
  return canvasTexture(128, 128, (g, w, h) => {
    const gradient = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gradient.addColorStop(0, "rgba(255,255,255,0.9)"); gradient.addColorStop(0.4, "rgba(255,255,255,0.35)"); gradient.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gradient; g.fillRect(0, 0, w, h);
  });
}

// A sign as a colour map and an emissive map. Neon signs are tubes on a dark board: only the
// letters and the border glow. Lightboxes glow across the whole face. Vertical signs stack
// their letters.
interface SignStyle { neon: boolean; vertical?: boolean }
function signTextures(text: string, board: string, ink: string, width: number, height: number, style: SignStyle): [CanvasTexture, CanvasTexture] {
  const letters = style.vertical ? [...text.replace(/ /g, "")] : [text];
  const size = style.vertical ? Math.min(width * 0.62, height / letters.length * 0.8) : height * 0.56;
  const at = (i: number): [number, number] => style.vertical ? [width / 2, height * (i + 0.5) / letters.length] : [width / 2, height / 2 + size * 0.04];
  const lettering = (g: CanvasRenderingContext2D, glowing: boolean): void => {
    g.font = `${style.neon ? 600 : 700} ${Math.round(size)}px "Avenir Next Condensed", "Helvetica Neue", Helvetica, Arial, sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    if (style.neon) {
      const inset = Math.min(width, height) * 0.08, radius = Math.min(width, height) * 0.12;
      g.lineWidth = Math.max(2, Math.min(width, height) * 0.035);
      g.strokeStyle = ink;
      if (glowing) { g.shadowColor = ink; g.shadowBlur = Math.min(width, height) * 0.12; }
      g.beginPath();
      g.roundRect(inset, inset, width - inset * 2, height - inset * 2, radius);
      g.stroke();
      g.lineWidth = Math.max(2, size * 0.09);
      letters.forEach((letter, i) => { const [x, y] = at(i); g.strokeText(letter, x, y, width * 0.84); });
      g.shadowBlur = 0;
      // The bright core of each tube.
      g.lineWidth = Math.max(1, size * 0.035);
      g.strokeStyle = glowing ? "#ffffff" : ink;
      g.globalAlpha = glowing ? 0.8 : 0.5;
      letters.forEach((letter, i) => { const [x, y] = at(i); g.strokeText(letter, x, y, width * 0.84); });
      g.globalAlpha = 1;
    } else {
      g.fillStyle = ink;
      letters.forEach((letter, i) => { const [x, y] = at(i); g.fillText(letter, x, y, width * 0.9); });
    }
  };
  const color = canvasTexture(width, height, (g) => {
    g.fillStyle = board; g.fillRect(0, 0, width, height);
    if (!style.neon) {
      const shade = g.createLinearGradient(0, 0, 0, height);
      shade.addColorStop(0, "rgba(255,255,255,0.12)"); shade.addColorStop(1, "rgba(0,0,0,0.25)");
      g.fillStyle = shade; g.fillRect(0, 0, width, height);
    }
    lettering(g, false);
  });
  const glow = canvasTexture(width, height, (g) => {
    g.fillStyle = style.neon ? "#000000" : board; g.fillRect(0, 0, width, height);
    lettering(g, true);
  });
  return [color, glow];
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

function poster(lines: string[], background: string, ink: string, accent: string): CanvasTexture {
  return canvasTexture(192, 272, (g, w, h) => {
    g.fillStyle = background; g.fillRect(0, 0, w, h);
    g.fillStyle = accent; g.beginPath(); g.arc(w * 0.72, h * 0.3, w * 0.32, 0, 7); g.fill();
    g.fillStyle = ink; g.textAlign = "left"; g.textBaseline = "alphabetic";
    lines.forEach((line, i) => { g.font = `800 ${i === 0 ? 42 : 22}px Helvetica, Arial, sans-serif`; g.fillText(line, 12, h * 0.62 + i * (i === 0 ? 0 : 30) + (i > 0 ? 18 : 0), w - 20); });
    // Torn, weathered paper.
    for (let i = 0; i < 40; i += 1) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.06})`; g.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 20, 1 + Math.random() * 3); }
    g.fillStyle = "rgba(255,255,255,0.08)"; g.fillRect(0, 0, w, 6);
  });
}

function mural(): CanvasTexture {
  return canvasTexture(768, 384, (g, w, h) => {
    g.fillStyle = "#1d2433"; g.fillRect(0, 0, w, h);
    const blobs: [number, number, number, string][] = [[0.15, 0.6, 0.28, "#ff5f7a"], [0.42, 0.35, 0.24, "#ffb347"], [0.7, 0.62, 0.3, "#3fd0c9"], [0.9, 0.3, 0.2, "#9b6bff"]];
    for (const [x, y, r, c] of blobs) { g.fillStyle = c; g.beginPath(); g.ellipse(x * w, y * h, r * w * 0.6, r * h * 0.9, 0.4, 0, 7); g.fill(); }
    g.font = `900 ${Math.round(h * 0.55)}px "Arial Black", Helvetica, Arial, sans-serif`;
    g.textAlign = "center"; g.textBaseline = "middle";
    g.lineWidth = 14; g.strokeStyle = "#111318"; g.strokeText("SOFA", w / 2, h * 0.52);
    g.fillStyle = "#fff4d6"; g.fillText("SOFA", w / 2, h * 0.52);
    g.lineWidth = 4; g.strokeStyle = "#ff5f7a"; g.strokeText("SOFA", w / 2 + 6, h * 0.52 + 6);
    for (let i = 0; i < 24; i += 1) { const x = Math.random() * w; g.fillStyle = blobs[i % 4][3]; g.fillRect(x, h * 0.75, 3, 20 + Math.random() * 60); }
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
const posters: [number, number, number, Face, string[], string, string, string][] = [
  [8.5, 14.2, 1.7, "px", ["LIVE", "FRI · SAT", "THE LANTERN"], "#f2e3c4", "#2a1a14", "#ff6b4a"],
  [8.5, 22.6, 1.6, "px", ["LOST", "ORANGE CAT", "CALL 408"], "#fbf7ee", "#1e1e1e", "#ffb347"],
  [17, -14.0, 1.7, "nx", ["ART", "WALK", "1ST FRIDAY"], "#1f2a44", "#fff2d0", "#3fd0c9"],
  [8.5, -15.6, 1.6, "px", ["SOFA", "STREET FOOD", "EVERY NIGHT"], "#2b1420", "#ffd8a8", "#ff4f7d"],
  [-8.5, -13.4, 1.7, "px", ["NOODS", "OPEN LATE", "2 FOR $9"], "#ffe36e", "#2a1a14", "#e2453c"],
  // Inside the record shop.
  [-6.6, 7.4, 1.7, "nz", ["NEW", "ARRIVALS", "VINYL"], "#151515", "#f4e9d0", "#ff5a3c"],
  [8.2, -13.2, 1.8, "nx", ["LIVE DJ", "SAT 9PM", "NO COVER"], "#2b1d4a", "#ffe9c2", "#57e6ff"],
  [-14.4, 5.6, 1.8, "pz", ["CRATE", "DIGGERS", "WELCOME"], "#f2d64b", "#1e1e1e", "#d94f3d"],
];

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
  // Every breakable lamp and sign, and the lights they feed.
  lamps: Lamps;
  // Adds the market's lights: every lamp, bulb string, sign and lit shop when the renderer
  // can afford many lights, otherwise six key lights and painted pools of light.
  light: (many: boolean) => void;
  // Every lamp, bulb string, lantern and sign as [x, y, z, colour, intensity, distance],
  // whichever renderer draws them, so the first-person view can be lit like the spot it is in.
  lightSources: [number, number, number, number, number, number][];
  // Lanterns sway, a neon sign flickers and steam rises.
  update: (seconds: number) => void;
  dispose: () => void;
}

type NodeOptions = ConstructorParameters<typeof MeshStandardNodeMaterial>[0];

export function buildNightMarket(scene: Scene, textures: SurfaceTextures, propModels: PropModel[], kit = new Map<string, KitPiece>()): BuiltMap {
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
  const wet = smoothstep(0.16, 0.36, mx_fractal_noise_float(vec3(P.x.mul(0.13), float(0.7), P.z.mul(0.13))));
  const street = (options: NodeOptions): MeshStandardNodeMaterial => {
    const material = new MeshStandardNodeMaterial(options);
    material.colorNode = materialColor.mul(mix(float(1), float(0.55), wet));
    material.roughnessNode = mix(materialRoughness, float(0.035), wet);
    return material;
  };
  const brick = (color: number): MeshStandardNodeMaterial => wall({ map: textures.brick, normalMap: textures.brickNormal, color, roughness: 0.92 });
  const plaster = (color: number): MeshStandardNodeMaterial => wall({ map: textures.plaster, normalMap: textures.plasterNormal, color, roughness: 0.95 });
  const concrete = (color: number): MeshStandardNodeMaterial => wall({ map: textures.concrete, normalMap: textures.concreteNormal, color, roughness: 0.9 });
  const paint = (color: number, metalness = 0.2, roughness = 0.6): MeshStandardMaterial => std({ color, metalness, roughness });
  const glow = (color: number, intensity: number): MeshStandardMaterial => std({ color: 0x000000, emissive: color, emissiveIntensity: intensity });
  const wood = (base: string): MeshStandardMaterial => std({ map: own(planks(base)), roughness: 0.85 });
  const awnings = [["#c63c3c", "#f4e9d8"], ["#1f7a74", "#f1e7cf"], ["#e0a030", "#3b2a1e"], ["#3654a8", "#f2eee4"]].map(([a, b]) => std({ map: own(stripes(a, b)), roughness: 0.9, side: DoubleSide }));
  const materials: Record<string, SurfaceMaterial> = {
    brickWarm: brick(0xc9a48c), brickDark: brick(0x9b7d6a), brickRed: brick(0xb08a74), brickCap: brick(0xa88672),
    plasterCream: plaster(0xe6cfaa), plasterTeal: plaster(0xa8c0b9), plasterSand: plaster(0xd9b98f), plasterOchre: plaster(0xc9a46a), plasterInside: plaster(0xe8dcc6),
    concreteCap: concrete(0xb7b2aa), slab: concrete(0xbdb8b0),
    shopGreen: wall({ color: 0x1d3b36, metalness: 0.1, roughness: 0.55 }), barRed: wall({ color: 0x5a1a1f, metalness: 0.1, roughness: 0.55 }), tile: std({ map: own(tiles()), roughness: 0.3 }),
    woodDark: wood("#5e3b22"), woodBar: wood("#4a2a18"), woodTable: wood("#6e4a2c"), woodStall: wood("#8a5a35"), floor: wood("#7a5232"), pallet: wood("#9a7a52"), tank: wood("#5a4030"),
    poolTable: paint(0x1f6b3a, 0, 0.9), sofa: paint(0x6b2430, 0, 0.85),
    steel: paint(0x9aa3a8, 0.8, 0.3), steelDark: paint(0x3a3f44, 0.6, 0.45), dumpster: paint(0x2f5d3a, 0.4, 0.55), dumpsterLid: paint(0x1f3a26, 0.3, 0.6),
    grating: paint(0x3d4447, 0.7, 0.5), rail: paint(0x22262a, 0.5, 0.6), stairRail: paint(0x22262a, 0.5, 0.6),
    frame: paint(0xcfc6b4, 0, 0.7), mullion: paint(0x2a2622, 0.2, 0.6), sill: concrete(0xd8d0c0), recess: paint(0x07090c, 0, 1), door: paint(0x3a2a22, 0.1, 0.7), trim: concrete(0xcfc8ba),
    shutter: std({ map: own(corrugated("#7d8287")), metalness: 0.5, roughness: 0.5 }),
    stool: paint(0xb8432f, 0.1, 0.6),
    awning0: awnings[0], awning1: awnings[1], awning2: awnings[2], awning3: awnings[3],
    goods0: paint(0xe8b04a, 0, 0.8), goods1: paint(0xd3542f, 0, 0.8), goods2: paint(0x7fae4a, 0, 0.8), goods3: paint(0xf2e2c0, 0, 0.8),
    lampGlow: glow(0xffc27a, 4), sconce: glow(0xffb070, 3.5), bottle: glow(0x6fd0c0, 0.9),
    pavement: street({ map: textures.pavement, normalMap: textures.pavementNormal, color: 0xa29d97, roughness: 0.85 }),
    asphalt: street({ map: textures.asphalt, normalMap: textures.asphaltNormal, color: 0x7d7d7d, roughness: 0.92 }),
    photoCafe: std({ map: textures.storefrontCafe, emissive: 0xffffff, emissiveMap: textures.storefrontCafe, emissiveIntensity: 0.62, roughness: 0.15, metalness: 0.2 }),
    photoStone: std({ map: textures.storefrontStone, emissive: 0xffffff, emissiveMap: textures.storefrontStone, emissiveIntensity: 0.62, roughness: 0.15, metalness: 0.2 }),
    poster: std({ color: 0xffffff, roughness: 0.8 }),
    recordsFront: wall({ color: 0x1b2a4a, metalness: 0.1, roughness: 0.55 }), recordsWall: plaster(0x8a4a3a),
  };
  const statics = new Batch(materials);
  // ---------- lights ----------
  // The dense set, on renderers that cluster lights, each kept by its index so the lamps that
  // feed it can dim it when they break.
  const many: [number, number, number, number, number, number][] = [];
  const light = (entry: [number, number, number, number, number, number]): number => many.push(entry) - 1;
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
  light([-13.4, 3.1, -2, 0xfff0dd, 4, 6]);
  light([-13.4, 3.1, 9, 0xfff0dd, 4, 6]);
  const barLight = light([20.1, 3.4, 8.5, 0xff9ab0, 5, 7]);
  light([21.5, 3.4, 1.5, 0xffb070, 4, 6]);
  light([20.5, 6.9, 4, 0xffc887, 4, 7]);
  light([-3.6, 1.9, -24.0, 0xffdca8, 4, 5]);
  light([-4.6, 2.7, -26.0, 0xfff1dc, 1.6, 2.4]);
  const lamps = new Lamps(many);
  const darkGlass = std({ color: 0x2a2622, roughness: 0.25, metalness: 0.1 });
  // A lamp drawn as its own mesh, which swaps to dark glass when it breaks.
  const lampMesh = (geometry: BufferGeometry, x: number, y: number, z: number, parent: Object3D = root): LampPart => {
    const mesh = new Mesh(geometry, materials.lampGlow);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return { kind: "mesh", mesh, lit: materials.lampGlow, dark: darkGlass };
  };
  const root = new Group();
  root.name = "night-market";
  scene.add(root);

  // Ground: paving in the market alley and passages, asphalt in the service alley, wooden
  // floors indoors.
  // Ground is cut into 4 m tiles so the parts under buildings can be left out of the lightmap.
  const ground = (look: string, x0: number, x1: number, z0: number, z1: number, y: number): void => {
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

  // Every solid with a look is drawn as its box.
  for (const solid of solids) {
    if (solid.look === "none" || solid.look === "rail" || solid.look === "stairRail") continue;
    const [hx, hy, hz] = solid.half, r = solid.rotation ?? IDENTITY;
    statics.add(solid.look, meterBox(hx * 2, hy * 2, hz * 2), new Matrix4().compose(new Vector3(solid.center.x, solid.center.y, solid.center.z), new Quaternion(r.x, r.y, r.z, r.w), new Vector3(1, 1, 1)));
  }
  // Railings: a top and middle bar with posts, for the solid railing boxes.
  for (const solid of solids) {
    if (solid.look !== "rail" && solid.look !== "stairRail") continue;
    const [hx, hy, hz] = solid.half, r = solid.rotation ?? IDENTITY, q = new Quaternion(r.x, r.y, r.z, r.w);
    const center = new Vector3(solid.center.x, solid.center.y, solid.center.z);
    const alongX = hx > hz, length = (alongX ? hx : hz) * 2;
    for (const level of [hy, 0]) {
      const offset = new Vector3(0, level, 0).applyQuaternion(q);
      statics.add("rail", meterBox(alongX ? length : 0.05, 0.05, alongX ? 0.05 : length), new Matrix4().compose(center.clone().add(offset), q, new Vector3(1, 1, 1)));
    }
    for (let a = -length / 2; a <= length / 2 + 0.01; a += 1.1) {
      const offset = new Vector3(alongX ? a : 0, 0, alongX ? 0 : a).applyQuaternion(q);
      statics.add("rail", meterBox(0.04, hy * 2, 0.04), new Matrix4().compose(center.clone().add(offset), q, new Vector3(1, 1, 1)));
    }
  }

  // Cornices along the top of every alley-facing wall, and a string course under the windows.
  for (const facade of facades) {
    const [nx, nz] = FACE_NORMAL[facade.face], length = facade.to - facade.from, mid = (facade.from + facade.to) / 2;
    for (const [y, depth, height] of [[facade.y1 + 1.6, 0.35, 0.45], [facade.y0 - 1.55, 0.14, 0.18]]) {
      if (nx) statics.box("trim", depth, height, length, facade.at + nx * depth / 3, y, mid);
      else statics.box("trim", length, height, depth, mid, y, facade.at + nz * depth / 3);
    }
  }

  // ---------- windows: breakable glass on every upper floor ----------
  const windowSpots: { x: number; y: number; z: number; face: Face; lit: number }[] = [];
  facades.forEach((facade, index) => {
    const r = seeded(index * 131 + 7);
    for (let a = facade.from + 1.7; a <= facade.to - 1.6; a += 3.4) for (let y = facade.y0; y <= facade.y1; y += 3.3) {
      const [nx, nz] = FACE_NORMAL[facade.face];
      windowSpots.push({ x: nx ? facade.at : a, y, z: nz ? facade.at : a, face: facade.face, lit: r() < facade.lit ? 1 + Math.floor(r() * 8) : 0 });
    }
  });
  upperWindows.forEach(({ z }, index) => windowSpots.push({ x: 17, y: 5.9, z, face: "nx", lit: 1 + index }));
  const windowGeometry = new PlaneGeometry(1.38, 1.76);
  // Unlit panes are dark glass reflecting the dusk; lit ones show a room.
  const intensities = [0.8, 0.75, 0.8, 0.75, 0.8, 0.75, 0.75, 0.85];
  const glassLooks = [std({ color: 0x0e1318, roughness: 0.04, metalness: 0.9 }), ...intensities.map((intensity, kind) => {
    const room = own(windowInterior(kind));
    return std({ map: room, emissive: 0xffffff, emissiveMap: room, emissiveIntensity: intensity, roughness: 0.08, metalness: 0.2 });
  })];
  const counts = glassLooks.map(() => 0);
  for (const spot of windowSpots) counts[spot.lit] += 1;
  const glassMeshes = glassLooks.map((material, i) => { const mesh = new InstancedMesh(windowGeometry, material, Math.max(1, counts[i])); mesh.count = counts[i]; return mesh; });
  const crossGeometry = mergeGeometries([new BoxGeometry(0.05, 1.76, 0.04), new BoxGeometry(1.38, 0.05, 0.04).translate(0, 0.3, 0)], false)!;
  const frames = new InstancedMesh(new BoxGeometry(1.62, 2.0, 0.08), materials.frame, windowSpots.length);
  const mullions = new InstancedMesh(crossGeometry, materials.mullion, windowSpots.length);
  const sills = new InstancedMesh(new BoxGeometry(1.8, 0.09, 0.2), materials.sill, windowSpots.length);
  const lintels = new InstancedMesh(new BoxGeometry(1.8, 0.16, 0.08), materials.trim, windowSpots.length);
  const recesses = new InstancedMesh(windowGeometry, materials.recess, windowSpots.length);
  const refs = new Map<string, InstanceRef[]>();
  const entities: WorldEntity[] = [];
  const used = glassLooks.map(() => 0);
  const matrix = new Matrix4(), q = new Quaternion(), one = new Vector3(1, 1, 1);
  windowSpots.forEach((spot, index) => {
    const [nx, nz] = FACE_NORMAL[spot.face];
    const at = (out: number, up = 0): Vector3 => new Vector3(spot.x + nx * out, spot.y + up, spot.z + nz * out);
    q.setFromAxisAngle(UP, FACE_YAW[spot.face]);
    frames.setMatrixAt(index, matrix.compose(at(0), q, one));
    recesses.setMatrixAt(index, matrix.compose(at(0.045), q, one));
    mullions.setMatrixAt(index, matrix.compose(at(0.085), q, one));
    sills.setMatrixAt(index, matrix.compose(at(0.09, -1.05), q, one));
    lintels.setMatrixAt(index, matrix.compose(at(0.05, 1.08), q, one));
    const mesh = glassMeshes[spot.lit], slot = used[spot.lit]++;
    mesh.setMatrixAt(slot, matrix.compose(at(0.06), q, one));
    const id = `window:${index}`;
    refs.set(id, [{ mesh, index: slot }]);
    entities.push({ id, kind: "window", material: "glass", maxHealth: 1, yaw: Math.atan2(nx, nz), center: { x: spot.x, y: spot.y, z: spot.z } });
  });
  for (const mesh of [frames, recesses, mullions, sills, lintels, ...glassMeshes]) { mesh.receiveShadow = true; root.add(mesh); }

  // ---------- shopfronts, signs, doors and shutters ----------
  const signs: { mesh: Mesh; material: MeshStandardMaterial; base: number }[] = [];
  const sign = (text: string, board: string, ink: string, w: number, h: number, x: number, y: number, z: number, face: Face, intensity: number, style: SignStyle, lamp?: { id: string; lights?: number[] }): MeshStandardMaterial => {
    const px = 128, width = Math.min(2048, Math.round(px * (style.vertical ? 1 : w / h))), height = Math.min(2048, Math.round(px * (style.vertical ? h / w : 1)));
    const [map, emissiveMap] = signTextures(text, board, ink, width, height, style).map(own);
    const material = std({ map, emissive: 0xffffff, emissiveMap, emissiveIntensity: intensity, roughness: style.neon ? 0.35 : 0.5, side: DoubleSide });
    const mesh = new Mesh(new PlaneGeometry(w, h), material);
    mesh.position.set(x, y, z);
    mesh.rotation.y = FACE_YAW[face];
    signs.push({ mesh, material, base: intensity });
    root.add(mesh);
    // A round through a sign's face or tube puts it out.
    if (lamp) lamps.add(lamp.id, { x, y, z }, { type: "box", half: [w / 2, h / 2, 0.05] }, FACE_YAW[face], [{ kind: "material", material, base: intensity }], lamp.lights);
    return material;
  };
  shopfronts.forEach((shop, index) => {
    const [nx, nz] = FACE_NORMAL[shop.face];
    const x = nx ? shop.at + nx * 0.04 : shop.along, z = nz ? shop.at + nz * 0.04 : shop.along;
    if (!shop.open) statics.plane(shop.photo === "cafe" ? "photoCafe" : "photoStone", shop.width, 3.1, x, 1.6, z, shop.face);
    const neon = index % 2 === 1;
    sign(shop.sign[0], neon ? "#0b0a0f" : shop.sign[1], shop.sign[2], shop.width, 0.7, x + nx * 0.02, 3.55, z + nz * 0.02, shop.face, neon ? 2.6 : 0.95, { neon }, { id: `lamp:shop-sign-${index}` });
  });
  sign("SOFA KITCHEN", "#2b1d16", "#ffe2b0", 8, 0.75, -8.46, 4.05, 4.5, "px", 1.0, { neon: false }, { id: "lamp:kitchen-sign" });
  sign("THE LANTERN", "#0b0a0f", "#ff6fae", 4.2, 0.7, 15.38, 3.55, 6.2, "nx", 2.8, { neon: true }, { id: "lamp:lantern-sign", lights: [lanternSignLight] });
  sign("SOFA NIGHT MARKET", "#7a1f2b", "#ffe9c2", 7.6, 1.3, -4, 6.3, -23.5, "pz", 1.1, { neon: false }, { id: "lamp:banner", lights: [bannerLight] });
  sign("NIGHT MARKET", "#0b0a0f", "#ffcf5a", 7.2, 1.0, -4, 5.6, 29.5, "nz", 2.6, { neon: true }, { id: "lamp:arch", lights: [archLight] });
  const openSign = sign("OPEN", "#05070a", "#ff3d5a", 1.2, 0.5, 17.24, 2.1, 3.4, "nx", 3.0, { neon: true }, { id: "lamp:open" });
  sign("MENU", "#1a1a1a", "#ffe9b0", 1.8, 0.9, -11.5, 2.4, 13.96, "nz", 0.8, { neon: false }, { id: "lamp:menu" });
  // Blade signs: a bracket from the wall and a double-sided neon panel.
  blades.forEach(([at, along, y, face, text, color], index) => {
    const [nx] = FACE_NORMAL[face];
    const height = 0.42 * text.replace(/ /g, "").length + 0.36;
    const out = at + nx * 0.5;
    // Both faces go out together: one panel, one lamp.
    const faces = [1, -1].map((side) => sign(text, "#0b0a0f", color, 0.62, height, out, y, along + side * 0.035, side > 0 ? "pz" : "nz", 2.4, { neon: true, vertical: true }));
    lamps.add(`lamp:blade-${index}`, { x: out, y, z: along }, { type: "box", half: [0.31, height / 2, 0.06] }, 0, faces.map((material) => ({ kind: "material" as const, material, base: 2.4 })), [bladeLights[index]]);
    statics.box("steelDark", 0.66, height + 0.08, 0.06, out, y - height / 2 - 0.04, along);
    statics.box("steelDark", 0.55, 0.05, 0.05, at + nx * 0.27, y + height / 2 - 0.1, along);
  });
  // Downpipes, air conditioners, meters, vents, back doors and fire escapes from the kit.
  const placer = new KitPlacer(kit);
  dressFacades(placer, windowSpots, blades.map(([at, along, y, face, text]) => {
    const height = 0.42 * text.replace(/ /g, "").length + 0.36;
    return { face, at, along, y0: y - height / 2, y1: y + height / 2 };
  }));
  placeSteamPipes(placer);
  for (const [x, z, face] of [[-4, 29.95, "nz"], [12.75, 29.95, "nz"], [-4, -29.95, "pz"], [12.75, -29.95, "pz"]] as [number, number, Face][]) {
    statics.plane("shutter", 6, 3.6, x, 1.8, z, face);
    statics.box("trim", 6.6, 0.4, 0.3, x, 3.6, z);
  }
  // Posters and a mural at street level.
  const posterMaterials: MeshStandardMaterial[] = [];
  for (const [at, along, y, face, lines, background, ink, accent] of posters) {
    const [nx, nz] = FACE_NORMAL[face];
    const material = std({ map: own(poster(lines, background, ink, accent)), roughness: 0.85 });
    posterMaterials.push(material);
    const mesh = new Mesh(new PlaneGeometry(0.62, 0.88), material);
    mesh.position.set(nx ? at + nx * 0.03 : along, y, nz ? at + nz * 0.03 : along);
    mesh.rotation.y = FACE_YAW[face];
    mesh.receiveShadow = true;
    root.add(mesh);
  }
  const muralMesh = new Mesh(new PlaneGeometry(5.6, 2.8), std({ map: own(mural()), roughness: 0.75 }));
  muralMesh.position.set(16.97, 1.6, 21);
  muralMesh.rotation.y = FACE_YAW.nx;
  muralMesh.receiveShadow = true;
  root.add(muralMesh);

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
  [3.0, 6.0].forEach((x, index) => {
    statics.cylinder("steelDark", 0.006, 0.18, x, 3.4, -10.5, 4);
    lamps.add(`lamp:records-${index}`, { x, y: 3.3, z: -10.5 }, { type: "box", half: [0.17, 0.12, 0.17] }, 0, [lampMesh(new CylinderGeometry(0.05, 0.16, 0.22, 12), x, 3.3, -10.5)], [recordsLights[index]]);
  });
  // The boarded-up back window: planks a few rounds or a grenade will clear.
  refs.set("boards:records", placer.place("boards", wallMatrix("px", 8.5, -10.8, 1.55)));
  entities.push({ id: "boards:records", kind: "boards", material: "wood", maxHealth: 120, yaw: 0, center: { x: 8.35, y: 1.55, z: -10.8 }, shape: { type: "box", half: [0.15, 0.95, 1.0] } });

  // ---------- restaurant and bar interiors ----------
  for (const z of [-2, 2.4, 6.8]) {
    for (const [dx, dz] of [[-0.75, 0], [0.75, 0], [0, 0.7], [0, -0.7]]) statics.box("woodDark", 0.4, 0.45, 0.4, -10.3 + dx, 0, z + dz);
  }
  // Pendants over the dining tables and the pass, and a lamp over the pool table.
  [-2, 2.4, 6.8].forEach((z, index) => lamps.add(`lamp:pendant-${index}`, { x: -10.3, y: 2.86, z }, { type: "box", half: [0.17, 0.12, 0.17] }, 0, [lampMesh(new CylinderGeometry(0.05, 0.16, 0.22, 12), -10.3, 2.86, z)], [pendantLights[index]]));
  [1, 4.5, 8].forEach((z, index) => lamps.add(`lamp:pass-${index}`, { x: -12.2, y: 2.9, z }, { type: "box", half: [0.15, 0.11, 0.15] }, 0, [lampMesh(new CylinderGeometry(0.05, 0.14, 0.2, 12), -12.2, 2.9, z)]));
  statics.box("woodDark", 0.35, 0.05, 15, -14.8, 1.7, 5.5);
  statics.box("woodDark", 0.35, 0.05, 15, -14.8, 2.25, 5.5);
  for (let z = -1.8; z <= 12.8; z += 0.9) statics.box(Math.abs(z) % 1.8 < 0.9 ? "goods0" : "goods3", 0.25, 0.3, 0.3, -14.8, 1.75, z);
  for (let z = -0.4; z <= 4.8; z += 0.9) statics.cylinder("stool", 0.2, 0.75, 20.0, 0, z, 10);
  statics.box("woodBar", 0.3, 0.05, 3.6, 24.3, 2.0, 8.0);
  for (let z = 6.2; z <= 9.6; z += 0.35) statics.box("bottle", 0.08, 0.3, 0.08, 24.25, 2.05, z);
  lamps.add("lamp:pool-table", { x: 20.1, y: 2.96, z: 8.5 }, { type: "box", half: [0.26, 0.08, 0.26] }, 0, [lampMesh(new CylinderGeometry(0.08, 0.25, 0.12, 12), 20.1, 2.96, 8.5)], [barLight]);

  // ---------- stalls: wooden counters that break apart ----------
  const groups = new Map<string, Object3D[]>();
  stalls.forEach((stall, index) => {
    const group = new Group();
    group.position.set(stall.x, 0, stall.z);
    group.rotation.y = stall.side > 0 ? 0 : Math.PI;
    const parts = new Batch(materials);
    parts.box("woodStall", 1.2, 1.0, 3.0, 0, 0, 0);
    parts.box("woodStall", 0.08, 1.6, 3.0, -0.6, 1.0, 0);
    for (const [px, pz] of [[-0.55, 1.45], [-0.55, -1.45], [0.55, 1.45], [0.55, -1.45]]) parts.box("woodStall", 0.08, px < 0 ? 2.8 : 2.4, 0.08, px, 0, pz);
    const awning = meterBox(2.1, 0.04, 3.5);
    awning.applyMatrix4(new Matrix4().makeRotationZ(-0.28));
    parts.add(`awning${index % 4}`, awning, new Matrix4().makeTranslation(0.35, 2.47, 0));
    for (let k = 0; k < 5; k += 1) parts.box(`goods${(k + index) % 4}`, 0.34, 0.16 + (k % 2) * 0.1, 0.44, 0.15, 1.0, -1.1 + k * 0.55);
    for (let k = 0; k < 3; k += 1) parts.box(`goods${(k + index + 1) % 4}`, 0.2, 0.26, 0.2, -0.45, 1.65, -0.9 + k * 0.9);
    parts.build(group);
    // The stall's lamp hangs under the awning; it goes out with the stall or on its own.
    lamps.add(`lamp:stall-${index}`, { x: stall.x + stall.side * 0.3, y: 2.05, z: stall.z }, { type: "box", half: [0.08, 0.11, 0.08] }, 0, [lampMesh(new BoxGeometry(0.14, 0.2, 0.14), 0.3, 2.05, 0, group)], [stallLights[index]]);
    root.add(group);
    const id = `stall:${index}`;
    groups.set(id, [group]);
    // The whole stall is cover, counter to awning: pistol rounds stop in it, carbine rounds get through weakened.
    entities.push({ id, kind: "stall", material: "wood", maxHealth: 200, yaw: 0, center: { x: stall.x, y: 1.3, z: stall.z }, shape: { type: "box", half: [0.6, 1.3, 1.5] } });
  });

  // ---------- glass storefronts that shatter and can be climbed through ----------
  const paneMaterial = std({ color: 0xa9c4cf, roughness: 0.03, metalness: 0.4, transparent: true, opacity: 0.18, depthWrite: false, side: DoubleSide });
  panes.forEach((pane, index) => {
    const mesh = new Mesh(new PlaneGeometry(pane.z1 - pane.z0, pane.y1 - pane.y0), paneMaterial);
    mesh.position.set(pane.x, (pane.y0 + pane.y1) / 2, (pane.z0 + pane.z1) / 2);
    mesh.rotation.y = Math.PI / 2;
    root.add(mesh);
    const id = `pane:${index}`;
    groups.set(id, [mesh]);
    entities.push({ id, kind: "pane", material: "glass", maxHealth: 1, yaw: 0, center: { x: pane.x, y: (pane.y0 + pane.y1) / 2, z: (pane.z0 + pane.z1) / 2 }, shape: { type: "box", half: [0.025, (pane.y1 - pane.y0) / 2, (pane.z1 - pane.z0) / 2] } });
  });

  // ---------- market alley dressing ----------
  for (const [x, z] of [[-4, 12.5], [-3.6, -4.5], [-4.2, -15]]) {
    for (let k = 0; k < 3; k += 1) { const a = k / 3 * Math.PI * 2 + 0.4; statics.cylinder("stool", 0.18, 0.45, x + Math.cos(a) * 0.95, 0, z + Math.sin(a) * 0.95, 12); }
  }
  // The food truck is a model of its own (foodTruck.ts).

  // ---------- service alley dressing ----------
  for (const solid of solids.filter((item) => item.look === "dumpster")) statics.box("dumpsterLid", solid.half[0] * 2 + 0.1, 0.08, solid.half[2] * 2 + 0.1, solid.center.x, solid.center.y + solid.half[1], solid.center.z);
  statics.box("pallet", 1.2, 0.15, 1.0, 15.8, 0, 18);
  statics.box("pallet", 1.2, 0.15, 1.0, 15.8, 0.15, 18.1);
  statics.cylinder("steelDark", 0.35, 0.03, 12.75, 0, -6, 20);
  // Wall lamps, lit and dark copies: a broken one moves to the dark set.
  const sconceLit = new InstancedMesh(new BoxGeometry(0.25, 0.3, 0.4), materials.sconce, sconces.length);
  const sconceDark = new InstancedMesh(sconceLit.geometry, darkGlass, sconces.length);
  sconces.forEach((sconce, index) => {
    sconceLit.setMatrixAt(index, matrix.makeTranslation(sconce.x, 3.45, sconce.z));
    sconceDark.setMatrixAt(index, matrix.makeScale(0, 0, 0));
    lamps.add(`lamp:sconce-${index}`, { x: sconce.x, y: 3.45, z: sconce.z }, { type: "box", half: [0.13, 0.15, 0.2] }, 0, [{ kind: "instance", lit: sconceLit, dark: sconceDark, index }], [sconce.light]);
  });
  root.add(sconceLit, sconceDark);
  // A breaker box on the service alley wall: shoot it and the alley's string lights and wall
  // lamps go out.
  const breaker = new Group();
  breaker.position.set(8.62, 1.55, -12.5);
  const panel = new Mesh(new BoxGeometry(0.18, 0.7, 0.5), materials.steelDark);
  const led = new Mesh(new BoxGeometry(0.02, 0.04, 0.04), std({ color: 0x000000, emissive: 0x4dff6a, emissiveIntensity: 3 }));
  led.position.set(0.1, 0.25, 0.16);
  const conduit = new Mesh(new CylinderGeometry(0.03, 0.03, 2.2, 8), materials.steelDark);
  conduit.position.set(-0.04, 1.45, 0.12);
  breaker.add(panel, led, conduit);
  root.add(breaker);

  // ---------- rooftops against the sky ----------
  for (const [x, roof, z] of tanks) {
    for (const [dx, dz] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]]) statics.box("steelDark", 0.12, 1.6, 0.12, x + dx, roof, z + dz);
    statics.cylinder("tank", 1.15, 2.0, x, roof + 1.6, z, 16);
    statics.cylinder("steelDark", 1.25, 0.7, x, roof + 3.6, z, 16, 0.08);
  }
  for (const [x, roof, z, height] of [[-20, 16, -33, 4.5], [10, 16, -34, 3.2], [-15, 15, 33, 3.8], [21, 15, 34, 5], [-24, 12, 18, 3]]) {
    statics.box("steelDark", 0.08, height, 0.08, x, roof, z);
    statics.box("steelDark", 1.2, 0.04, 0.04, x, roof + height * 0.8, z);
  }

  // ---------- string lights, lanterns and cables ----------
  const bulbSpots: Vector3[] = [], wires: number[] = [];
  const hang = (x0: number, z0: number, x1: number, z1: number, y: number, sag: number, spacing: number, onPoint?: (p: Vector3, t: number) => void): void => {
    const count = Math.max(4, Math.round(Math.hypot(x1 - x0, z1 - z0) / spacing));
    let previous: Vector3 | null = null;
    for (let i = 0; i <= count; i += 1) {
      const t = i / count, p = new Vector3(x0 + (x1 - x0) * t, y - sag * 4 * t * (1 - t), z0 + (z1 - z0) * t);
      onPoint?.(p, t);
      if (previous) wires.push(previous.x, previous.y, previous.z, p.x, p.y, p.z);
      previous = p;
    }
  };
  // Each string is three runs of bulbs, one per light; a round anywhere along a run pops it.
  const runs: Vector3[][][] = strands.map(() => [[], [], []]);
  strands.forEach((strand, index) => hang(strand.x0, strand.z0, strand.x1, strand.z1, strand.y, strand.sag, 0.45, (p, t) => {
    runs[index][Math.min(2, Math.floor(t * 3))].push(p);
    bulbSpots.push(p);
  }));
  for (const [x0, z0, x1, z1, y, sag] of cables) hang(x0, z0, x1, z1, y, sag, 1.2);
  const bulbs = new InstancedMesh(new SphereGeometry(0.05, 8, 6), glow(0xffc070, 4.5), bulbSpots.length);
  const deadBulbs = new InstancedMesh(bulbs.geometry, darkGlass, bulbSpots.length);
  bulbSpots.forEach((p, i) => { bulbs.setMatrixAt(i, matrix.makeTranslation(p.x, p.y - 0.08, p.z)); deadBulbs.setMatrixAt(i, matrix.makeScale(0, 0, 0)); });
  root.add(bulbs, deadBulbs);
  const serviceLamps: string[] = sconces.map((_, index) => `lamp:sconce-${index}`);
  let bulb = 0;
  runs.forEach((strandRuns, index) => strandRuns.forEach((run, k) => {
    const first = run[0], last = run[run.length - 1];
    const low = Math.min(...run.map((p) => p.y)), high = Math.max(...run.map((p) => p.y));
    const id = `lamp:bulbs-${index}-${k}`;
    const parts: LampPart[] = run.map(() => ({ kind: "instance" as const, lit: bulbs, dark: deadBulbs, index: bulb++ }));
    lamps.add(id, { x: (first.x + last.x) / 2, y: (low + high) / 2 - 0.08, z: (first.z + last.z) / 2 }, { type: "box", half: [Math.hypot(last.x - first.x, last.z - first.z) / 2 + 0.1, (high - low) / 2 + 0.12, 0.12] }, Math.atan2(-(last.z - first.z), last.x - first.x), parts, [strandLights[index][k]]);
    if (strands[index].x0 > 8) serviceLamps.push(id);
  }));
  lamps.add("lamp:breaker", { x: 8.62, y: 1.55, z: -12.5 }, { type: "box", half: [0.09, 0.35, 0.25] }, 0, [{ kind: "object", object: led }], [], { material: "metal-thin", maxHealth: 30, circuit: serviceLamps });
  const wireGeometry = new BufferGeometry();
  wireGeometry.setAttribute("position", new Float32BufferAttribute(wires, 3));
  root.add(new LineSegments(wireGeometry, new LineBasicMaterial({ color: 0x15161a })));
  const lanternSpots: { at: Vector3; color: number; phase: number; id: string }[] = [];
  lanternRows.forEach((z, row) => {
    for (let k = 0; k < 6; k += 1) {
      const at = new Vector3(-7.6 + k * 1.45, 4.6 - Math.sin(k / 5 * Math.PI) * 0.5, z), id = `lamp:lantern-${row}-${k}`;
      lanternSpots.push({ at, color: k % 2, phase: k * 1.7 + z, id });
      // Each row's two lights each stand for three lanterns.
      lamps.add(id, { x: at.x, y: at.y, z: at.z }, { type: "box", half: [0.23, 0.3, 0.23] }, 0, [], [lanternLights[row][k < 3 ? 0 : 1]]);
    }
  });
  const torn = std({ color: 0x3a1a14, roughness: 0.9, side: DoubleSide });
  const lanternMeshes = [0, 1].map((color) => {
    const spots = lanternSpots.filter((spot) => spot.color === color);
    const geometry = new SphereGeometry(0.22, 14, 10);
    const mesh = new InstancedMesh(geometry, glow(color ? 0xff4a2a : 0xffa040, 2.6), spots.length);
    const dark = new InstancedMesh(geometry, torn, spots.length);
    root.add(mesh, dark);
    return { mesh, dark, spots };
  });
  // Lanterns sway; a broken one hangs dark and torn.
  const hidden = new Matrix4().makeScale(0, 0, 0);
  const swing = (seconds: number): void => {
    for (const { mesh, dark, spots } of lanternMeshes) {
      spots.forEach((spot, i) => {
        const angle = Math.sin(seconds * 1.15 + spot.phase) * 0.07;
        q.setFromAxisAngle(new Vector3(1, 0, 0), angle);
        matrix.compose(new Vector3(spot.at.x, spot.at.y - Math.abs(angle) * 0.05, spot.at.z + angle * 0.35), q, new Vector3(1, 1.25, 1));
        const out = lamps.dark(spot.id);
        mesh.setMatrixAt(i, out ? hidden : matrix);
        dark.setMatrixAt(i, out ? matrix.clone().multiply(new Matrix4().makeScale(0.9, 0.75, 0.9)) : hidden);
      });
      mesh.instanceMatrix.needsUpdate = true;
      dark.instanceMatrix.needsUpdate = true;
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

  // Only the fire escapes stand high enough in the low sun to throw shadows worth drawing.
  placer.build(root, (name) => name.startsWith("escape"));
  const doors = new Doors(root, kit);
  for (const [id, objects] of doors.groups) groups.set(id, objects);
  const pipes = new SteamPipes(root);

  addClimbing(scene, ladders, [stair]);
  const surfaces: Mesh[] = [];
  statics.build(root, (look) => !["pavement", "asphalt", "floor", "photoCafe", "photoStone", "shutter", "sconce", "lampGlow", "bottle"].includes(look), surfaces);

  // Movable props, numbered in a fixed order so ids match on every client.
  const models = new Map(propModels.map((model) => [model.name, model]));
  const props: WorldEntity[] = [];
  for (const [name, x, z, base, yaw] of propSpots) {
    const model = models.get(name);
    if (model) props.push(propEntity(`prop:${props.length}`, model, x, z, base, yaw));
  }

  let last = 0;
  return {
    refs, groups, entities: [...entities, ...lamps.entities, ...DOOR_ENTITIES, ...PIPE_ENTITIES], props, ladders, surfaces, lamps, lightSources: many, doors, pipes,
    light(manyLights) {
      const list = manyLights ? many : pointLights.map(([x, y, z, color, intensity]) => [x, y, z, color, intensity, 16] as [number, number, number, number, number, number]);
      const points = list.map(([x, y, z, color, intensity, distance]) => {
        const point = new PointLight(color, intensity, distance, 2);
        point.position.set(x, y, z);
        root.add(point);
        return point;
      });
      lamps.setLights(manyLights ? points : many.map(() => null));
      if (!manyLights) lamps.setKeyLights(points);
      poolMesh.visible = !manyLights;
    },
    update(seconds) {
      const dt = last ? Math.min(0.1, seconds - last) : 0;
      last = seconds;
      lamps.update(dt);
      swing(seconds);
      steam(dt);
      doors.update(dt);
      pipes.update(dt);
      // The OPEN sign's tube is failing: it stutters off now and then, until it is shot out.
      const tick = Math.floor(seconds * 14), roll = Math.abs(Math.sin(tick * 12.9898) * 43758.5453) % 1;
      if (!lamps.broken("lamp:open")) openSign.emissiveIntensity = roll < 0.07 ? 0.2 : roll < 0.1 ? 1.2 : 3.0;
    },
    dispose() { for (const texture of owned) texture.dispose(); pipes.dispose(); },
  };
}
