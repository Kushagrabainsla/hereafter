import {
  AdditiveBlending, BoxGeometry, BufferGeometry, CanvasTexture, Color, CylinderGeometry, DoubleSide, Float32BufferAttribute, Group,
  InstancedMesh, LineBasicMaterial, LineSegments, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D,
  PlaneGeometry, PointLight, Quaternion, RepeatWrapping, SRGBColorSpace, Scene, SphereGeometry, Vector3, type Material as SurfaceMaterial,
} from "three/webgpu";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { type ArenaData, type LayoutBox, type MapLayout } from "./arena";
import { type Material } from "./materials";
import { type WorldEntity } from "./entities";
import { type InstanceRef } from "./scenery";
import { type SurfaceTextures } from "./surfaceTextures";
import { propEntity, type PropModel } from "./props";
import { addRoofAccess, type Ladder, type Stair } from "./rooftops";

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
interface Shopfront { face: Face; at: number; along: number; width: number; photo: "cafe" | "stone"; sign: [text: string, background: string, ink: string] }
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
// Food truck across the north end, with gaps either side.
box(-7.1, -0.9, 0.3, 3.05, -27.2, -24.8, "metal-thin", "none");
// Fire escape on the west building: a grated platform with railings, reached by a ladder.
box(-8.5, -7.1, 4.42, 4.6, -20.5, -14.5, "metal-thin", "grating");
box(-7.16, -7.1, 4.6, 5.65, -20.5, -17.7, "boundary", "rail");
box(-7.16, -7.1, 4.6, 5.65, -16.3, -14.5, "boundary", "rail");
box(-8.5, -7.1, 4.6, 5.65, -20.56, -20.5, "boundary", "rail");
box(-8.5, -7.1, 4.6, 5.65, -14.5, -14.44, "boundary", "rail");

// ---------- middle block, with a cut-through and passages at both ends ----------
box(0.5, 8.5, 0, 12, 4, 26, "brick", "brickRed");
box(0.5, 8.5, 0, 10, -26, -2, "brick", "plasterTeal");

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
const STAIR_RISE = 0.18, STAIR_RUN = 0.28;
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
  { face: "nx", at: 0.5, along: -11.5, width: 4.4, photo: "cafe", sign: ["RECORDS", "#1b2240", "#c8e4ff"] },
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
// A few real lights; strings, lanterns and signs glow without lighting anything.
const pointLights: [number, number, number, number, number][] = [
  [-4, 4.6, 14, 0xffb066, 30], [-4, 4.6, -9, 0xffb066, 30], [-11.6, 3.1, 4, 0xffc887, 18],
  [20.2, 3.4, 4, 0xff9ab0, 10], [12.75, 4.2, 12, 0xffa860, 26], [12.75, 4.2, -14, 0xffa860, 26],
];

export const NIGHT_MARKET: MapLayout = {
  id: "night-market",
  name: "Night Market",
  sky: "dusk",
  spawns: [
    { east: -4, north: 27.6, heading: 180 }, { east: 12.75, north: -27.6, heading: 0 },
    { east: -4, north: -28.6, heading: 0 }, { east: 12.75, north: 27.6, heading: 180 },
    { east: -6.5, north: 27.6, heading: 180 }, { east: 15, north: -27.6, heading: 0 },
    { east: 4.5, north: -28, heading: 0 }, { east: 4.5, north: 28, heading: 180 },
  ],
  pickups: [
    { id: "pistol-south", weapon: "pistol", east: -4, north: 22.5 },
    { id: "pistol-north", weapon: "pistol", east: 12.75, north: -21.5 },
    { id: "rifle-cut", weapon: "rifle", east: 4.5, north: 1 },
    { id: "rifle-kitchen", weapon: "rifle", east: -13.45, north: 3.6 },
  ],
  solids,
};

