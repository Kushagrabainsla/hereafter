import { InstancedMesh, Matrix4, Quaternion, Scene, Vector3, type Mesh, type MeshStandardNodeMaterial } from "three/webgpu";
import { float, positionWorld, sin, uniform } from "three/tsl";
import { type LayoutBox } from "./arena";
import { type WorldEntity } from "./entities";
import { type KitPiece } from "./kit";
import { hideAll } from "./worldEffects";

// Stretches of the thin walls that a blast can knock through. Plain data every client builds the
// same way: each is a section of a wall 30 cm thick that runs north and south, open to walk through
// once it has gone. Thicker walls are solid buildings, with nothing behind them to break into.
export interface Breach { id: string; x0: number; x1: number; z0: number; z1: number; height: number }

export const BREACHES: Breach[] = [
  { id: "restaurant", x0: -8.8, x1: -8.5, z0: -2.5, z1: -0.3, height: 2.5 },
  { id: "records-back", x0: 8.2, x1: 8.5, z0: -14.3, z1: -13, height: 2.4 },
  { id: "dumplings-back", x0: 8.2, x1: 8.5, z0: 18.6, z1: 20.5, height: 2.4 },
  { id: "pho-back", x0: 8.2, x1: 8.5, z0: -19.4, z1: -18.05, height: 2.4 },
  { id: "pho-front", x0: 0.5, x1: 0.8, z0: -19, z1: -17.55, height: 2.4 },
  { id: "bar", x0: 17, x1: 17.3, z0: 8.3, z1: 9.9, height: 2.4 },
];

// Takes two good frags beside it, or one and a fuel drum; rounds only chip at it.
const WALL_STRENGTH = 400;

export const BREACH_ENTITIES: WorldEntity[] = BREACHES.map((breach) => ({
  id: `wall:${breach.id}`, kind: "wall", material: "masonry", maxHealth: WALL_STRENGTH, yaw: 0,
  center: { x: (breach.x0 + breach.x1) / 2, y: breach.height / 2, z: (breach.z0 + breach.z1) / 2 },
  shape: { type: "box", half: [(breach.x1 - breach.x0) / 2, breach.height / 2, (breach.z1 - breach.z0) / 2] },
}));

// What is left of a wall to collide with around its breach: the piece either side and the piece
// above. The breach itself is an entity with a collider of its own. A solid with no breach in it
// comes back as it is.
export function aroundBreach(solid: LayoutBox): LayoutBox[] {
  const [hx, hy, hz] = solid.half, { x, y, z } = solid.center;
  const breach = solid.rotation ? undefined : BREACHES.find((item) => Math.abs((item.x0 + item.x1) / 2 - x) < 0.01 && Math.abs((item.x1 - item.x0) / 2 - hx) < 0.01 && item.z0 >= z - hz && item.z1 <= z + hz && y - hy <= 0.01);
  if (!breach) return [solid];
  const piece = (z0: number, z1: number, y0: number, y1: number): LayoutBox => ({ ...solid, half: [hx, (y1 - y0) / 2, (z1 - z0) / 2], center: { x, y: (y0 + y1) / 2, z: (z0 + z1) / 2 } });
  const top = y + hy;
  return [piece(z - hz, breach.z0, 0, top), piece(breach.z1, z + hz, 0, top), piece(breach.z0, breach.z1, breach.height, top)].filter((box) => box.half[1] > 0.001 && box.half[2] > 0.001);
}

// A wall's baked surface stays one mesh, and the bake stays valid: a breached section is cut out
// of it in the shader, along a ragged line, and the broken brick round the hole and the rubble
// under it are modelled pieces (effects.glb) drawn only once something has broken.
export class BreachViews {
  private open = new Map<string, ReturnType<typeof float> & { value: number }>();
  // How far each section has gone: 0 whole, 1 cracked, 2 badly cracked, and 3 open.
  private stage = new Map<string, number>();
  private meshes: { mesh: InstancedMesh; shows: number; rubble: boolean }[] = [];

