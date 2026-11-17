import { Color, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, MeshStandardNodeMaterial, Quaternion, Scene, Vector3, type BufferGeometry, type Material as SurfaceMaterial } from "three/webgpu";
import { clamp, float, materialColor, materialRoughness, max, min, mix, normalWorld, positionGeometry, positionWorld, select, smoothstep, texture3D, uniform, vec2, vec3, vec4 } from "three/tsl";
import type { Node } from "three/webgpu";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { noiseVolume } from "./noiseVolume";
import { outdoorNode, WEATHER } from "./wetness";
import { type WorldEntity } from "./entities";
import { type Material } from "./materials";
import { assetFetch } from "../assetStore";

export interface PropModel { name: string; file: string; size: [number, number, number]; material: Material; mass: number }

// Durability of breakable props; the rest dent and get thrown around but stay whole.
const HEALTH: Record<string, number> = { crate_wood: 70, crate_wood_large: 140, cardboard_box: 25, plastic_crate: 45, fuel_drum: 16, dining_chair: 40, dining_table: 120, cafe_table: 70, plastic_stool: 20,
  rubbish_bag: 30, pallet: 90, jerrycan: 40, water_bottle: 8, wet_floor_sign: 20, monobloc_chair: 35, clay_pot: 15, cement_sack: 60 };
// Tyres lie flat and roll off a stack; pots are round too.
const ROUND = new Set(["trash_can", "oil_drum", "fuel_drum", "tyre", "clay_pot"]);
// Shot open, these vent burning fuel and then burst like a grenade.
const EXPLOSIVE = new Set(["fuel_drum"]);

// A red fuel drum, modelled in the market kit rather than taken from a photo scan.
export const FUEL_DRUM: PropModel = { name: "fuel_drum", file: "", size: [0.62, 0.92, 0.62], material: "metal-thin", mass: 60 };
// A timber pallet from the street family (scripts/assets/families/street.py), as found in alleys.
export const PALLET: PropModel = { name: "pallet", file: "", size: [1.22, 0.144, 1.02], material: "wood", mass: 22 };
// Furniture from the kit (scripts/assets/families/furniture.py), with what it really weighs. The
// steel bar stools dent but do not break.
export const FURNITURE: PropModel[] = [
  { name: "dining_chair", file: "", size: [0.42, 0.85, 0.42], material: "wood", mass: 5 },
  { name: "dining_table", file: "", size: [0.8, 0.76, 0.8], material: "wood", mass: 18 },
  { name: "cafe_table", file: "", size: [1.1, 0.76, 1.1], material: "wood", mass: 9 },
  { name: "bar_stool", file: "", size: [0.41, 0.75, 0.41], material: "metal-thin", mass: 9 },
  { name: "plastic_stool", file: "", size: [0.42, 0.46, 0.42], material: "plastic", mass: 1.2 },
];
// What the game calls each prop when offering it to the player.
export const PROP_LABEL: Record<string, string> = {
  crate_wood: "the crate", crate_wood_large: "the big crate", trash_can: "the trash can", oil_drum: "the oil drum", cardboard_box: "the cardboard box", aircon_unit: "the air conditioner", plastic_crate: "the plastic crate",
  fuel_drum: "the fuel drum", dining_chair: "the chair", dining_table: "the table", cafe_table: "the folding table", bar_stool: "the bar stool", plastic_stool: "the stool",
  tyre: "the tyre", cement_sack: "the cement sack", rubbish_bag: "the rubbish bag", jerrycan: "the water can", jerrycan_steel: "the jerrycan", water_bottle: "the water bottle",
  wet_floor_sign: "the wet floor sign", pallet: "the pallet", monobloc_chair: "the plastic chair", clay_pot: "the plant pot",
};
const SHADOWLESS = new Set(["cardboard_box", "plastic_crate", "water_bottle", "clay_pot", "wet_floor_sign", ...FURNITURE.map((model) => model.name)]);

