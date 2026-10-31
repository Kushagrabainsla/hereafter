// Builds the Night Market from the game's own code, lays every static surface out in a
// lightmap atlas and hands the result to scripts/lightmaps/export.mjs: a GLB of the
// surfaces (with the atlas as their only texture coordinates and a flat colour per look,
// for Blender to bake), the lamps and the sun, and the atlas coordinates the game reads
// back at load (public/lightmaps/night-market.json).
import { Matrix4, Scene, Vector3, type InstancedMesh, type Material, type Mesh, type Object3D, type Texture } from "three/webgpu";
import { buildNightMarket, MARKET_ARENA, MARKET_SUN, NIGHT_MARKET } from "../../src/world/nightMarket";
import { loadSurfaceTextures } from "../../src/world/surfaceTextures";
import { checksum } from "../../src/world/lightmap";
import { FoodTruck, loadFoodTruck } from "../../src/world/foodTruck";
import { kitPieces, loadMarketKit } from "../../src/world/kit";

const SIZE = 2048;
// Empty texels around each chart, so neighbours do not bleed into each other when filtered.
const PAD = 2;

interface Chart { mesh: number; triangles: number[]; u: Vector3; v: Vector3; min: [number, number]; size: [number, number]; x: number; y: number; w: number; h: number }

// Players stand at most on the fire escape, 4.6 m up, so no one sees a face that looks up
// from above this height, a face that looks down at the ground, a face buried in or flush
// against a solid, or a face of the outer buildings that looks away from the market.
const SEEN_BELOW = 6.5;
const solids = NIGHT_MARKET.solids.filter((solid) => solid.material !== "boundary" && !solid.rotation);
function hidden(corners: Vector3[], normal: Vector3): boolean {
  const center = corners[0].clone().add(corners[1]).add(corners[2]).divideScalar(3);
  if (normal.y > 0.9 && center.y > SEEN_BELOW) return true;
  if (normal.y < -0.9 && center.y < 0.05) return true;
  // Facing away from every corner of the playable square, eye height included.
  const half = MARKET_ARENA.sizeMeters / 2;
  let facing = -Infinity;
  for (const x of [-half, half]) for (const z of [-half, half]) for (const y of [0, SEEN_BELOW]) facing = Math.max(facing, normal.x * (x - center.x) + normal.y * (y - center.y) + normal.z * (z - center.z));
  if (facing <= 0.01) return true;
  // Buried only if the whole triangle is: its middle and points just inside each corner.
  const inside = (point: Vector3): boolean => {
    const probe = point.clone().addScaledVector(normal, 0.02);
    return solids.some(({ center: c, half: [hx, hy, hz] }) => Math.abs(probe.x - c.x) < hx && Math.abs(probe.y - c.y) < hy && Math.abs(probe.z - c.z) < hz);
  };
  return [center, ...corners.map((corner) => corner.clone().lerp(center, 0.05))].every(inside);
}
// Ground tiles become charts of their own, so hidden ones drop out.
const TILED = new Set(["pavement", "asphalt", "floor"]);

