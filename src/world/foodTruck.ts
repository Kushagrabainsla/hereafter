import {
  AdditiveBlending, CanvasTexture, Color, Group, Mesh, MeshStandardMaterial, MeshStandardNodeMaterial, Object3D, Quaternion, Scene,
  SRGBColorSpace, Sprite, SpriteMaterial, Vector3, type Material as SurfaceMaterial,
} from "three/webgpu";
import { float, materialColor, mix, mx_fractal_noise_float, positionWorld, smoothstep, vec3 } from "three/tsl";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { type LayoutBox, type MapToggle } from "./arena";
import { type Material } from "./materials";
import { type Vec3, type WorldEntity } from "./entities";

// The food truck closing the north end of the market alley: a step van turned kitchen
// (public/models/food-truck.glb, built by scripts/truck/build.py). Its cab points east and its
// serving side faces the market. Players climb in through the rear doors by the bumper step,
// open or close the serving hatch and the doors, shoot out its glass, flatten its tyres and
// set off the two propane cylinders on its side.
//
// Everything here is plain data shared by every client, in world metres, except the view at
// the bottom, which draws and animates the model.

// The model's origin: on the ground under the middle of its footprint.
export const TRUCK_AT = { x: -4, z: -26 };
const at = (x: number, y: number, z: number): Vec3 => ({ x: TRUCK_AT.x + x, y, z: TRUCK_AT.z + z });

