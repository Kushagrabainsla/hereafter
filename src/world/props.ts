import { InstancedMesh, Matrix4, Mesh, Quaternion, Scene, Vector3, type BufferGeometry, type Material as SurfaceMaterial } from "three/webgpu";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { type WorldEntity } from "./entities";
import { type Material } from "./materials";

export interface PropModel { name: string; file: string; size: [number, number, number]; material: Material; mass: number }

// Durability of breakable props; the rest dent and get thrown around but stay whole.
const HEALTH: Record<string, number> = { crate_wood: 70, crate_wood_large: 140, cardboard_box: 25, plastic_crate: 45 };
const ROUND = new Set(["trash_can", "oil_drum"]);
const SHADOWLESS = new Set(["cardboard_box", "plastic_crate"]);

export async function loadPropModels(): Promise<PropModel[]> {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}models/props/props.json`);
    return response.ok ? await response.json() as PropModel[] : [];
  } catch {
    return [];
  }
}

export function propEntity(id: string, model: PropModel, east: number, north: number, base: number, yaw: number): WorldEntity {
  const [x, y, z] = model.size;
  return {
    id, kind: "prop", prop: model.name, material: model.material, maxHealth: HEALTH[model.name] ?? Infinity, mass: model.mass, yaw,
    center: { x: east, y: base + y / 2, z: north },
    shape: ROUND.has(model.name) ? { type: "cylinder", halfHeight: y / 2, radius: Math.max(x, z) / 2 * 0.96 } : { type: "box", half: [x / 2, y / 2, z / 2] },
  };
}

export class PropViews {
  private parts = new Map<string, { geometry: BufferGeometry; material: SurfaceMaterial | SurfaceMaterial[]; matrix: Matrix4 }[]>();
  private meshes = new Map<string, InstancedMesh[]>();
  private slots = new Map<string, { model: string; index: number; drop: number; hidden: boolean }>();
  private counts = new Map<string, number>();
  private body = new Matrix4();
  private part = new Matrix4();
  private zero = new Matrix4().makeScale(0, 0, 0);
  private position = new Vector3();
  private quaternion = new Quaternion();
  private one = new Vector3(1, 1, 1);

  constructor(private scene: Scene) {}

  async load(models: PropModel[]): Promise<void> {
    const loader = new GLTFLoader();
    await Promise.all(models.map(async (model) => {
      try {
        const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}${model.file}`);
        gltf.scene.updateMatrixWorld(true);
        const parts: { geometry: BufferGeometry; material: SurfaceMaterial | SurfaceMaterial[]; matrix: Matrix4 }[] = [];
        gltf.scene.traverse((object) => { if (object instanceof Mesh) parts.push({ geometry: object.geometry, material: object.material, matrix: object.matrixWorld.clone() }); });
        this.parts.set(model.name, parts);
      } catch (error) {
        console.warn(`Could not load prop ${model.name}`, error);
      }
    }));
  }

  // Creates the instanced meshes once every prop has been registered with add().
  add(entity: WorldEntity): void {
    if (!entity.prop || !this.parts.has(entity.prop)) return;
    const index = this.counts.get(entity.prop) ?? 0;
    this.counts.set(entity.prop, index + 1);
    // Models sit with their base at y = 0; bodies are centred, so drop the model half its height.
    const drop = entity.shape?.type === "box" ? entity.shape.half[1] : entity.shape?.type === "cylinder" ? entity.shape.halfHeight : 0;
    this.slots.set(entity.id, { model: entity.prop, index, drop, hidden: false });
  }

  build(entities: WorldEntity[]): void {
    for (const [model, count] of this.counts) {
      const meshes = (this.parts.get(model) ?? []).map(({ geometry, material }) => {
        const mesh = new InstancedMesh(geometry, material, count);
        // Small light props skip the shadow pass; their shadows barely show.
        mesh.castShadow = !SHADOWLESS.has(model);
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        this.scene.add(mesh);
        return mesh;
      });
      this.meshes.set(model, meshes);
    }
    for (const entity of entities) {
      if (!this.slots.has(entity.id)) continue;
      this.place(entity.id, entity.center, { x: 0, y: Math.sin(entity.yaw / 2), z: 0, w: Math.cos(entity.yaw / 2) });
    }
  }

  place(id: string, position: { x: number; y: number; z: number }, rotation: { x: number; y: number; z: number; w: number }): void {
    const slot = this.slots.get(id);
    if (!slot || slot.hidden) return;
    const meshes = this.meshes.get(slot.model);
    const parts = this.parts.get(slot.model);
    if (!meshes || !parts) return;
    this.body.compose(this.position.set(position.x, position.y, position.z), this.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w), this.one);
    this.body.multiply(this.part.makeTranslation(0, -slot.drop, 0));
    meshes.forEach((mesh, index) => {
      mesh.setMatrixAt(slot.index, this.part.multiplyMatrices(this.body, parts[index].matrix));
      mesh.instanceMatrix.needsUpdate = true;
    });
  }

  setVisible(id: string, visible: boolean): void {
    const slot = this.slots.get(id);
    if (!slot) return;
    slot.hidden = !visible;
    if (visible) return;
    for (const mesh of this.meshes.get(slot.model) ?? []) { mesh.setMatrixAt(slot.index, this.zero); mesh.instanceMatrix.needsUpdate = true; }
  }
}