  constructor(scene: Scene, surfaces: Mesh[], pieces: Map<string, KitPiece>) {
    for (const breach of BREACHES) this.open.set(`wall:${breach.id}`, uniform(0) as unknown as ReturnType<typeof float> & { value: number });
    for (const mesh of surfaces) this.cut(mesh);
    for (const [name, shows, rubble] of [["breach_rim", 3, false], ["breach_rubble", 3, true], ["breach_cracks_a", 1, false], ["breach_cracks_b", 2, false]] as const) {
      for (const part of pieces.get(name)?.parts ?? []) {
        const instanced = new InstancedMesh(part.geometry, part.material, BREACHES.length);
        hideAll(instanced);
        instanced.frustumCulled = false;
        instanced.receiveShadow = true;
        scene.add(instanced);
        this.meshes.push({ mesh: instanced, shows, rubble });
      }
    }
  }

  // The sections any triangle of this surface crosses. A floor runs under them all, so the first
  // few centimetres are left out of each section.
  private crossing(mesh: Mesh): Breach[] {
    const position = mesh.geometry.attributes.position;
    return BREACHES.filter((breach) => {
      for (let i = 0; i + 2 < position.count; i += 3) {
        const xs = [position.getX(i), position.getX(i + 1), position.getX(i + 2)], ys = [position.getY(i), position.getY(i + 1), position.getY(i + 2)], zs = [position.getZ(i), position.getZ(i + 1), position.getZ(i + 2)];
        if (Math.max(...xs) >= breach.x0 - 0.02 && Math.min(...xs) <= breach.x1 + 0.02 && Math.max(...ys) > FLOOR_LEFT && Math.min(...ys) < breach.height && Math.max(...zs) >= breach.z0 && Math.min(...zs) <= breach.z1 && Math.max(...ys) - Math.min(...ys) > 0.01) return true;
      }
      return false;
    });
  }

  private cut(mesh: Mesh): void {
    const crossed = this.crossing(mesh);
    if (!crossed.length) return;
    const baked = mesh.material as MeshStandardNodeMaterial;
    // A surface with baked light already has a material of its own; others share theirs.
    const material = baked.aoNode ? baked : baked.clone();
    mesh.material = material;
    const p = positionWorld;
    const keep = crossed.map((breach) => {
      const side = sin(p.y.mul(23)).mul(0.05).add(sin(p.y.mul(61).add(1.3)).mul(0.03));
      const top = sin(p.z.mul(19)).mul(0.05).add(sin(p.z.mul(53).add(2.1)).mul(0.03));
      return p.x.greaterThan(breach.x0 - 0.02).and(p.x.lessThan(breach.x1 + 0.02))
        .and(p.z.greaterThan(side.add(breach.z0 + 0.08))).and(p.z.lessThan(side.negate().add(breach.z1 - 0.08)))
        .and(p.y.greaterThan(FLOOR_LEFT)).and(p.y.lessThan(top.add(breach.height - 0.1)))
        .and(this.open.get(`wall:${breach.id}`)!.greaterThan(0.5)).not();
    }).reduce((all, one) => all.and(one));
    material.maskNode = keep;
    material.maskShadowNode = keep;
  }

  setOpen(id: string, open: boolean): void {
    const flag = this.open.get(id);
    if (!flag) return;
    flag.value = open ? 1 : 0;
    if (open) this.stage.set(id, 3); else this.stage.set(id, 0);
    this.show();
  }

  // How much of a section's strength is left, 0 to 1, shown as cracks. Returns its new stage
  // when that has just got worse, or 0.
  setHealth(id: string, share: number): number {
    const before = this.stage.get(id) ?? 0;
    if (before === 3 || share <= 0) return 0;
    const stage = share <= 0.45 ? 2 : share <= 0.8 ? 1 : 0;
    if (stage === before) return 0;
    this.stage.set(id, stage);
    this.show();
    return stage > before ? stage : 0;
  }

  private show(): void {
    for (const { mesh, rubble, shows } of this.meshes) {
      const live = BREACHES.filter((breach) => this.stage.get(`wall:${breach.id}`) === shows);
      if (!live.length) { hideAll(mesh); continue; }
      live.forEach((breach, index) => {
        const long = (breach.z1 - breach.z0) / 2;
        mesh.setMatrixAt(index, new Matrix4().compose(new Vector3((breach.x0 + breach.x1) / 2, 0, (breach.z0 + breach.z1) / 2), ALONG_NORTH, new Vector3(long, rubble ? 1 : breach.height / RIM_HEIGHT, 1)));
      });
      mesh.count = live.length;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
}

const FLOOR_LEFT = 0.04;
// The pieces are modelled 2 m wide along X and this tall.
const RIM_HEIGHT = 2.4;
const ALONG_NORTH = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