// Coplanar triangles that share an edge form a chart, flattened onto its plane: a box face,
// a floor, one facet of a cylinder.
function charts(meshes: Mesh[], unseen: { mesh: number; triangles: number[] }[]): Chart[] {
  const out: Chart[] = [];
  const key = (x: number, y: number, z: number): string => `${Math.round(x * 1000)},${Math.round(y * 1000)},${Math.round(z * 1000)}`;
  meshes.forEach((mesh, meshIndex) => {
    const p = mesh.geometry.attributes.position.array;
    const count = p.length / 9;
    const planes = new Map<string, number[]>();
    const normals: Vector3[] = [];
    for (let t = 0; t < count; t += 1) {
      const a = new Vector3(p[t * 9], p[t * 9 + 1], p[t * 9 + 2]), b = new Vector3(p[t * 9 + 3], p[t * 9 + 4], p[t * 9 + 5]), c = new Vector3(p[t * 9 + 6], p[t * 9 + 7], p[t * 9 + 8]);
      const n = b.clone().sub(a).cross(c.clone().sub(a));
      if (n.length() < 1e-9) { normals.push(new Vector3(0, 1, 0)); continue; }
      n.normalize();
      normals.push(n);
      const center = a.clone().add(b).add(c).divideScalar(3);
      if (hidden([a, b, c], n)) { unseen.push({ mesh: meshIndex, triangles: [t] }); continue; }
      // Both triangles of a ground tile span the whole tile, so its corner names the tile.
      const tile = TILED.has(mesh.name.replace(/^static:/, "")) ? `,${Math.round(Math.min(a.x, b.x, c.x) * 10)},${Math.round(Math.min(a.z, b.z, c.z) * 10)}` : "";
      const plane = `${Math.round(n.x * 500)},${Math.round(n.y * 500)},${Math.round(n.z * 500)},${Math.round(n.dot(a) * 200)}${tile}`;
      const list = planes.get(plane) ?? [];
      list.push(t);
      planes.set(plane, list);
    }
    for (const triangles of planes.values()) {
      // Union triangles of one plane that share an edge.
      const parent = triangles.map((_, index) => index);
      const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
      const edges = new Map<string, number>();
      triangles.forEach((t, index) => {
        const corners = [0, 1, 2].map((k) => key(p[t * 9 + k * 3], p[t * 9 + k * 3 + 1], p[t * 9 + k * 3 + 2]));
        for (let k = 0; k < 3; k += 1) {
          const edge = [corners[k], corners[(k + 1) % 3]].sort().join("|");
          const other = edges.get(edge);
          if (other === undefined) edges.set(edge, index);
          else parent[find(index)] = find(other);
        }
      });
      const groups = new Map<number, number[]>();
      triangles.forEach((t, index) => { const root = find(index); const list = groups.get(root) ?? []; list.push(t); groups.set(root, list); });
      for (const group of groups.values()) {
        const n = normals[group[0]];
        let u = Math.abs(n.y) > 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0).cross(n).normalize();
        let v = n.clone().cross(u).normalize();
        let minS = Infinity, minT = Infinity, maxS = -Infinity, maxT = -Infinity;
        for (const t of group) for (let k = 0; k < 3; k += 1) {
          const q = new Vector3(p[t * 9 + k * 3], p[t * 9 + k * 3 + 1], p[t * 9 + k * 3 + 2]);
          const s = q.dot(u), w = q.dot(v);
          minS = Math.min(minS, s); maxS = Math.max(maxS, s); minT = Math.min(minT, w); maxT = Math.max(maxT, w);
        }
        // Charts lie wide rather than tall, which packs into shelves with less waste.
        if (maxT - minT > maxS - minS) { [u, v] = [v, u]; [minS, minT, maxS, maxT] = [minT, minS, maxT, maxS]; }
        out.push({ mesh: meshIndex, triangles: group, u, v, min: [minS, minT], size: [maxS - minS, maxT - minT], x: 0, y: 0, w: 0, h: 0 });
      }
    }
  });
  return out;
}

// Shelf packing at a texel density; returns the atlas height used.
function pack(list: Chart[], density: number): number {
  for (const chart of list) {
    chart.w = Math.max(1, Math.ceil(chart.size[0] * density)) + PAD * 2;
    chart.h = Math.max(1, Math.ceil(chart.size[1] * density)) + PAD * 2;
  }
  const order = [...list].sort((a, b) => b.h - a.h || b.w - a.w);
  let x = 0, y = 0, shelf = 0;
  for (const chart of order) {
    if (chart.w > SIZE) return Infinity;
    if (x + chart.w > SIZE) { x = 0; y += shelf; shelf = 0; }
    chart.x = x; chart.y = y;
    x += chart.w;
    shelf = Math.max(shelf, chart.h);
  }
  return y + shelf;
}

function linear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

