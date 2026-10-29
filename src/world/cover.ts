import { BoxGeometry, InstancedMesh, Mesh, MeshStandardMaterial, Object3D, Scene } from "three/webgpu";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { terrainHeight, type ArenaData } from "./arena";
import { CollisionWorld } from "./collision";
import { type InstanceRef } from "./scenery";

// Each cover piece is drawn as two barrier segments; refs maps cover:<piece>:<segment> to its instance.
export async function addCover(scene: Scene, data: ArenaData): Promise<Map<string, InstanceRef[]>> {
  const refs = new Map<string, InstanceRef[]>();
  const cover = new CollisionWorld(data).cover.map((item, piece) => ({ ...item, piece }));
  if (cover.length === 0) return refs;
  let model: Mesh | null = null;
  try {
    const gltf = await new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}models/concrete_road_barrier_02/barrier-optimized.glb`);
    gltf.scene.traverse((object) => {
      if (!model && object instanceof Mesh) model = object;
    });
  } catch (error) {
    console.warn("Detailed cover model unavailable; using simple cover geometry", error);
  }
  const geometry = model ? (model as Mesh).geometry : new BoxGeometry(1.56, 1.1, 0.44);
  const material = model ? (model as Mesh).material : new MeshStandardMaterial({ color: 0xa6a398, roughness: 0.96 });
  const cells = new Map<string, typeof cover>();
  for (const item of cover) {
    const key = `${Math.floor(item.east / 48)}:${Math.floor(item.north / 48)}`;
    const cell = cells.get(key) ?? [];
    cell.push(item);
    cells.set(key, cell);
  }
  const transform = new Object3D();
  for (const cell of cells.values()) {
    const instances = new InstancedMesh(geometry, material, cell.length * 2);
    cell.forEach((item, index) => {
      for (const [sideIndex, side] of [-1, 1].entries()) {
        transform.position.set(
          item.east + side * 0.78 * Math.cos(item.yaw),
          terrainHeight(data, item.east, item.north) + (model ? 0.02 : 0.55),
          item.north - side * 0.78 * Math.sin(item.yaw),
        );
        transform.rotation.set(0, item.yaw, 0);
        transform.updateMatrix();
        instances.setMatrixAt(index * 2 + sideIndex, transform.matrix);
        refs.set(`cover:${item.piece}:${sideIndex}`, [{ mesh: instances, index: index * 2 + sideIndex }]);
      }
    });
    instances.instanceMatrix.needsUpdate = true;
    instances.castShadow = true;
    instances.receiveShadow = true;
    scene.add(instances);
  }
  return refs;
}
