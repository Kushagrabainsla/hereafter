import { Box3, Group, Mesh, MeshStandardMaterial, Object3D, Scene, Vector3 } from "three/webgpu";
import { type GunKind, type WeaponKind, type WeaponPickup } from "./combatRules";
import { type Drop } from "./matchState";
import { type GrenadePath } from "../world/physics";
import { kitObject, type KitPiece } from "../world/kit";

const marker = new MeshStandardMaterial({ color: 0x59d3d0, emissive: 0x237a78, emissiveIntensity: 1.4, metalness: 0.35, roughness: 0.34, transparent: true, opacity: 0.8 });

// A magazine at real size, modelled in items.glb (scripts/assets/families/items.py): its feed
// lips at the origin and its spine along -y, the front toward -z, with the top round showing.
// The double-stack 9 mm magazine leans back with the grip; the carbine's 30-round steel
// magazine curves forward.
export function magazineModel(gun: GunKind, pieces: Map<string, KitPiece>): Group {
  const group = new Group();
  group.add(kitObject(pieces.get(`magazine_${gun}`)));
  group.traverse((object) => { if (object instanceof Mesh) object.castShadow = true; });
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

// Spare magazines and shop food lying where the map puts them, and the guns and magazines fallen players
// drop. A small marker ring makes each one findable without the beam guns stand in.
export class LootViews {
  private magazines = new Map<string, Group>();
  private drops = new Map<string, DropView>();
  private weaponModels: Map<WeaponKind, Object3D> | null = null;
  private time = 0;

  constructor(private scene: Scene, pickups: WeaponPickup[], private pieces: Map<string, KitPiece>) {
    for (const pickup of pickups) {
      if (pickup.item === "food") {
        const root = new Group();
        root.position.set(pickup.east, pickup.y + 0.002, pickup.north);
        root.add(kitObject(pieces.get(`food_${pickup.food}`)), this.ring(0.2));
        scene.add(root);
        this.magazines.set(pickup.id, root);
        continue;
      }
      if (pickup.item !== "magazines") continue;
      const root = new Group();
      root.position.set(pickup.east, pickup.y + 0.002, pickup.north);
      const yaw = hash(pickup.id) * Math.PI * 2;
      for (const side of [-1, 1]) {
        const magazine = lying(magazineModel(pickup.weapon, pieces), "z", yaw + side * 0.25);
        magazine.position.set(Math.cos(yaw) * side * 0.05, 0, -Math.sin(yaw) * side * 0.05);
        root.add(magazine);
      }
      root.add(this.ring(0.2));
      scene.add(root);
      this.magazines.set(pickup.id, root);
    }
  }

  // The glowing marker ring (effects.glb), modelled 1 m across and scaled to the pickup.
  private ring(radius: number): Object3D {
    const ring = kitObject(this.pieces.get("marker_ring"), undefined, () => marker);
    ring.scale.setScalar(radius);
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
        const magazine = lying(magazineModel(drop.weapon, this.pieces), "z", yaw + 1.3 + index * 0.4);
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
