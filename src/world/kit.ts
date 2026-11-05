import { BufferAttribute, BufferGeometry, Color, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, MeshStandardNodeMaterial, Object3D, type Material as SurfaceMaterial } from "three/webgpu";
import { attribute } from "three/tsl";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { type InstanceRef } from "./entities";

// The models placed by name around the market, each built in Blender: the wall dressing of
// public/models/market-kit.glb (scripts/kit/build.py) and the families built by the asset
// pipeline (scripts/assets, docs/asset-pipeline.md): lamps, signs and the rest. Every top-level
// node of every file is one piece, modelled in its own frame with its origin where it is placed.
const KIT_FILES = ["market-kit", "lights", "signs", "furniture", "street"];

export function loadKits(): Promise<(GLTF | null)[]> {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  return Promise.all(KIT_FILES.map((name) => loader.loadAsync(`${import.meta.env.BASE_URL}models/${name}.glb`)
    .catch((error: unknown) => { console.warn(`Could not load ${name}.glb.`, error); return null; })));
}

// A piece in its own frame: one geometry per material it keeps apart, the rest merged.
export interface KitPiece { parts: { geometry: BufferGeometry; material: SurfaceMaterial }[] }

// Pale materials named paint_* take each copy's own colour; glow_* materials are lamp glass,
// neon and lit faces, which the game lights itself and dims when the lamp is shot out.
const tinted = (material: SurfaceMaterial): boolean => material.name.startsWith("paint_");
export const glowing = (material: SurfaceMaterial): boolean => material.name.startsWith("glow_");

// Plain parts of every piece share this material: each vertex carries its part's colour,
// roughness and metalness, so a piece of many plain materials draws in one call.
const merged = new MeshStandardNodeMaterial();
merged.name = "kit:merged";
merged.vertexColors = true;
merged.roughnessNode = attribute("surface", "vec2").x;
merged.metalnessNode = attribute("surface", "vec2").y;

// A material that can join the merged one: opaque, unlit, untextured, neither paint nor glow.
function plain(material: SurfaceMaterial): material is MeshStandardMaterial {
  const standard = material as MeshStandardMaterial;
  return !!standard.isMeshStandardMaterial && !tinted(material) && !glowing(material) && !material.transparent && standard.opacity === 1
    && !standard.map && (standard.emissiveIntensity === 0 || standard.emissive.getHex() === 0);
}

// Geometry carrying a plain material's colour and surface on every vertex.
function painted(geometry: BufferGeometry, material: MeshStandardMaterial): BufferGeometry {
  const count = geometry.getAttribute("position").count, color = new Float32Array(count * 3), surface = new Float32Array(count * 2);
  for (let i = 0; i < count; i += 1) {
    color.set([material.color.r, material.color.g, material.color.b], i * 3);
    surface.set([material.roughness, material.metalness], i * 2);
  }
  geometry.setAttribute("color", new BufferAttribute(color, 3));
  geometry.setAttribute("surface", new BufferAttribute(surface, 2));
  return geometry;
}

// The geometry with every attribute as plain floats. Meshopt files pack positions and normals
// into small integers (positions within -1 to 1, scaled back by their node): moved into place
// as they are, anything bigger than a metre would be crushed to that range.
function unpacked(geometry: BufferGeometry): BufferGeometry {
  for (const [name, source] of Object.entries(geometry.attributes)) {
    if (source.array instanceof Float32Array && !source.normalized && !("isInterleavedBufferAttribute" in source && source.isInterleavedBufferAttribute)) continue;
    const values = new Float32Array(source.count * source.itemSize);
    for (let i = 0; i < source.count; i += 1) for (let k = 0; k < source.itemSize; k += 1) values[i * source.itemSize + k] = source.getComponent(i, k);
    geometry.setAttribute(name, new BufferAttribute(values, source.itemSize));
  }
  return geometry;
}

// Keeps only the attributes every merged part has.
function bare(geometry: BufferGeometry): BufferGeometry {
  for (const name of Object.keys(geometry.attributes)) if (name !== "position" && name !== "normal") geometry.deleteAttribute(name);
  return geometry;
}