// A look's colour as Blender should see it: the material's colour times the average of its
// texture, darkened a little where the game's walls and paving add grime and wet patches.
function albedo(material: Material): [number, number, number] {
  const standard = material as Material & { color?: { r: number; g: number; b: number }; map?: Texture | null; colorNode?: unknown };
  const color = standard.color ?? { r: 0.8, g: 0.8, b: 0.8 };
  let average: [number, number, number] = [1, 1, 1];
  const image = standard.map?.image as CanvasImageSource | undefined;
  if (image) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 32;
    const context = canvas.getContext("2d", { willReadFrequently: true })!;
    context.drawImage(image, 0, 0, 32, 32);
    const pixels = context.getImageData(0, 0, 32, 32).data;
    const sum = [0, 0, 0];
    for (let i = 0; i < pixels.length; i += 4) for (let k = 0; k < 3; k += 1) sum[k] += linear(pixels[i + k]);
    average = sum.map((value) => value / (pixels.length / 4)) as [number, number, number];
  }
  const grime = standard.colorNode ? 0.8 : 1;
  return [color.r * average[0] * grime, color.g * average[1] * grime, color.b * average[2] * grime];
}

// A minimal binary glTF: one mesh per surface with position, normal and the atlas as its
// texture coordinates, and a flat material per look.
function glb(parts: { name: string; position: Float32Array; normal: Float32Array; uv: Float32Array; color: [number, number, number] }[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  let offset = 0;
  const bufferViews: object[] = [], accessors: object[] = [];
  const view = (data: Float32Array, components: number, minMax: boolean): number => {
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.byteLength });
    chunks.push(bytes);
    offset += bytes.byteLength;
    const accessor: Record<string, unknown> = { bufferView: bufferViews.length - 1, componentType: 5126, count: data.length / components, type: components === 3 ? "VEC3" : "VEC2" };
    if (minMax) {
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < data.length; i += 3) for (let k = 0; k < 3; k += 1) { min[k] = Math.min(min[k], data[i + k]); max[k] = Math.max(max[k], data[i + k]); }
      Object.assign(accessor, { min, max });
    }
    accessors.push(accessor);
    return accessors.length - 1;
  };
  const meshes = parts.map((part, index) => ({
    name: part.name,
    primitives: [{ attributes: { POSITION: view(part.position, 3, true), NORMAL: view(part.normal, 3, false), TEXCOORD_0: view(part.uv, 2, false) }, material: index }],
  }));
  const json = {
    asset: { version: "2.0", generator: "hereafter lightmap export" },
    scene: 0, scenes: [{ nodes: parts.map((_, index) => index) }],
    nodes: parts.map((part, index) => ({ name: part.name, mesh: index })),
    meshes,
    materials: parts.map((part) => ({ name: part.name, pbrMetallicRoughness: { baseColorFactor: [...part.color, 1], metallicFactor: 0, roughnessFactor: 1 } })),
    accessors, bufferViews, buffers: [{ byteLength: offset }],
  };
  const text = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = Math.ceil(text.length / 4) * 4, binLength = Math.ceil(offset / 4) * 4;
  const out = new Uint8Array(12 + 8 + jsonLength + 8 + binLength);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, out.length, true);
  dv.setUint32(12, jsonLength, true); dv.setUint32(16, 0x4e4f534a, true);
  out.set(text, 20); out.fill(0x20, 20 + text.length, 20 + jsonLength);
  dv.setUint32(20 + jsonLength, binLength, true); dv.setUint32(24 + jsonLength, 0x004e4942, true);
  let at = 28 + jsonLength;
  for (const chunk of chunks) { out.set(chunk, at); at += chunk.byteLength; }
  return out;
}