// The photo-scanned props come clean from the studio. In the alley they take the same weather as
// the modelled kit (surfaces.ts), lightly, over their own textures: grime splashed up from the
// street on their lower 60 cm, dust on what faces up, broad dirty patches, and in the rain their
// tops and lower sides darken and turn glossy. The patches follow each prop's own shape, so a prop
// keeps them when it is knocked over; the splash band stays at the street, wherever the prop lies.
const GRIME = vec3(0.55, 0.49, 0.41);
// The drums, the trash can and the scanned air conditioner stand out in the weather longest and
// age harder: dirt runs down their sides, a grime film in patches, and on the drums rust in rings
// at the rims and hoops, where water and knocks reach, with rust runs below the hoops. The bands
// are measured in the model's own frame (its file puts the base at zero), so they follow the drum
// when it is knocked over.
const HEAVY = new Set(["oil_drum", "trash_can", "aircon_unit"]);
function weathered(source: MeshStandardMaterial, model?: PropModel, matrix?: Matrix4): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial();
  material.copy(source);
  const patches = texture3D(noiseVolume(), positionGeometry.mul(1 / 0.7)).g;
  const speckle = texture3D(noiseVolume(), positionGeometry.mul(1 / 0.12)).b;
  const low = float(1).sub(smoothstep(0.02, 0.6, positionWorld.y));
  const up = smoothstep(0.5, 0.95, normalWorld.y);
  const dirty = clamp(low.mul(0.6).add(up.mul(0.35)).add(smoothstep(0.45, 0.75, patches).mul(0.35)), 0, 1).mul(speckle.mul(0.5).add(0.5)).mul(0.7);
  const wet = clamp(up.mul(0.7).add(low.mul(0.6)), 0, 1).mul(smoothstep(0.97, 1, outdoorNode(positionWorld))).mul(WEATHER.wet);
  let color: Node<"vec3"> = materialColor.mul(mix(vec3(1), GRIME, dirty));
  let rough: Node<"float"> = materialRoughness.add(dirty.mul(0.15));
  if (model && HEAVY.has(model.name)) {
    const P = uniform(matrix!).mul(vec4(positionGeometry, 1)).xyz;
    const height = model.size[1];
    // Runs start where water leaves a ledge (the top, and on a drum its two hoops) and stop at their
    // own lengths, from 5 cm to 45 cm, and only in some stretches round the side: full-height runs
    // at even spacing read as a regular stripe pattern.
    const sources = model.name === "oil_drum" ? [height, height * 0.67, height * 0.33] : [height];
    let fromSource: Node<"float"> = float(9);
    for (const at of sources) fromSource = min(fromSource, select(P.y.lessThan(at), float(at).sub(P.y), float(9)));
    const column = texture3D(noiseVolume(), vec3(P.x.mul(2.6), P.z.mul(2.6), P.y.mul(0.15))).b;
    const reach = texture3D(noiseVolume(), vec3(P.x.mul(1.7), P.z.mul(1.7), float(0.37))).g.mul(0.4).add(0.05);
    const some = smoothstep(0.4, 0.65, texture3D(noiseVolume(), P.mul(0.9).add(0.5)).r);
    const runs = smoothstep(0.55, 0.8, column).mul(smoothstep(reach, reach.mul(0.3), fromSource)).mul(some).mul(float(1).sub(up));
    const film = smoothstep(0.35, 0.7, texture3D(noiseVolume(), P.mul(1 / 0.35)).r);
    color = color.mul(mix(vec3(1), GRIME.mul(0.7), clamp(runs.mul(0.6).add(film.mul(0.35)).add(up.mul(0.3)), 0, 1)));
    rough = rough.add(film.mul(0.1));
    // Rust at the bottom and top rims, the two rolling hoops and round the edge of the lid.
    if (model.name === "oil_drum") {
      const ragged = speckle.mul(0.03);
      const band = (centre: number, half: number): Node<"float"> => smoothstep(float(half), float(0), P.y.sub(centre).abs().add(ragged));
      const rims = max(max(band(0, 0.06), band(height, 0.06)), max(band(height * 0.33, 0.03), band(height * 0.67, 0.03)));
      const lid = up.mul(smoothstep(0.2, 0.3, vec2(P.x, P.z).length()));
      // The rust comes and goes round each ring, so no rim carries one even band.
      const stretches = smoothstep(0.3, 0.6, texture3D(noiseVolume(), P.mul(1.6).add(0.21)).g);
      const rusty = clamp(max(rims, lid), 0, 1).mul(smoothstep(0.25, 0.65, patches.mul(0.5).add(speckle.mul(0.6)))).mul(stretches);
      const below = runs.mul(smoothstep(0.35, 0.0, P.y.sub(height * 0.33).abs().min(P.y.sub(height * 0.67).abs())));
      color = mix(color, mix(vec3(0.17, 0.08, 0.04), vec3(0.36, 0.16, 0.06), speckle), rusty);
      color = mix(color, color.mul(vec3(0.72, 0.52, 0.38)), below.mul(0.7));
      rough = rough.add(rusty.mul(0.4));
    }
  }
  material.colorNode = color.mul(float(1).sub(wet.mul(0.22)));
  material.roughnessNode = clamp(rough.mul(float(1).sub(wet.mul(0.5))), 0.05, 1);
  return material;
}

export async function loadPropModels(): Promise<PropModel[]> {
  try {
    const response = await assetFetch(`${import.meta.env.BASE_URL}models/props/props.json`);
    return response.ok ? await response.json() as PropModel[] : [];
  } catch {
    return [];
  }
}