export function nightMarketData(): ArenaData {
  return {
    version: 1,
    center: { latitude: 0, longitude: 0 },
    extentMeters: 80,
    source: { osm: "", osmLicense: "", osmLicenseUrl: "", osmAttribution: "", elevation: "", elevationLicense: "" },
    elevation: { gridSize: 5, meters: new Array(25).fill(0), baseMeters: 0 },
    buildings: [], roads: [], parks: [], trees: [],
    layout: NIGHT_MARKET,
  };
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
  return canvasTexture(256, 64, (g, w, h) => { for (let i = 0; i < 8; i += 1) { g.fillStyle = i % 2 ? b : a; g.fillRect(i * w / 8, 0, w / 8 + 1, h); } });
}
function planks(base: string, tile = 1): CanvasTexture {
  const r = seeded(base.length * 97 + base.charCodeAt(2));
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 32) {
      g.fillStyle = `rgba(0,0,0,${0.2 + r() * 0.15})`; g.fillRect(0, y, w, 3);
      for (let i = 0; i < 12; i += 1) { g.fillStyle = `rgba(255,220,180,${r() * 0.08})`; g.fillRect(0, y + 4 + r() * 26, w, 1); }
    }
  }, tile);
}
function tiles(): CanvasTexture {
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = "#cfd2cc"; g.fillRect(0, 0, w, h);
    g.fillStyle = "#eef0ea";
    for (let y = 0; y < h; y += 32) for (let x = 0; x < w; x += 64) g.fillRect(x + 2 + (y / 32 % 2) * 32, y + 2, 60, 28);
  }, 1);
}
function corrugated(color: string): CanvasTexture {
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = color; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 32) { g.fillStyle = "rgba(255,255,255,0.12)"; g.fillRect(x, 0, 8, h); g.fillStyle = "rgba(0,0,0,0.25)"; g.fillRect(x + 20, 0, 6, h); }
  }, 1.2);
}
function signTexture(text: string, background: string, ink: string, width: number, height: number): CanvasTexture {
  return canvasTexture(width, height, (g) => {
    g.fillStyle = background; g.fillRect(0, 0, width, height);
    g.fillStyle = ink; g.font = `700 ${Math.round(height * 0.62)}px Helvetica, Arial, sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(text, width / 2, height / 2 + 4, width * 0.92);
  });
}
function glowSpot(): CanvasTexture {
  return canvasTexture(128, 128, (g, w, h) => {
    const gradient = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gradient.addColorStop(0, "rgba(255,255,255,0.9)"); gradient.addColorStop(0.4, "rgba(255,255,255,0.35)"); gradient.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gradient; g.fillRect(0, 0, w, h);
  });
}
export function duskSky(): CanvasTexture {
  return canvasTexture(64, 512, (g, w, h) => {
    const gradient = g.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, "#0d1330"); gradient.addColorStop(0.32, "#2a2f5c"); gradient.addColorStop(0.46, "#7a4f72");
    gradient.addColorStop(0.5, "#e98a52"); gradient.addColorStop(0.53, "#3a3040"); gradient.addColorStop(1, "#16151c");
    g.fillStyle = gradient; g.fillRect(0, 0, w, h);
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
  build(parent: Object3D, shadows: (look: string) => boolean = () => true): void {
    for (const [look, list] of this.parts) {
      const merged = mergeGeometries(list, false);
      for (const geometry of list) geometry.dispose();
      if (!merged) continue;
      const mesh = new Mesh(merged, this.materials[look]);
      mesh.castShadow = shadows(look);
      mesh.receiveShadow = true;
      parent.add(mesh);
    }
    this.parts.clear();
  }
}

export interface BuiltMap {
  refs: Map<string, InstanceRef[]>;
  // Plain objects drawn for an entity, hidden while it is destroyed.
  groups: Map<string, Object3D[]>;
  entities: WorldEntity[];
  props: WorldEntity[];
  ladders: Ladder[];
  dispose: () => void;
}

export function buildNightMarket(scene: Scene, textures: SurfaceTextures, propModels: PropModel[]): BuiltMap {
  const owned: CanvasTexture[] = [];
  const own = <T extends CanvasTexture>(texture: T): T => { owned.push(texture); return texture; };
  const std = (options: ConstructorParameters<typeof MeshStandardMaterial>[0]): MeshStandardMaterial => new MeshStandardMaterial(options);
  const brick = (color: number): MeshStandardMaterial => std({ map: textures.brick, normalMap: textures.brickNormal, color, roughness: 0.92 });
  const plaster = (color: number): MeshStandardMaterial => std({ map: textures.plaster, normalMap: textures.plasterNormal, color, roughness: 0.95 });
  const concrete = (color: number): MeshStandardMaterial => std({ map: textures.concrete, normalMap: textures.concreteNormal, color, roughness: 0.9 });
  const paint = (color: number, metalness = 0.2, roughness = 0.6): MeshStandardMaterial => std({ color, metalness, roughness });
  const glow = (color: number, intensity: number): MeshStandardMaterial => std({ color: 0x000000, emissive: color, emissiveIntensity: intensity });
  const wood = (base: string): MeshStandardMaterial => std({ map: own(planks(base)), roughness: 0.85 });
  const awnings = [["#c63c3c", "#f4e9d8"], ["#1f7a74", "#f1e7cf"], ["#e0a030", "#3b2a1e"], ["#3654a8", "#f2eee4"]].map(([a, b]) => std({ map: own(stripes(a, b)), roughness: 0.9, side: DoubleSide }));
  const materials: Record<string, SurfaceMaterial> = {
    brickWarm: brick(0xc9a48c), brickDark: brick(0x9b7d6a), brickRed: brick(0xb08a74), brickCap: brick(0xa88672),
    plasterCream: plaster(0xe6cfaa), plasterTeal: plaster(0xa8c0b9), plasterSand: plaster(0xd9b98f), plasterOchre: plaster(0xc9a46a), plasterInside: plaster(0xe8dcc6),
    concreteCap: concrete(0xb7b2aa), slab: concrete(0xbdb8b0),
    shopGreen: paint(0x1d3b36, 0.1, 0.6), barRed: paint(0x5a1a1f, 0.1, 0.6), tile: std({ map: own(tiles()), roughness: 0.4 }),
    woodDark: wood("#5e3b22"), woodBar: wood("#4a2a18"), woodTable: wood("#6e4a2c"), woodStall: wood("#8a5a35"), floor: wood("#7a5232"), pallet: wood("#9a7a52"),
    poolTable: paint(0x1f6b3a, 0, 0.9), sofa: paint(0x6b2430, 0, 0.85),
    steel: paint(0x9aa3a8, 0.8, 0.3), steelDark: paint(0x3a3f44, 0.6, 0.45), dumpster: paint(0x2f5d3a, 0.4, 0.55), dumpsterLid: paint(0x1f3a26, 0.3, 0.6),
    grating: paint(0x3d4447, 0.7, 0.5), rail: paint(0x22262a, 0.5, 0.6), stairRail: paint(0x22262a, 0.5, 0.6),
    frame: paint(0xd9d4c8, 0, 0.7), recess: paint(0x07090c, 0, 1), door: paint(0x3a2a22, 0.1, 0.7), trim: concrete(0xcfc8ba),
    shutter: std({ map: own(corrugated("#7d8287")), metalness: 0.5, roughness: 0.5 }),
    truck: paint(0xf1e6cc, 0.2, 0.5), truckStripe: paint(0x1f7a74, 0.2, 0.5), rubber: paint(0x151515, 0, 0.9), stool: paint(0xb8432f, 0.1, 0.6),
    awning0: awnings[0], awning1: awnings[1], awning2: awnings[2], awning3: awnings[3],
    goods0: paint(0xe8b04a, 0, 0.8), goods1: paint(0xd3542f, 0, 0.8), goods2: paint(0x7fae4a, 0, 0.8), goods3: paint(0xf2e2c0, 0, 0.8),
    lampGlow: glow(0xffc27a, 3), sconce: glow(0xffb070, 2.5), menuGlow: glow(0xffdca8, 1.4), bottle: glow(0x6fd0c0, 0.6), neonPink: glow(0xff5c9a, 2.2),
    pavement: std({ map: textures.pavement, normalMap: textures.pavementNormal, color: 0x8e8a86, roughness: 0.92 }),
    asphalt: std({ map: textures.asphalt, normalMap: textures.asphaltNormal, color: 0x7d7d7d, roughness: 0.95 }),
    photoCafe: std({ map: textures.storefrontCafe, emissive: 0xffffff, emissiveMap: textures.storefrontCafe, emissiveIntensity: 0.85, roughness: 0.6 }),
    photoStone: std({ map: textures.storefrontStone, emissive: 0xffffff, emissiveMap: textures.storefrontStone, emissiveIntensity: 0.85, roughness: 0.6 }),
  };
  const statics = new Batch(materials);
  const root = new Group();
  root.name = "night-market";
  scene.add(root);

  // Ground: paving in the market alley and passages, asphalt in the service alley, wooden
  // floors indoors.
  const ground = (look: string, x0: number, x1: number, z0: number, z1: number, y: number): void => {
    const geometry = new PlaneGeometry(x1 - x0, z1 - z0);
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

  // Cornices along the top of every alley-facing wall and a base course at the bottom.
  for (const facade of facades) {
    const [nx, nz] = FACE_NORMAL[facade.face], length = facade.to - facade.from, mid = (facade.from + facade.to) / 2;
    const top = facade.y1 + 1.6;
    if (nx) statics.box("trim", 0.35, 0.45, length, facade.at + nx * 0.12, top, mid);
    else statics.box("trim", length, 0.45, 0.35, mid, top, facade.at + nz * 0.12);
  }

  // ---------- windows: breakable glass on every upper floor ----------
  const windowSpots: { x: number; y: number; z: number; face: Face; lit: number }[] = [];
  facades.forEach((facade, index) => {
    const r = seeded(index * 131 + 7);
    for (let a = facade.from + 1.7; a <= facade.to - 1.6; a += 3.4) for (let y = facade.y0; y <= facade.y1; y += 3.3) {
      const [nx, nz] = FACE_NORMAL[facade.face];
      windowSpots.push({ x: nx ? facade.at : a, y, z: nz ? facade.at : a, face: facade.face, lit: r() < facade.lit ? 1 + Math.floor(r() * 2) : 0 });
    }
  });
  for (const { z } of upperWindows) windowSpots.push({ x: 17, y: 5.9, z, face: "nx", lit: 2 });
  const windowGeometry = new PlaneGeometry(1.38, 1.76);
  const glassLooks = [std({ color: 0x18212a, roughness: 0.1, metalness: 0.6 }), glow(0xffb866, 0.45), glow(0xffb866, 0.85)];
  const counts = [0, 0, 0];
  for (const spot of windowSpots) counts[spot.lit] += 1;
  const glassMeshes = glassLooks.map((material, i) => { const mesh = new InstancedMesh(windowGeometry, material, Math.max(1, counts[i])); mesh.count = counts[i]; return mesh; });
  const frames = new InstancedMesh(new BoxGeometry(1.62, 2.0, 0.08), materials.frame, windowSpots.length);
  const recesses = new InstancedMesh(windowGeometry, materials.recess, windowSpots.length);
  const refs = new Map<string, InstanceRef[]>();
  const entities: WorldEntity[] = [];
  const used = [0, 0, 0];
  const matrix = new Matrix4(), q = new Quaternion();
  windowSpots.forEach((spot, index) => {
    const [nx, nz] = FACE_NORMAL[spot.face];
    q.setFromAxisAngle(UP, FACE_YAW[spot.face]);
    frames.setMatrixAt(index, matrix.compose(new Vector3(spot.x, spot.y, spot.z), q, new Vector3(1, 1, 1)));
    recesses.setMatrixAt(index, matrix.compose(new Vector3(spot.x + nx * 0.045, spot.y, spot.z + nz * 0.045), q, new Vector3(1, 1, 1)));
    const mesh = glassMeshes[spot.lit], slot = used[spot.lit]++;
    mesh.setMatrixAt(slot, matrix.compose(new Vector3(spot.x + nx * 0.06, spot.y, spot.z + nz * 0.06), q, new Vector3(1, 1, 1)));
    const id = `window:${index}`;
    refs.set(id, [{ mesh, index: slot }]);
    entities.push({ id, kind: "window", material: "glass", maxHealth: 1, yaw: Math.atan2(nx, nz), center: { x: spot.x, y: spot.y, z: spot.z } });
  });
  for (const mesh of [frames, recesses, ...glassMeshes]) { mesh.receiveShadow = true; root.add(mesh); }

  // ---------- shopfronts, signs, doors and shutters ----------
  const signs: Mesh[] = [];
  const sign = (text: string, background: string, ink: string, w: number, h: number, x: number, y: number, z: number, face: Face, intensity = 0.55): void => {
    const height = 128, width = Math.min(2048, Math.round(height * w / h));
    const texture = own(signTexture(text, background, ink, width, height));
    const mesh = new Mesh(new PlaneGeometry(w, h), std({ map: texture, emissive: 0xffffff, emissiveMap: texture, emissiveIntensity: intensity, roughness: 0.7, side: DoubleSide }));
    mesh.position.set(x, y, z);
    mesh.rotation.y = FACE_YAW[face];
    signs.push(mesh);
    root.add(mesh);
  };
  for (const shop of shopfronts) {
    const [nx, nz] = FACE_NORMAL[shop.face];
    const x = nx ? shop.at + nx * 0.04 : shop.along, z = nz ? shop.at + nz * 0.04 : shop.along;
    statics.plane(shop.photo === "cafe" ? "photoCafe" : "photoStone", shop.width, 3.1, x, 1.6, z, shop.face);
    sign(shop.sign[0], shop.sign[1], shop.sign[2], shop.width, 0.7, x + nx * 0.02, 3.55, z + nz * 0.02, shop.face);
  }
  sign("SOFA KITCHEN", "#2b1d16", "#ffe2b0", 8, 0.75, -8.46, 4.05, 4.5, "px", 0.7);
  sign("THE LANTERN", "#2a0f1f", "#ff8fc0", 4.2, 0.7, 15.38, 3.55, 6.2, "nx", 1.1);
  sign("SOFA NIGHT MARKET", "#7a1f2b", "#ffe9c2", 7.6, 1.3, -4, 6.3, -23.5, "pz", 0.8);
  sign("NIGHT MARKET · OPEN LATE", "#20302f", "#ffd27a", 8, 1.0, -4, 5.6, 29.5, "nz", 0.8);
  sign("OPEN", "#05070a", "#ff5c9a", 1.2, 0.5, 17.24, 2.1, 3.4, "nx", 1.6);
  sign("MENU", "#1a1a1a", "#ffe9b0", 1.8, 0.9, -11.5, 2.4, 13.96, "nz", 0.6);
  // Back doors and ground-floor doors on blank walls.
  const doors: [number, number, Face][] = [[8.5, 18, "px"], [8.5, -8, "px"], [8.5, -20, "px"], [17, 15.5, "nx"], [17, -10.5, "nx"], [-8.5, 18.6, "px"], [0.5, 25, "nx"]];
  for (const [at, along, face] of doors) {
    const [nx, nz] = FACE_NORMAL[face];
    statics.box("frame", nx ? 0.12 : 1.4, 2.5, nx ? 1.4 : 0.12, nx ? at + nx * 0.03 : along, 0, nz ? at + nz * 0.03 : along);
    statics.box("door", nx ? 0.1 : 1.2, 2.3, nx ? 1.2 : 0.1, nx ? at + nx * 0.06 : along, 0, nz ? at + nz * 0.06 : along);
  }
  for (const [x, z, face] of [[-4, 29.95, "nz"], [12.75, 29.95, "nz"], [-4, -29.95, "pz"], [12.75, -29.95, "pz"]] as [number, number, Face][]) {
    statics.plane("shutter", 6, 3.6, x, 1.8, z, face);
    statics.box("trim", 6.6, 0.4, 0.3, x, 3.6, z);
  }

  // ---------- restaurant and bar interiors ----------
  for (const z of [-2, 2.4, 6.8]) {
    for (const [dx, dz] of [[-0.75, 0], [0.75, 0], [0, 0.7], [0, -0.7]]) statics.box("woodDark", 0.4, 0.45, 0.4, -10.3 + dx, 0, z + dz);
    statics.cylinder("lampGlow", 0.16, 0.22, -10.3, 2.75, z, 12, 0.05);
  }
  for (const z of [1, 4.5, 8]) statics.cylinder("lampGlow", 0.14, 0.2, -12.2, 2.8, z, 12, 0.05);
  statics.box("woodDark", 0.35, 0.05, 15, -14.8, 1.7, 5.5);
  statics.box("woodDark", 0.35, 0.05, 15, -14.8, 2.25, 5.5);
  for (let z = -1.8; z <= 12.8; z += 0.9) statics.box(z % 1.8 < 0.9 ? "goods0" : "goods3", 0.25, 0.3, 0.3, -14.8, 1.75, z);
  for (let z = -0.4; z <= 4.8; z += 0.9) statics.cylinder("stool", 0.2, 0.75, 20.0, 0, z, 10);
  statics.box("woodBar", 0.3, 0.05, 3.6, 24.3, 2.0, 8.0);
  for (let z = 6.2; z <= 9.6; z += 0.35) statics.box("bottle", 0.08, 0.3, 0.08, 24.25, 2.05, z);
  statics.cylinder("lampGlow", 0.25, 0.12, 20.1, 2.9, 8.5, 12, 0.08);

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
    parts.box("lampGlow", 0.14, 0.2, 0.14, 0.3, 1.95, 0);
    parts.build(group);
    root.add(group);
    const id = `stall:${index}`;
    groups.set(id, [group]);
    // The whole stall is cover, counter to awning: pistol rounds stop in it, carbine rounds get through weakened.
    entities.push({ id, kind: "stall", material: "wood", maxHealth: 200, yaw: 0, center: { x: stall.x, y: 1.3, z: stall.z }, shape: { type: "box", half: [0.6, 1.3, 1.5] } });
  });

  // ---------- glass storefronts that shatter and can be climbed through ----------
  const paneMaterial = std({ color: 0xa9c4cf, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.22, depthWrite: false, side: DoubleSide });
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
  // Food truck.
  statics.box("truck", 6.2, 2.5, 2.4, -4, 0.55, -26);
  statics.box("truckStripe", 6.22, 0.35, 2.42, -4, 1.25, -26);
  statics.box("menuGlow", 2.8, 1.0, 0.05, -3.6, 1.75, -24.78);
  for (const wx of [-2.1, 2.1]) for (const wz of [1.05, -1.05]) {
    const wheel = new CylinderGeometry(0.42, 0.42, 0.3, 16);
    wheel.applyMatrix4(new Matrix4().makeRotationX(Math.PI / 2));
    statics.add("rubber", wheel, new Matrix4().makeTranslation(-4 + wx, 0.42, -26 + wz));
  }
  const truckAwning = meterBox(3.2, 0.05, 1.2);
  truckAwning.applyMatrix4(new Matrix4().makeRotationX(0.35));
  statics.add("awning1", truckAwning, new Matrix4().makeTranslation(-3.6, 2.9, -24.2));

  // ---------- service alley dressing ----------
  for (const solid of solids.filter((item) => item.look === "dumpster")) statics.box("dumpsterLid", solid.half[0] * 2 + 0.1, 0.08, solid.half[2] * 2 + 0.1, solid.center.x, solid.center.y + solid.half[1], solid.center.z);
  statics.box("pallet", 1.2, 0.15, 1.0, 15.8, 0, 18);
  statics.box("pallet", 1.2, 0.15, 1.0, 15.8, 0.15, 18.1);
  for (const [x, y, z] of [[8.8, 3.2, 20], [8.8, 6.6, -4], [8.8, 3.4, -20], [16.7, 5.5, 18], [16.7, 2.8, -24]]) statics.box("steelDark", 0.6, 0.55, 0.9, x, y, z);
  for (const [x, z] of [[16.85, 22], [8.65, -24], [-8.35, 10.3], [0.65, -25]]) statics.box("steelDark", 0.12, 9, 0.12, x, 0, z);
  // Wall lamps along the service alley.
  for (const z of [20, 10, 0, -10, -20]) {
    statics.box("sconce", 0.25, 0.3, 0.4, 8.62, 3.3, z);
    statics.box("sconce", 0.25, 0.3, 0.4, 16.88, 3.3, z + 5);
  }

  // ---------- string lights, lanterns and pools of light ----------
  const bulbSpots: Vector3[] = [], wires: number[] = [];
  for (const strand of strands) {
    const count = Math.max(4, Math.round(Math.hypot(strand.x1 - strand.x0, strand.z1 - strand.z0) / 0.45));
    let previous: Vector3 | null = null;
    for (let i = 0; i <= count; i += 1) {
      const t = i / count, p = new Vector3(strand.x0 + (strand.x1 - strand.x0) * t, strand.y - strand.sag * 4 * t * (1 - t), strand.z0 + (strand.z1 - strand.z0) * t);
      bulbSpots.push(p);
      if (previous) wires.push(previous.x, previous.y, previous.z, p.x, p.y, p.z);
      previous = p;
    }
  }
  const bulbs = new InstancedMesh(new SphereGeometry(0.05, 8, 6), glow(0xffc070, 2.2), bulbSpots.length);
  bulbSpots.forEach((p, i) => bulbs.setMatrixAt(i, matrix.makeTranslation(p.x, p.y - 0.08, p.z)));
  root.add(bulbs);
  const wireGeometry = new BufferGeometry();
  wireGeometry.setAttribute("position", new Float32BufferAttribute(wires, 3));
  root.add(new LineSegments(wireGeometry, new LineBasicMaterial({ color: 0x1a1a1a })));
  const lanternSpots: [Vector3, number][] = [];
  for (const z of lanternRows) for (let k = 0; k < 6; k += 1) lanternSpots.push([new Vector3(-7.6 + k * 1.45, 4.6 - Math.sin(k / 5 * Math.PI) * 0.5, z), k % 2]);
  for (const color of [0, 1]) {
    const spots = lanternSpots.filter(([, c]) => c === color);
    const lanterns = new InstancedMesh(new SphereGeometry(0.22, 12, 10), glow(color ? 0xff5a3a : 0xffa040, 1.6), spots.length);
    spots.forEach(([p], i) => lanterns.setMatrixAt(i, matrix.compose(p, new Quaternion(), new Vector3(1, 1.25, 1))));
    root.add(lanterns);
  }
  // Soft warm pools on the ground under the strings and stalls stand in for the light those
  // bulbs would cast; only six real lights are used, to keep shaders quick to build.
  const pools: [number, number, number, number][] = [
    ...[23, 15, 8, 1, -6, -13, -20].map((z) => [-4, z + 0.75, 4.2, 0xffa858] as [number, number, number, number]),
    ...stalls.map((stall) => [stall.x + stall.side * 0.6, stall.z, 2.4, 0xffb870] as [number, number, number, number]),
    ...[17, 7, -3, -13, -23].map((z) => [12.75, z + 1.25, 3.6, 0xff9a50] as [number, number, number, number]),
    [-10.3, 4, 4.5, 0xffc080], [20.4, 4, 4.2, 0xff8aa8], [-4, -24, 3.2, 0xffd0a0],
  ];
  const poolMesh = new InstancedMesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ map: own(glowSpot()), transparent: true, blending: AdditiveBlending, depthWrite: false, opacity: 0.2 }), pools.length);
  const flat = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);
  pools.forEach(([x, z, size, color], i) => {
    poolMesh.setMatrixAt(i, matrix.compose(new Vector3(x, 0.03, z), flat, new Vector3(size * 2, size * 2, 1)));
    poolMesh.setColorAt(i, new Color(color));
  });
  poolMesh.renderOrder = 2;
  root.add(poolMesh);
  for (const [x, y, z, color, intensity] of pointLights) {
    const light = new PointLight(color, intensity, 16, 2);
    light.position.set(x, y, z);
    root.add(light);
  }

  // Ladders and the bar stair use the same steel drawing as the San Jose rooftops.
  addRoofAccess(scene, { roofs: [], ladders, stairs: [stair], boxes: [], reachable: [] });
  statics.build(root, (look) => !["pavement", "asphalt", "floor", "photoCafe", "photoStone", "shutter", "sconce", "menuGlow", "lampGlow", "bottle"].includes(look));

  // Movable props, numbered in a fixed order so ids match on every client.
  const models = new Map(propModels.map((model) => [model.name, model]));
  const props: WorldEntity[] = [];
  for (const [name, x, z, base, yaw] of propSpots) {
    const model = models.get(name);
    if (model) props.push(propEntity(`prop:${props.length}`, model, x, z, base, yaw));
  }

  return {
    refs, groups, entities, props, ladders,
    dispose() { for (const texture of owned) texture.dispose(); for (const mesh of signs) (mesh.material as MeshStandardMaterial).map?.dispose(); },
  };
}
