import { CylinderGeometry, Group, InstancedMesh, Matrix4, MeshStandardMaterial, Quaternion, Scene, Vector3, Color, Euler } from "three/webgpu";
import { type GunKind } from "./combatRules";
import { magazineModel } from "./loot";
import { gameAudio } from "./gameAudio";

export interface Vec3 { x: number; y: number; z: number }
// The first solid surface along a short segment, with its normal.
export type Sweep = (origin: Vec3, direction: Vec3, distance: number) => { distance: number; normal: Vec3 } | null;

// Spent cases and empty magazines thrown from guns. Each piece is a small rigid body with
// real size, integrated at 120 Hz against the physics world: it falls, bounces off what it
// strikes (keeping more of its speed off brass than off a magazine), skids, tumbles and
// comes to rest lying on its side, clinking as it lands. Pieces are drawn only on this
// peer and are not shared; they fade after a while.
const STEP = 1 / 120;
const CASES_KEPT = 96;
const MAGAZINES_KEPT = 8;
// 9x19 mm brass and lacquered steel 7.62x39 mm cases: radius and length in metres.
const CASE: Record<GunKind, { radius: number; length: number; color: number; restitution: number }> = {
  pistol: { radius: 0.0049, length: 0.0192, color: 0xd2a650, restitution: 0.42 },
  rifle: { radius: 0.0057, length: 0.0386, color: 0x77684a, restitution: 0.36 },
};

interface Piece {
  gun: GunKind;
  magazine: boolean;
  position: Vector3;
  velocity: Vector3;
  rotation: Quaternion;
  spin: Vector3;
  radius: number;
  // How far it settles from its sweep radius when it comes to rest on its side.
  seat: number;
  restitution: number;
  resting: boolean;
  age: number;
  life: number;
  object?: Group;
}

const turn = new Quaternion(), axis = new Vector3(), matrix = new Matrix4(), scale = new Vector3();

export class Ejecta {
  private cases: (Piece | null)[] = new Array(CASES_KEPT).fill(null);
  private nextCase = 0;
  private magazines: Piece[] = [];
  private mesh: InstancedMesh;
  private accumulator = 0;
  private lastClink = 0;