export function propEntity(id: string, model: PropModel, east: number, north: number, base: number, yaw: number): WorldEntity {
  const [x, y, z] = model.size;
  return {
    id, kind: "prop", prop: model.name, material: model.material, maxHealth: HEALTH[model.name] ?? Infinity, mass: model.mass, yaw, explosive: EXPLOSIVE.has(model.name) || undefined,
    center: { x: east, y: base + y / 2, z: north },
    shape: ROUND.has(model.name) ? { type: "cylinder", halfHeight: y / 2, radius: Math.max(x, z) / 2 * 0.96 } : { type: "box", half: [x / 2, y / 2, z / 2] },
  };
}

export class PropViews {
  private parts = new Map<string, { geometry: BufferGeometry; material: SurfaceMaterial | SurfaceMaterial[]; matrix: Matrix4 }[]>();
  private meshes = new Map<string, InstancedMesh[]>();
  private slots = new Map<string, { model: string; index: number; drop: number; hidden: boolean; last: number[]; tint?: number }>();
  private shade = new Color();
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
        gltf.scene.traverse((object) => {
          if (!(object instanceof Mesh)) return;
          const source = object.material as SurfaceMaterial;
          const material = source instanceof MeshStandardMaterial && !source.transparent ? weathered(source, model, object.matrixWorld.clone()) : source;
          parts.push({ geometry: object.geometry, material, matrix: object.matrixWorld.clone() });
        });
        this.parts.set(model.name, parts);
      } catch (error) {
        console.warn(`Could not load prop ${model.name}`, error);
      }
    }));
  }

  // A model built some other way than from a prop file, such as a kit piece.
  addModel(name: string, parts: { geometry: BufferGeometry; material: SurfaceMaterial }[]): void {
    if (parts.length) this.parts.set(name, parts.map((part) => ({ ...part, matrix: new Matrix4() })));
  }

  // Creates the instanced meshes once every prop has been registered with add().
  add(entity: WorldEntity): void {
    if (!entity.prop || !this.parts.has(entity.prop)) return;
    const index = this.counts.get(entity.prop) ?? 0;
    this.counts.set(entity.prop, index + 1);
    // Models sit with their base at y = 0; bodies are centred, so drop the model half its height.
    const drop = entity.shape?.type === "box" ? entity.shape.half[1] : entity.shape?.type === "cylinder" ? entity.shape.halfHeight : 0;
    this.slots.set(entity.id, { model: entity.prop, index, drop, hidden: false, last: [], tint: entity.tint });
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
      const slot = this.slots.get(entity.id);
      if (!slot) continue;
      // Pale parts take each copy's own colour, like the plastic stools; every copy has a colour
      // so that it can char.
      this.paint(slot, 0);
      this.place(entity.id, entity.center, { x: 0, y: Math.sin(entity.yaw / 2), z: 0, w: Math.cos(entity.yaw / 2) });
    }
  }

  // A prop's model and how far it sits below its body's middle, for drawing another copy of it.
  partsOf(id: string): { parts: { geometry: BufferGeometry; matrix: Matrix4 }[]; drop: number } | null {
    const slot = this.slots.get(id), parts = slot && this.parts.get(slot.model);
    return slot && parts ? { parts, drop: slot.drop } : null;
  }

  place(id: string, position: { x: number; y: number; z: number }, rotation: { x: number; y: number; z: number; w: number }): void {
    const slot = this.slots.get(id);
    if (!slot || slot.hidden) return;
    // Most props are at rest, and a moved instance is sent to the graphics card again.
    const now = [position.x, position.y, position.z, rotation.x, rotation.y, rotation.z, rotation.w];
    if (now.every((value, index) => value === slot.last[index])) return;
    slot.last = now;
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

  private paint(slot: { model: string; index: number; tint?: number }, char: number): void {
    for (const mesh of this.meshes.get(slot.model) ?? []) {
      this.shade.set(slot.tint !== undefined && (mesh.material as SurfaceMaterial).name.startsWith("paint_") ? slot.tint : 0xffffff).multiplyScalar(1 - 0.94 * char);
      mesh.setColorAt(slot.index, this.shade);
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  // How burned a prop looks, 0 to 1.
  setChar(id: string, amount: number): void {
    const slot = this.slots.get(id);
    if (slot) this.paint(slot, amount);
  }

  setVisible(id: string, visible: boolean): void {
    const slot = this.slots.get(id);
    if (!slot) return;
    slot.hidden = !visible;
    slot.last = [];
    if (visible) return;
    for (const mesh of this.meshes.get(slot.model) ?? []) { mesh.setMatrixAt(slot.index, this.zero); mesh.instanceMatrix.needsUpdate = true; }
  }
}