function base64(bytes: Uint8Array): string {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

async function exportLightmap(): Promise<object> {
  const scene = new Scene();
  const textures = await loadSurfaceTextures();
  const built = buildNightMarket(scene, textures, [], kitPieces(await loadMarketKit()));
  // The food truck shades the paving around it, with its hatch up as it starts.
  const truck = new FoodTruck(scene, await loadFoodTruck(), () => undefined);
  truck.setOpen({}, { "truck:hatch": true }, true);
  scene.updateMatrixWorld(true);
  const surfaces = built.surfaces;
  const unseen: { mesh: number; triangles: number[] }[] = [];
  const all = charts(surfaces, unseen);
  // The densest layout that fits the atlas.
  let low = 1, high = 60;
  for (let step = 0; step < 24; step += 1) { const mid = (low + high) / 2; if (pack(all, mid) <= SIZE - 4) low = mid; else high = mid; }
  const density = low;
  pack(all, density);
  // Unseen faces all point at one corner texel; they need coordinates, not light.
  const uvs = surfaces.map((mesh) => new Float32Array(mesh.geometry.attributes.position.count * 2).fill((SIZE - 1.5) / SIZE));
  for (const chart of all) {
    const p = surfaces[chart.mesh].geometry.attributes.position.array, uv = uvs[chart.mesh];
    for (const t of chart.triangles) for (let k = 0; k < 3; k += 1) {
      const vertex = t * 3 + k, q = new Vector3(p[vertex * 3], p[vertex * 3 + 1], p[vertex * 3 + 2]);
      uv[vertex * 2] = (chart.x + PAD + (q.dot(chart.u) - chart.min[0]) * density) / SIZE;
      uv[vertex * 2 + 1] = (chart.y + PAD + (q.dot(chart.v) - chart.min[1]) * density) / SIZE;
    }
  }
  const parts = surfaces.map((mesh, index) => ({
    name: `receiver:${mesh.name.replace(/^static:/, "")}`,
    position: Float32Array.from(mesh.geometry.attributes.position.array),
    normal: Float32Array.from(mesh.geometry.attributes.normal.array),
    uv: uvs[index],
    color: albedo(mesh.material as Material),
  }));
  // Stalls and the truck shade the paving, though they are not baked themselves.
  const occluders: [string, Object3D][] = [...built.groups].filter(([id]) => id.startsWith("stall:")).flatMap(([id, objects]) => objects.map((object): [string, Object3D] => [id, object]));
  occluders.push(["truck", truck.root]);
  // Fire escapes, air conditioners and the record shop's fittings shade the walls and floors
  // behind them. Doors move, so they are left out, and so is glass.
  const instance = new Matrix4();
  scene.traverse((child) => {
    const mesh = child as InstancedMesh;
    if (!mesh.isInstancedMesh || !mesh.name.startsWith("kit:") || (mesh.material as Material).transparent) return;
    for (let i = 0; i < mesh.count; i += 1) {
      mesh.getMatrixAt(i, instance);
      const geometry = (mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone()).applyMatrix4(instance).applyMatrix4(mesh.matrixWorld);
      parts.push({ name: `occluder:${mesh.name}`, position: Float32Array.from(geometry.attributes.position.array), normal: Float32Array.from(geometry.attributes.normal.array),
        uv: new Float32Array(geometry.attributes.position.count * 2), color: albedo(mesh.material as Material) });
    }
  });
  for (const [id, root] of occluders) {
    for (const object of [root]) object.traverse((child) => {
      const mesh = child as Mesh;
      if (!mesh.isMesh) return;
      const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
      geometry.applyMatrix4(mesh.matrixWorld);
      parts.push({ name: `occluder:${id}`, position: Float32Array.from(geometry.attributes.position.array), normal: Float32Array.from(geometry.attributes.normal.array),
        uv: new Float32Array(geometry.attributes.position.count * 2), color: albedo(mesh.material as Material) });
    });
  }
  const looks = surfaces.map((mesh, index) => ({
    look: mesh.name.replace(/^static:/, ""),
    vertices: mesh.geometry.attributes.position.count,
    checksum: checksum(mesh.geometry),
    uv: base64(new Uint8Array(Uint16Array.from(uvs[index], (value) => Math.round(Math.min(1, Math.max(0, value)) * 65535)).buffer)),
  }));
  const area = all.reduce((sum, c) => sum + c.size[0] * c.size[1], 0);
  const sun = new Vector3(...MARKET_SUN.offset).normalize();
  return {
    glb: base64(glb(parts)),
    data: { version: 1, size: SIZE, bounceScale: 1, looks },
    scene: { size: SIZE, density, charts: all.length, unseen: unseen.length, area: Math.round(area), rects: all.map((c) => [c.x, c.y, c.w, c.h]), lights: built.lightSources, sun: { direction: sun.toArray(), color: MARKET_SUN.color, intensity: MARKET_SUN.intensity } },
  };
}

(window as unknown as { __lightmapExport: () => Promise<object> }).__lightmapExport = exportLightmap;
