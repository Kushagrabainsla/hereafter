import {
  Box3, BoxGeometry, CylinderGeometry, ExtrudeGeometry, Group, Mesh, MeshStandardMaterial, Object3D, Scene, Shape, TorusGeometry, Vector3,
} from "three/webgpu";
import { type GunKind, type WeaponKind, type WeaponPickup } from "./combatRules";
import { type Drop } from "./matchState";
import { type GrenadePath } from "../world/physics";

const steel = new MeshStandardMaterial({ color: 0x26292c, metalness: 0.75, roughness: 0.42 });
const plate = new MeshStandardMaterial({ color: 0x18191a, metalness: 0.4, roughness: 0.6 });
const brass = new MeshStandardMaterial({ color: 0xc89a4a, metalness: 1, roughness: 0.32 });
const marker = new MeshStandardMaterial({ color: 0x59d3d0, emissive: 0x237a78, emissiveIntensity: 1.4, metalness: 0.35, roughness: 0.34, transparent: true, opacity: 0.8 });

// A magazine at real size, standing with its feed lips at the origin and its spine along -y,
// the front of the magazine toward -z: a straight double-stack 9 mm magazine, or the curved
// 30-round steel magazine of the carbine.
export function magazineModel(gun: GunKind): Group {
  const group = new Group();
  if (gun === "pistol") {
    const body = new Mesh(new BoxGeometry(0.022, 0.118, 0.032), steel);
    body.position.y = -0.059;
    const base = new Mesh(new BoxGeometry(0.026, 0.008, 0.038), plate);
    base.position.y = -0.121;
    const round = new Mesh(new CylinderGeometry(0.0045, 0.0045, 0.02, 8), brass);
    round.rotation.x = Math.PI / 2;
    round.position.set(0, 0.004, -0.002);
    group.add(body, base, round);
    group.rotation.x = -0.18;
  } else {
    // The spine curves forward: points along an arc, wider at the bottom.
    const outline = new Shape(), radius = 0.42, sweep = 0.52, steps = 10;
    const edge = (t: number, side: number): [number, number] => {
      const angle = sweep * t, depth = 0.056 + 0.016 * t;
      const cz = -radius * (1 - Math.cos(angle)), cy = -radius * Math.sin(angle);
      return [cz + side * depth / 2 * Math.cos(angle), cy - side * depth / 2 * Math.sin(angle)];
    };
    outline.moveTo(...edge(0, 1));
    for (let index = 1; index <= steps; index += 1) outline.lineTo(...edge(index / steps, 1));
    for (let index = steps; index >= 0; index -= 1) outline.lineTo(...edge(index / steps, -1));
    outline.closePath();
    const geometry = new ExtrudeGeometry(outline, { depth: 0.026, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 1 });
    geometry.translate(0, 0, -0.013);
    // The outline is drawn in the z-y plane of the extrusion's x-y; turn it so x is across.
    geometry.rotateY(-Math.PI / 2);
    const body = new Mesh(geometry, steel);
    const round = new Mesh(new CylinderGeometry(0.0056, 0.0056, 0.04, 8), brass);
    round.rotation.x = Math.PI / 2;
    round.position.set(0, 0.006, 0.004);
    group.add(body, round);
  }
  group.traverse((object) => { if (object instanceof Mesh) { object.castShadow = true; object.receiveShadow = true; } });
  return group;
}

// Lying on its side: turned a quarter about its long axis, lifted so it rests on y = 0.
function lying(object: Object3D, spinAxis: "x" | "z", yaw: number): Group {
  const holder = new Group();
  object.rotation[spinAxis] += Math.PI / 2;
  holder.add(object);
  object.updateMatrixWorld(true);
  const bounds = new Box3().setFromObject(object);
  object.position.y -= bounds.min.y;
  object.position.x -= (bounds.min.x + bounds.max.x) / 2;
  object.position.z -= (bounds.min.z + bounds.max.z) / 2;
  holder.rotation.y = yaw;
  return holder;
}

function hash(text: string): number {
  return [...text].reduce((value, character) => (value * 31 + character.charCodeAt(0)) >>> 0, 7) / 4294967296;
}

// A falling drop's path is traced for a small ball, which comes to rest this far above the
// surface it lands on.
const REST_LIFT = 0.04;

interface DropView { root: Group; body: Group; path: GrenadePath | null; start: number; spin: Vector3 }