function solid(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, material: Material): LayoutBox {
  return { half: [(x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2], center: at((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), material, look: "none" };
}

// A thin steel skin that rounds go through, a heavy engine, cooking line and fridge that stop
// them, and a hollow kitchen box with a floor 0.44 m up, reached by the 0.22 m bumper step.
export const TRUCK_SOLIDS: LayoutBox[] = [
  solid(-3.1, 1.55, 0.3, 0.44, -1.2, 1.2, "metal-thin"),
  solid(-3.1, 1.55, 2.9, 3.0, -1.2, 1.2, "metal-thin"),
  // The serving side, around its window.
  solid(-3.1, 1.55, 0.44, 1.3, 1.15, 1.2, "metal-thin"),
  solid(-3.1, 1.55, 2.3, 2.9, 1.15, 1.2, "metal-thin"),
  solid(-3.1, -1.6, 1.3, 2.3, 1.15, 1.2, "metal-thin"),
  solid(0.9, 1.55, 1.3, 2.3, 1.15, 1.2, "metal-thin"),
  // The far side and the rear wall around the doorway.
  solid(-3.1, 1.55, 0.44, 2.9, -1.2, -1.15, "metal-thin"),
  solid(-3.1, -3.05, 0.44, 2.9, -1.2, -1.0, "metal-thin"),
  solid(-3.1, -3.05, 0.44, 2.9, 1.0, 1.2, "metal-thin"),
  solid(-3.1, -3.05, 2.45, 2.9, -1.0, 1.0, "metal-thin"),
  solid(-3.32, -3.1, 0.1, 0.22, -1.18, 1.18, "metal-solid"),
  // The cab: the engine low in the nose, and the cab itself behind the windscreen.
  solid(1.55, 3.22, 0.3, 1.45, -1.1, 1.1, "metal-solid"),
  solid(1.55, 2.7, 1.45, 2.95, -1.1, 1.1, "metal-thin"),
  // Inside: the serving counter, a stock rack, the cooking line, the fridge, the hood and a wheel well.
  solid(-1.7, 0.95, 0.44, 1.28, 0.6, 1.15, "metal-thin"),
  solid(-3.05, -2.6, 0.44, 2.0, 0.62, 1.15, "metal-thin"),
  solid(-2.42, 0.92, 0.44, 1.05, -1.15, -0.53, "metal-solid"),
  solid(0.92, 1.5, 0.44, 2.6, -1.15, -0.5, "metal-solid"),
  solid(-2.5, 0.3, 2.25, 2.85, -1.15, -0.5, "metal-thin"),
  solid(-2.07, -1.7, 0.44, 0.98, 0.85, 1.15, "metal-thin"),
  // The cage around the propane cylinders keeps players out but lets rounds reach them.
  solid(-2.98, -2.3, 0.34, 1.08, -1.53, -1.2, "boundary"),
];

const TYRE: Pick<WorldEntity, "kind" | "material" | "maxHealth" | "yaw" | "shape"> = { kind: "tyre", material: "rubber", maxHealth: 40, yaw: 0, shape: { type: "box", half: [0.42, 0.42, 0.14] } };
const TANK: Pick<WorldEntity, "kind" | "material" | "maxHealth" | "yaw" | "shape" | "explosive"> = { kind: "tank", material: "metal-thin", maxHealth: 16, yaw: 0, shape: { type: "cylinder", halfHeight: 0.33, radius: 0.15 }, explosive: true };

// What breaks: the glass, the four tyres and the two propane cylinders.
export const TRUCK_ENTITIES: WorldEntity[] = [
  { id: "truck:glass-serving", kind: "pane", material: "glass", maxHealth: 1, yaw: 0, center: at(0.275, 1.8, 1.18), shape: { type: "box", half: [0.63, 0.5, 0.02] } },
  { id: "truck:windshield", kind: "pane", material: "glass", maxHealth: 1, yaw: Math.PI / 2, center: at(2.86, 2.15, 0), shape: { type: "box", half: [1.05, 0.62, 0.12] } },
  { id: "truck:cab-left", kind: "pane", material: "glass", maxHealth: 1, yaw: Math.PI, center: at(2.12, 2.085, -1.14), shape: { type: "box", half: [0.4, 0.465, 0.03] } },
  { id: "truck:cab-right", kind: "pane", material: "glass", maxHealth: 1, yaw: 0, center: at(2.12, 2.085, 1.14), shape: { type: "box", half: [0.4, 0.465, 0.03] } },
  { id: "truck:tyre-fl", ...TYRE, center: at(2.15, 0.42, -1.03) },
  { id: "truck:tyre-fr", ...TYRE, center: at(2.15, 0.42, 1.03) },
  { id: "truck:tyre-rl", ...TYRE, center: at(-1.55, 0.42, -1.03) },
  { id: "truck:tyre-rr", ...TYRE, center: at(-1.55, 0.42, 1.03) },
  { id: "truck:propane-a", ...TANK, center: at(-2.8, 0.71, -1.36) },
  { id: "truck:propane-b", ...TANK, center: at(-2.48, 0.71, -1.36) },
];

// Panels that swing on hinges. Each turns about a hinge line through `hinge` along its axis
// from 0 (as modelled, shut) to `open` radians; `offset` is the panel's centre from the hinge
// when shut and `half` its size, for its collider.
interface Swing { node: string; hinge: Vec3; axis: "x" | "y"; open: number; offset: Vec3; half: [number, number, number] }
export const TRUCK_SWINGS: Record<string, Swing[]> = {
  "truck:hatch": [{ node: "hatch", hinge: at(-0.35, 2.38, 1.2), axis: "x", open: -1.75, offset: { x: 0, y: -0.59, z: 0.02 }, half: [1.35, 0.59, 0.02] }],
  "truck:doors": [
    { node: "door_left", hinge: at(-3.1, 1.445, -1.0), axis: "y", open: -1.75, offset: { x: -0.005, y: 0, z: 0.5 }, half: [0.025, 0.99, 0.495] },
    { node: "door_right", hinge: at(-3.1, 1.445, 1.0), axis: "y", open: 1.75, offset: { x: -0.005, y: 0, z: -0.5 }, half: [0.025, 0.99, 0.495] },
  ],
};

// What players can open and close, where they reach for it, and how it starts.
export const TRUCK_TOGGLES: MapToggle[] = [
  { id: "truck:hatch", label: "the serving hatch", at: at(-0.35, 1.8, 1.3), open: true },
  { id: "truck:doors", label: "the rear doors", at: at(-3.15, 1.4, 0), open: false },
];

// Where a swinging panel's collider sits at an opening angle.
export function swingPose(swing: Swing, angle: number): { center: Vec3; rotation: Quaternion } {
  const axis = swing.axis === "x" ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
  const rotation = new Quaternion().setFromAxisAngle(axis, angle);
  const offset = new Vector3(swing.offset.x, swing.offset.y, swing.offset.z).applyQuaternion(rotation);
  return { center: { x: swing.hinge.x + offset.x, y: swing.hinge.y + offset.y, z: swing.hinge.z + offset.z }, rotation };
}

// ---------- the view ----------

export function loadFoodTruck(): Promise<GLTF | null> {
  const url = `${import.meta.env.BASE_URL}models/food-truck.glb`;
  return new GLTFLoader().loadAsync(url).catch((error: unknown) => { console.warn("Could not load the food truck.", error); return null; });
}

function canvas(width: number, height: number, draw: (g: CanvasRenderingContext2D) => void): CanvasTexture {
  const element = document.createElement("canvas");
  element.width = width;
  element.height = height;
  draw(element.getContext("2d")!);
  const texture = new CanvasTexture(element);
  // glTF texture coordinates run top-down.
  texture.flipY = false;
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

// A backlit roof sign and a menu board beside the window.
function roofSign(): CanvasTexture {
  return canvas(1024, 210, (g) => {
    const shade = g.createLinearGradient(0, 0, 0, 210);
    shade.addColorStop(0, "#21857e"); shade.addColorStop(1, "#155d58");
    g.fillStyle = shade; g.fillRect(0, 0, 1024, 210);
    g.strokeStyle = "#f4e9d0"; g.lineWidth = 8; g.strokeRect(14, 14, 996, 182);
    g.fillStyle = "#fff4dc"; g.textAlign = "center"; g.textBaseline = "middle";
    g.font = `700 120px "Avenir Next Condensed", "Helvetica Neue", Helvetica, Arial, sans-serif`;
    g.fillText("BAO & BUNS", 512, 112, 940);
  });
}

function menuBoard(): CanvasTexture {
  return canvas(320, 700, (g) => {
    g.fillStyle = "#1b1d1c"; g.fillRect(0, 0, 320, 700);
    g.strokeStyle = "#c9a46a"; g.lineWidth = 10; g.strokeRect(5, 5, 310, 690);
    g.textAlign = "left"; g.textBaseline = "alphabetic";
    g.fillStyle = "#ffe9b0"; g.font = `700 54px "Avenir Next Condensed", Helvetica, Arial, sans-serif`;
    g.fillText("MENU", 28, 82);
    const items = [["Pork belly bao", "6"], ["Chicken katsu", "6"], ["Tofu bao", "5"], ["Bao fries", "4"], ["Dumplings (6)", "7"], ["Milk tea", "5"], ["Lychee soda", "4"]];
    g.font = `500 27px "Avenir Next Condensed", Helvetica, Arial, sans-serif`;
    items.forEach(([name, price], i) => {
      const y = 160 + i * 74;
      g.fillStyle = "#f4f0e6"; g.fillText(name, 28, y);
      g.fillStyle = "#7dd3c0"; g.textAlign = "right"; g.fillText(price, 292, y); g.textAlign = "left";
      g.fillStyle = "rgba(244,240,230,0.25)"; g.fillRect(28, y + 16, 264, 2);
    });
    g.fillStyle = "#ff8a5c"; g.font = `600 24px "Avenir Next Condensed", Helvetica, Arial, sans-serif`;
    g.fillText("CASH · CARD", 28, 670);
  });
}

// Grime on the paint: darker toward the ground and in broad noisy patches, like the walls.
function weathered(source: MeshStandardMaterial): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial();
  material.copy(source);
  const p = positionWorld;
  const patches = mx_fractal_noise_float(p.mul(vec3(1.3, 0.9, 1.3))).mul(0.5).add(0.5).clamp(0, 1);
  const road = smoothstep(0.1, 1.3, p.y);
  material.colorNode = materialColor.mul(mix(float(0.62), float(1), road)).mul(mix(float(0.86), float(1.04), patches));
  return material;
}

interface Venting { tank: Object3D; jet: Sprite; until: number }
// Each tyre's entity, its wheel node, and whether it is a front and a left wheel.
const WHEELS: [string, string, boolean, boolean][] = [["truck:tyre-fl", "wheel_fl", true, true], ["truck:tyre-fr", "wheel_fr", true, false], ["truck:tyre-rl", "wheel_rl", false, true], ["truck:tyre-rr", "wheel_rr", false, false]];

export class FoodTruck {
  readonly root = new Group();
  // Objects to hide when an entity is destroyed: the panes of glass.
  readonly groups = new Map<string, Object3D[]>();
  private nodes = new Map<string, Object3D>();
  private body = new Group();
  private angles = new Map<string, { current: number; target: number }>();
  private flats = new Set<string>();
  private venting: Venting[] = [];
  private flatness = new Map<string, number>();
  private owned: CanvasTexture[] = [];

  constructor(scene: Scene, gltf: GLTF | null, private onSwing: (id: string, swing: Swing, angle: number) => void) {
    this.root.position.set(TRUCK_AT.x, 0, TRUCK_AT.z);
    this.root.add(this.body);
    scene.add(this.root);
    if (!gltf) return;
    const children = [...gltf.scene.children];
    const signs: Record<string, CanvasTexture> = { roof_sign: this.own(roofSign()), menu_board: this.own(menuBoard()) };
    for (const child of children) {
      this.nodes.set(child.name, child);
      (child.name.startsWith("wheel_") ? this.root : this.body).add(child);
      child.traverse((object) => {
        if (!(object instanceof Mesh)) return;
        object.castShadow = !child.name.startsWith("glass") && child.name !== "interior_light";
        object.receiveShadow = true;
        const materials = (Array.isArray(object.material) ? object.material : [object.material]) as MeshStandardMaterial[];
        const dressed = materials.map((material) => this.dress(material, signs[child.name]));
        object.material = Array.isArray(object.material) ? dressed : dressed[0];
      });
    }
    this.groups.set("truck:glass-serving", [this.nodes.get("glass_serving")].filter(Boolean) as Object3D[]);
    this.groups.set("truck:windshield", [this.nodes.get("glass_windshield")].filter(Boolean) as Object3D[]);
    this.groups.set("truck:cab-left", [this.nodes.get("glass_cab_left")].filter(Boolean) as Object3D[]);
    this.groups.set("truck:cab-right", [this.nodes.get("glass_cab_right")].filter(Boolean) as Object3D[]);
  }

  private own(texture: CanvasTexture): CanvasTexture { this.owned.push(texture); return texture; }

  private dress(material: MeshStandardMaterial, sign?: CanvasTexture): SurfaceMaterial {
    if (sign) return new MeshStandardMaterial({ map: sign, emissive: 0xffffff, emissiveMap: sign, emissiveIntensity: 0.9, roughness: 0.5 });
    if (["paint", "teal", "red"].includes(material.name)) return weathered(material);
    if (material.name === "glass") { material.transparent = true; material.depthWrite = false; material.opacity = 0.38; }
    // The truck is parked: headlights and tail lights glow faintly, the kitchen is lit.
    if (material.name === "headlight") material.emissiveIntensity = 0.25;
    if (material.name === "tail_light") material.emissiveIntensity = 0.5;
    if (material.name === "amber") material.emissiveIntensity = 0.15;
    if (material.name === "ceiling_light") material.color = new Color(0xffffff);
    return material;
  }

  // Opens or closes each panel toward the shared state; panels swing over about half a second.
  setOpen(open: Record<string, boolean>, defaults: Record<string, boolean>, instant = false): void {
    for (const [id, swings] of Object.entries(TRUCK_SWINGS)) {
      const isOpen = open[id] ?? defaults[id] ?? false;
      for (const swing of swings) {
        const state = this.angles.get(swing.node) ?? { current: isOpen ? swing.open : 0, target: 0 };
        state.target = isOpen ? swing.open : 0;
        if (instant || !this.angles.has(swing.node)) { state.current = state.target; this.place(id, swing, state.current); }
        this.angles.set(swing.node, state);
      }
    }
  }

  private place(id: string, swing: Swing, angle: number): void {
    const node = this.nodes.get(swing.node);
    if (node) node.rotation[swing.axis] = angle;
    this.onSwing(id, swing, angle);
  }

  // A tyre that has been shot flat, or put back for a new room.
  setFlat(id: string, flat: boolean): void {
    if (flat) this.flats.add(id); else this.flats.delete(id);
  }

  // A shot cylinder vents a roaring jet of burning gas until it bursts.
  vent(id: string, seconds: number): void {
    const tank = this.nodes.get(id === "truck:propane-a" ? "propane_a" : "propane_b");
    if (!tank) return;
    const jet = new Sprite(new SpriteMaterial({ map: this.own(canvas(64, 128, (g) => {
      const flame = g.createRadialGradient(32, 110, 2, 32, 80, 60);
      flame.addColorStop(0, "rgba(255,250,220,1)"); flame.addColorStop(0.3, "rgba(255,170,60,0.85)"); flame.addColorStop(1, "rgba(255,60,10,0)");
      g.fillStyle = flame; g.fillRect(0, 0, 64, 128);
    })), color: 0xffffff, transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false }));
    jet.position.set(0, 0.75, 0);
    jet.scale.set(0.5, 1.4, 1);
    tank.add(jet);
    this.venting.push({ tank, jet, until: performance.now() + seconds * 1000 });
  }

  // Burst: the cylinder is gone.
  burst(id: string): void {
    const tank = this.nodes.get(id === "truck:propane-a" ? "propane_a" : "propane_b");
    if (tank) tank.visible = false;
    this.venting = this.venting.filter((item) => { if (item.tank !== tank) return true; item.jet.removeFromParent(); return false; });
  }

  // Back to new, for a new room.
  restore(id: string): void {
    if (id.startsWith("truck:tyre")) this.setFlat(id, false);
    if (id.startsWith("truck:propane")) {
      const tank = this.nodes.get(id === "truck:propane-a" ? "propane_a" : "propane_b");
      if (tank) tank.visible = true;
    }
  }

  update(seconds: number): void {
    for (const [id, swings] of Object.entries(TRUCK_SWINGS)) for (const swing of swings) {
      const state = this.angles.get(swing.node);
      if (!state || Math.abs(state.current - state.target) < 1e-4) continue;
      // Eased toward the target over about half a second.
      const step = Math.sign(state.target - state.current) * Math.max(0.02, Math.abs(state.target - state.current) * 0.18) * Math.min(4, seconds * 60);
      state.current = Math.abs(state.target - state.current) <= Math.abs(step) ? state.target : state.current + step;
      this.place(id, swing, state.current);
    }
    // Flat tyres squash and the body sinks toward their corners.
    let front = 0, rear = 0, left = 0, right = 0;
    for (const [id, node, isFront, isLeft] of WHEELS) {
      const target = this.flats.has(id) ? 1 : 0;
      const value = (this.flatness.get(id) ?? 0) + (target - (this.flatness.get(id) ?? 0)) * Math.min(1, seconds * 3);
      this.flatness.set(id, value);
      const wheel = this.nodes.get(node);
      if (wheel) { wheel.scale.y = 1 - value * 0.22; wheel.position.y = 0.42 - value * 0.09; }
      const drop = value * 0.09 / 2;
      if (isFront) front += drop; else rear += drop;
      if (isLeft) left += drop; else right += drop;
    }
    // The cab is toward +x and the left wheels toward -z; each end sinks by its tyres' drop.
    this.body.position.y = -(front + rear) / 2;
    this.body.rotation.z = -Math.atan2(front - rear, 3.7);
    this.body.rotation.x = -Math.atan2(left - right, 2.06);
    const now = performance.now();
    for (const item of this.venting) {
      const left = (item.until - now) / 1000;
      item.jet.scale.set(0.45 + Math.random() * 0.15, 1.2 + Math.random() * 0.5, 1);
      item.jet.material.opacity = left > 0 ? 1 : Math.max(0, 1 + left * 4);
    }
  }

  dispose(): void { for (const texture of this.owned) texture.dispose(); }
}