export function kitPieces(gltfs: (GLTF | null)[]): Map<string, KitPiece> {
  const pieces = new Map<string, KitPiece>();
  for (const gltf of gltfs) {
    if (!gltf) continue;
    gltf.scene.updateMatrixWorld(true);
    // Every piece is built at the origin of its file, so the file's own frame is the piece's.
    // Its node may still carry a transform: meshopt compression stores each mesh's scale and
    // offset there, to turn its packed positions back into metres.
    for (const node of gltf.scene.children) {
      const byMaterial = new Map<SurfaceMaterial, BufferGeometry[]>(), plainParts: BufferGeometry[] = [];
      node.traverse((object) => {
        const mesh = object as Mesh;
        if (!mesh.isMesh) return;
        const material = mesh.material as SurfaceMaterial;
        const geometry = unpacked(mesh.geometry.clone()).applyMatrix4(mesh.matrixWorld);
        if (plain(material)) { plainParts.push(painted(bare(geometry), material)); return; }
        const list = byMaterial.get(material) ?? [];
        list.push(geometry);
        byMaterial.set(material, list);
      });
      const parts = [...byMaterial].map(([material, list]) => ({ geometry: list.length > 1 ? mergeGeometries(list, false)! : list[0], material }));
      if (plainParts.length) parts.unshift({ geometry: plainParts.length > 1 ? mergeGeometries(plainParts, false)! : plainParts[0], material: merged });
      pieces.set(node.name, { parts });
    }
  }
  return pieces;
}

// A piece's parts split into what stays as it is and what glows, the glowing parts merged.
export function splitGlow(piece: KitPiece | undefined): { solid: KitPiece; glow: BufferGeometry | null } {
  const parts = piece?.parts ?? [];
  const glow = parts.filter((part) => glowing(part.material)).map((part) => part.geometry);
  return { solid: { parts: parts.filter((part) => !glowing(part.material)) }, glow: glow.length > 1 ? mergeGeometries(glow, false) : glow[0] ?? null };
}

// Copies of kit pieces drawn as one instanced mesh per piece and material. Each placement
// returns the instances that draw it, filled in by build(), so an entity can hide them.
export class KitPlacer {
  private placements = new Map<string, { matrix: Matrix4; tint?: number; refs: InstanceRef[] }[]>();

  constructor(private pieces: Map<string, KitPiece>) {}

  has(name: string): boolean { return this.pieces.has(name); }

  // Adds a piece under a name of its own, such as a lamp without its glass.
  define(name: string, piece: KitPiece): void { this.pieces.set(name, piece); }

  place(name: string, matrix: Matrix4, tint?: number): InstanceRef[] {
    const refs: InstanceRef[] = [];
    if (!this.pieces.has(name)) return refs;
    const list = this.placements.get(name) ?? [];
    list.push({ matrix: matrix.clone(), tint, refs });
    this.placements.set(name, list);
    return refs;
  }

  build(parent: Object3D, castShadow: (name: string) => boolean = () => false): void {
    const color = new Color();
    for (const [name, list] of this.placements) {
      for (const { geometry, material } of this.pieces.get(name)!.parts) {
        const mesh = new InstancedMesh(geometry, material, list.length);
        list.forEach((placement, index) => {
          mesh.setMatrixAt(index, placement.matrix);
          if (tinted(material)) mesh.setColorAt(index, color.set(placement.tint ?? 0xffffff));
          placement.refs.push({ mesh, index });
        });
        mesh.name = `kit:${name}`;
        mesh.castShadow = castShadow(name);
        mesh.receiveShadow = true;
        mesh.computeBoundingSphere();
        parent.add(mesh);
      }
    }
    this.placements.clear();
  }
}

// Instanced copies of every part of a piece, for things that move each frame, such as the
// swaying lanterns. `swap` gives the material to draw a part with, given the piece's own.
export function instancedParts(piece: KitPiece | undefined, count: number, swap: (material: SurfaceMaterial) => SurfaceMaterial = (material) => material): InstancedMesh[] {
  return (piece?.parts ?? []).map(({ geometry, material }) => {
    const mesh = new InstancedMesh(geometry, swap(material), count);
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    return mesh;
  });
}

// One copy of a piece as plain meshes, for things that move on their own, such as door leaves.
// `swap` may give a part its own material, as a sign's lit letters.
export function kitObject(piece: KitPiece | undefined, tint?: number, swap?: (material: SurfaceMaterial) => SurfaceMaterial): Object3D {
  const object = new Object3D();
  for (const { geometry, material } of piece?.parts ?? []) {
    let surface = swap ? swap(material) : material;
    if (tint !== undefined && tinted(material)) {
      surface = material.clone();
      (surface as SurfaceMaterial & { color: Color }).color.set(tint);
    }
    const mesh = new Mesh(geometry, surface);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    object.add(mesh);
  }
  return object;
}