  constructor(private scene: Scene, private sweep: Sweep) {
    const material = new MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.34 });
    this.mesh = new InstancedMesh(new CylinderGeometry(1, 1, 1, 8), material, CASES_KEPT);
    this.mesh.frustumCulled = false;
    const hidden = new Matrix4().makeScale(0, 0, 0), color = new Color();
    for (let index = 0; index < CASES_KEPT; index += 1) { this.mesh.setMatrixAt(index, hidden); this.mesh.setColorAt(index, color.set(0xffffff)); }
    scene.add(this.mesh);
  }

  // A case leaves the ejection port at `at` toward the gun's right and up, a little back,
  // on top of the shooter's own velocity, spinning end over end.
  ejectCase(gun: GunKind, at: Vec3, right: Vec3, forward: Vec3, carry: Vec3 = { x: 0, y: 0, z: 0 }): void {
    const sideways = 2.1 + Math.random() * 1.1, lift = 1.2 + Math.random() * 0.9, back = 0.3 + Math.random() * 0.5;
    const velocity = new Vector3(
      right.x * sideways - forward.x * back + carry.x,
      lift + right.y * sideways + carry.y,
      right.z * sideways - forward.z * back + carry.z,
    );
    const rule = CASE[gun];
    const piece: Piece = {
      gun, magazine: false, position: new Vector3(at.x, at.y, at.z), velocity, rotation: new Quaternion().setFromEuler(new Euler(Math.random() * 3, Math.random() * 3, Math.PI / 2)),
      spin: new Vector3((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 12, 40 + Math.random() * 30), radius: rule.radius * 1.4, seat: rule.radius * 0.4, restitution: rule.restitution,
      resting: false, age: 0, life: 40 + Math.random() * 10,
    };
    this.cases[this.nextCase] = piece;
    this.mesh.setColorAt(this.nextCase, new Color(rule.color));
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.nextCase = (this.nextCase + 1) % CASES_KEPT;
  }

  // An empty magazine let go during a reload: it drops from the gun and clatters down.
  dropMagazine(gun: GunKind, at: Vec3, carry: Vec3 = { x: 0, y: 0, z: 0 }): void {
    const object = magazineModel(gun);
    const holder = new Group();
    holder.add(object);
    this.scene.add(holder);
    this.magazines.push({
      gun, magazine: true, position: new Vector3(at.x, at.y, at.z), velocity: new Vector3(carry.x * 0.8, -0.4 + carry.y, carry.z * 0.8),
      rotation: new Quaternion(), spin: new Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 6),
      radius: gun === "rifle" ? 0.03 : 0.016, seat: gun === "rifle" ? 0.016 : 0.004, restitution: 0.18, resting: false, age: 0, life: 45, object: holder,
    });
    while (this.magazines.length > MAGAZINES_KEPT) this.scene.remove(this.magazines.shift()!.object!);
  }

  private step(piece: Piece, dt: number): void {
    piece.velocity.y -= 9.81 * dt;
    const move = piece.velocity.clone().multiplyScalar(dt), length = move.length();
    if (length > 1e-6) {
      const direction = move.clone().divideScalar(length);
      const hit = this.sweep(piece.position, direction, length + piece.radius);
      if (hit) {
        piece.position.addScaledVector(direction, Math.max(0, hit.distance - piece.radius));
        const normal = new Vector3(hit.normal.x, hit.normal.y, hit.normal.z);
        const along = piece.velocity.dot(normal);
        if (along < 0) {
          const impact = -along;
          // Restitution along the surface normal, friction across it; each strike
          // knocks the tumble about.
          const tangent = piece.velocity.clone().addScaledVector(normal, -along).multiplyScalar(piece.magazine ? 0.55 : 0.7);
          piece.velocity.copy(tangent).addScaledVector(normal, impact * piece.restitution);
          piece.spin.multiplyScalar(0.6).add(new Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(impact * (piece.magazine ? 4 : 18)));
          if (impact > 0.5) this.clink(piece, impact);
        }
        if (piece.velocity.length() < 0.3 && normal.y > 0.7) this.rest(piece);
      } else piece.position.add(move);
    }
    const speed = piece.spin.length();
    if (speed > 1e-3) piece.rotation.premultiply(turn.setFromAxisAngle(axis.copy(piece.spin).divideScalar(speed), speed * dt));
  }

  // Lying still: a case on its side with its axis level, a magazine flat on its side.
  private rest(piece: Piece): void {
    piece.resting = true;
    piece.velocity.set(0, 0, 0);
    piece.spin.set(0, 0, 0);
    const heading = Math.random() * Math.PI * 2;
    piece.rotation.setFromEuler(new Euler(0, heading, Math.PI / 2, "YXZ"));
    piece.position.y -= piece.seat;
  }

  private clink(piece: Piece, impact: number): void {
    const now = performance.now();
    if (now - this.lastClink < 35) return;
    this.lastClink = now;
    gameAudio.clink(piece.position, impact, piece.magazine ? "magazine" : piece.gun === "pistol" ? "brass" : "steel");
  }

  update(seconds: number): void {
    this.accumulator = Math.min(0.1, this.accumulator + seconds);
    const steps = Math.floor(this.accumulator / STEP);
    this.accumulator -= steps * STEP;
    let touched = false;
    this.cases.forEach((piece, index) => {
      if (!piece) return;
      touched = true;
      piece.age += seconds;
      for (let step = 0; step < steps && !piece.resting; step += 1) this.step(piece, STEP);
      const rule = CASE[piece.gun];
      const fade = Math.min(1, (piece.life - piece.age) / 3);
      if (fade <= 0) { this.cases[index] = null; this.mesh.setMatrixAt(index, matrix.makeScale(0, 0, 0)); return; }
      this.mesh.setMatrixAt(index, matrix.compose(piece.position, piece.rotation, scale.set(rule.radius * fade, rule.length * fade, rule.radius * fade)));
    });
    if (touched) this.mesh.instanceMatrix.needsUpdate = true;
    for (const piece of [...this.magazines]) {
      piece.age += seconds;
      for (let step = 0; step < steps && !piece.resting; step += 1) this.step(piece, STEP);
      piece.object!.position.copy(piece.position);
      piece.object!.quaternion.copy(piece.rotation);
      if (piece.age > piece.life) { this.scene.remove(piece.object!); this.magazines.splice(this.magazines.indexOf(piece), 1); }
    }
  }

  clear(): void {
    this.cases.fill(null);
    for (let index = 0; index < CASES_KEPT; index += 1) this.mesh.setMatrixAt(index, matrix.makeScale(0, 0, 0));
    this.mesh.instanceMatrix.needsUpdate = true;
    for (const piece of this.magazines) this.scene.remove(piece.object!);
    this.magazines = [];
  }
}