// Spare magazines lying where the map puts them, and the guns and magazines fallen players
// drop. A small marker ring makes each one findable without the beam weapons stand in.
export class LootViews {
  private magazines = new Map<string, Group>();
  private drops = new Map<string, DropView>();
  private weaponModels: Map<WeaponKind, Object3D> | null = null;
  private time = 0;

  constructor(private scene: Scene, pickups: WeaponPickup[]) {
    for (const pickup of pickups) {
      if (pickup.item !== "magazines") continue;
      const root = new Group();
      root.position.set(pickup.east, pickup.y + 0.002, pickup.north);
      const yaw = hash(pickup.id) * Math.PI * 2;
      for (const side of [-1, 1]) {
        const magazine = lying(magazineModel(pickup.weapon), "z", yaw + side * 0.25);
        magazine.position.set(Math.cos(yaw) * side * 0.05, 0, -Math.sin(yaw) * side * 0.05);
        root.add(magazine);
      }
      root.add(this.ring(0.2));
      scene.add(root);
      this.magazines.set(pickup.id, root);
    }
  }

  private ring(radius: number): Mesh {
    const ring = new Mesh(new TorusGeometry(radius, 0.008, 4, 28), marker);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.012;
    return ring;
  }

  setWeaponModels(models: Map<WeaponKind, Object3D>): void { this.weaponModels = models; }

  setTaken(taken: string[]): void {
    const hidden = new Set(taken);
    for (const [id, root] of this.magazines) root.visible = !hidden.has(id);
  }

  // Shows the current drops. Ones named in falling tumble along their path first; others
  // (already lying when this peer saw them) appear at rest.
  setDrops(drops: Drop[], falling: Map<string, GrenadePath>): void {
    const live = new Set(drops.map((drop) => drop.id));
    for (const [id, view] of this.drops) if (!live.has(id)) { this.scene.remove(view.root); this.drops.delete(id); }
    for (const drop of drops) {
      if (this.drops.has(drop.id)) continue;
      const root = new Group(), body = new Group();
      const yaw = hash(drop.id) * Math.PI * 2;
      const source = drop.gun ? this.weaponModels?.get(drop.weapon) : null;
      const gun = source ? lying(source.clone(true), "z", yaw) : null;
      if (gun) body.add(gun);
      drop.mags.forEach((_, index) => {
        const magazine = lying(magazineModel(drop.weapon), "z", yaw + 1.3 + index * 0.4);
        magazine.position.set(Math.cos(yaw + index) * (0.16 + index * 0.05), 0, Math.sin(yaw + index) * (0.16 + index * 0.05));
        body.add(magazine);
      });
      root.add(body, this.ring(drop.gun && drop.weapon === "rifle" ? 0.5 : 0.3));
      root.position.set(drop.position.x, drop.position.y - REST_LIFT, drop.position.z);
      const path = falling.get(drop.id) ?? null;
      const view: DropView = { root, body, path, start: performance.now(), spin: new Vector3(4 + hash(drop.id + "x") * 6, 3, 5) };
      this.scene.add(root);
      this.drops.set(drop.id, view);
      this.place(view, 0);
    }
  }

  private place(view: DropView, elapsed: number): void {
    const path = view.path;
    if (!path) return;
    const exact = elapsed / path.step, last = path.points.length - 1;
    const index = Math.min(last, Math.floor(exact)), t = Math.min(1, exact - index);
    const a = path.points[index], b = path.points[Math.min(last, index + 1)];
    if (index >= last) {
      view.root.position.set(a.x, a.y - REST_LIFT, a.z);
      view.body.rotation.set(0, 0, 0);
      view.path = null;
      return;
    }
    view.root.position.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t - REST_LIFT, a.z + (b.z - a.z) * t);
    // Tumbling while it falls, slowing as it skids to a stop.
    const settle = Math.max(0, 1 - exact / last);
    view.body.rotation.set(view.spin.x * elapsed * settle, view.spin.y * elapsed * settle, view.spin.z * elapsed * settle);
  }

  update(seconds: number): void {
    this.time += seconds;
    const now = performance.now();
    for (const view of this.drops.values()) this.place(view, (now - view.start) / 1000);
    const glow = 0.6 + Math.sin(this.time * 2.5) * 0.25;
    marker.opacity = glow;
  }

  clear(): void {
    for (const view of this.drops.values()) this.scene.remove(view.root);
    this.drops.clear();
  }
}
