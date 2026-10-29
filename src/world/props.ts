import { InstancedMesh, Matrix4, Mesh, Quaternion, Scene, Vector3, type BufferGeometry, type Material as SurfaceMaterial } from "three/webgpu";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { terrainHeight, toLocal, type Arena, type ArenaData } from "./arena";
import { CollisionWorld } from "./collision";
import { type WorldEntity } from "./entities";
import { type Material } from "./materials";
import { makeWeaponPickups } from "../game/combatRules";

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

// Seeded so every client places the same props in the same order.
function random(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function propEntity(id: string, model: PropModel, east: number, north: number, base: number, yaw: number): WorldEntity {
  const [x, y, z] = model.size;
  return {
    id, kind: "prop", prop: model.name, material: model.material, maxHealth: HEALTH[model.name] ?? Infinity, mass: model.mass, yaw,
    center: { x: east, y: base + y / 2, z: north },
    shape: ROUND.has(model.name) ? { type: "cylinder", halfHeight: y / 2, radius: Math.max(x, z) / 2 * 0.96 } : { type: "box", half: [x / 2, y / 2, z / 2] },
  };
}

// Street props on the pavements inside the playable block: stacked crates, drum pairs,
// bins, boxes and plastic crates, clear of spawns, pickups, cover and each other.
export function placeStreetProps(data: ArenaData, arena: Arena, models: PropModel[]): WorldEntity[] {
  const byName = new Map(models.map((model) => [model.name, model]));
  const collision = new CollisionWorld(data);
  const [centerEast, centerNorth] = toLocal(arena.latitude, arena.longitude);
  const spawns = Array.from({ length: 8 }, (_, slot) => collision.findSpawn(arena, slot));
  const pickups = makeWeaponPickups(data, arena);
  const next = random(20261029);
  const spots: { east: number; north: number; yaw: number }[] = [];
  for (const road of data.roads) {
    if (road.width < 8) continue;
    const [a, b] = road.points;
    const dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz);
    if (length < 6) continue;
    for (const side of [-1, 1]) for (let along = 3; along < length - 3; along += 9) {
      const offset = road.width / 2 + 2.2;
      spots.push({ east: a[0] + dx / length * along - side * dz / length * offset, north: a[1] + dz / length * along + side * dx / length * offset, yaw: Math.atan2(dx, dz) });
    }
  }
  for (let i = spots.length - 1; i > 0; i -= 1) { const j = Math.floor(next() * (i + 1)); [spots[i], spots[j]] = [spots[j], spots[i]]; }
  const used: { east: number; north: number }[] = [];
  const clear = (east: number, north: number): boolean => Math.abs(east - centerEast) < arena.sizeMeters / 2 - 4 && Math.abs(north - centerNorth) < arena.sizeMeters / 2 - 4
    && !collision.blocked(east, north, 1.3) && spawns.every((spawn) => Math.hypot(spawn.east - east, spawn.north - north) > 5)
    && pickups.every((pickup) => Math.hypot(pickup.east - east, pickup.north - north) > 3.5) && used.every((spot) => Math.hypot(spot.east - east, spot.north - north) > 6);
  const groups: { count: number; layout: [string, number, number, number][] }[] = [
    // [model, offset across, offset along, stacked on height]
    { count: 4, layout: [["crate_wood_large", 0, 0, 0], ["crate_wood", 0, 0.05, 0.465], ["crate_wood", 0, 1.1, 0]] },
    { count: 3, layout: [["oil_drum", 0, -0.36, 0], ["oil_drum", 0, 0.36, 0]] },
    { count: 6, layout: [["trash_can", 0, 0, 0]] },
    { count: 4, layout: [["cardboard_box", 0, 0, 0], ["cardboard_box", 0, 0.02, 0.342], ["cardboard_box", 0.1, 0.62, 0]] },
    { count: 3, layout: [["plastic_crate", 0, 0, 0], ["plastic_crate", 0, 0, 0.254]] },
  ];
  const entities: WorldEntity[] = [];
  let spot = 0;
  for (const group of groups) {
    for (let placed = 0; placed < group.count && spot < spots.length; spot += 1) {
      const { east, north, yaw } = spots[spot];
      if (!clear(east, north)) continue;
      used.push({ east, north });
      placed += 1;
      for (const [name, across, along, stacked] of group.layout) {
        const model = byName.get(name);
        if (!model) continue;
        const x = east + Math.sin(yaw) * along + Math.cos(yaw) * across, z = north + Math.cos(yaw) * along - Math.sin(yaw) * across;
        const twist = (next() - 0.5) * 0.5;
        entities.push(propEntity(`prop:${entities.length}`, model, x, z, terrainHeight(data, east, north) + stacked, yaw + twist));
      }
    }
  }
  return entities;
}

// The drawn props: every part of each model is one instanced mesh holding all props of
// that model, so 52 props cost a draw call per model part rather than per prop.
// Instances follow their physics bodies every frame and shrink to nothing when broken.
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
