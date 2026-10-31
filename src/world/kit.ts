import { BufferGeometry, Color, InstancedMesh, Matrix4, Mesh, Object3D, type Material as SurfaceMaterial } from "three/webgpu";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { type InstanceRef } from "./entities";

// The pieces that dress the market's walls (public/models/market-kit.glb, built by
// scripts/kit/build.py): doors, frames, boards, air conditioners, downpipes, meters, vents,
// steam pipes, fire escapes and the record shop's fittings. Each is modelled against a wall,
// facing +Z, with its origin where it mounts.

export function loadMarketKit(): Promise<GLTF | null> {
  const url = `${import.meta.env.BASE_URL}models/market-kit.glb`;
  return new GLTFLoader().loadAsync(url).catch((error: unknown) => { console.warn("Could not load the market kit.", error); return null; });
}

// A piece in its own frame, merged into one geometry per material.
export interface KitPiece { parts: { geometry: BufferGeometry; material: SurfaceMaterial }[] }

export function kitPieces(gltf: GLTF | null): Map<string, KitPiece> {
  const pieces = new Map<string, KitPiece>();
  if (!gltf) return pieces;
  gltf.scene.updateMatrixWorld(true);
  for (const node of gltf.scene.children) {
    const toPiece = node.matrixWorld.clone().invert();
    const byMaterial = new Map<SurfaceMaterial, BufferGeometry[]>();
    node.traverse((object) => {
      const mesh = object as Mesh;
      if (!mesh.isMesh) return;
      const material = mesh.material as SurfaceMaterial;
      const list = byMaterial.get(material) ?? [];
      list.push(mesh.geometry.clone().applyMatrix4(toPiece.clone().multiply(mesh.matrixWorld)));
      byMaterial.set(material, list);
    });
    const parts = [...byMaterial].map(([material, list]) => ({ geometry: list.length > 1 ? mergeGeometries(list, false)! : list[0], material }));
    pieces.set(node.name, { parts });
  }
  return pieces;
}

// Pale materials named paint_* take each copy's own colour.
const tinted = (material: SurfaceMaterial): boolean => material.name.startsWith("paint_");

// Copies of kit pieces drawn as one instanced mesh per piece and material. Each placement
// returns the instances that draw it, filled in by build(), so an entity can hide them.
export class KitPlacer {
  private placements = new Map<string, { matrix: Matrix4; tint?: number; refs: InstanceRef[] }[]>();

  constructor(private pieces: Map<string, KitPiece>) {}

  has(name: string): boolean { return this.pieces.has(name); }

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

// One copy of a piece as plain meshes, for things that move on their own, such as door leaves.
export function kitObject(piece: KitPiece | undefined, tint?: number): Object3D {
  const object = new Object3D();
  for (const { geometry, material } of piece?.parts ?? []) {
    let surface = material;
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
