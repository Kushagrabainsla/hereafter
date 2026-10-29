import { BoxGeometry, CylinderGeometry, InstancedMesh, Matrix4, MeshStandardMaterial, Object3D, Quaternion, Scene, Shape, ShapeGeometry, Vector3 } from "three/webgpu";
import { terrainHeight, toLocal, type Arena, type ArenaData, type Point } from "./arena";
import { CollisionWorld } from "./collision";

export interface Vec3 { x: number; y: number; z: number }

// A ladder on a building wall: its foot in front of the wall, the outward wall normal,
// the direction along the wall, and the roof height it reaches.
export interface Ladder { foot: Vec3; normal: { x: number; z: number }; along: { x: number; z: number }; top: number }

// A solid box for the physics world: stair ramps, landings and railings.
export interface StaticBox { half: [number, number, number]; position: Vec3; rotation: { x: number; y: number; z: number; w: number } }

export interface Stair { start: { x: number; z: number }; tx: number; tz: number; nx: number; nz: number; ground: number; height: number; run: number; landing: { x: number; z: number }; top: number }

export interface RoofPlan {
  roofs: { vertices: Float32Array; indices: Uint32Array }[];
  ladders: Ladder[];
  stairs: Stair[];
  // Walkable stair ramps and landings, and railings that block players but not bullets.
  boxes: (StaticBox & { railing?: boolean })[];
  // Roofs that can be reached, for rooftop cover.
  reachable: { center: Vec3; building: number }[];
}

const LADDER_HEIGHTS: [number, number] = [2.5, 9.6];
const STAIR_RISE = 0.18, STAIR_RUN = 0.28, STAIR_WIDTH = 1.3;

function shapeFromOutline(outline: Point[]): Shape {
  const shape = new Shape();
  outline.forEach(([east, north], index) => { if (index === 0) shape.moveTo(east, -north); else shape.lineTo(east, -north); });
  shape.closePath();
  return shape;
}

function area(outline: Point[]): number {
  let sum = 0;
  for (let i = 0; i < outline.length; i += 1) { const [ax, az] = outline[i], [bx, bz] = outline[(i + 1) % outline.length]; sum += ax * bz - bx * az; }
  return sum / 2;
}

// Every building gets a solid roof at the drawn roof height. Low buildings inside the
// block get a way up: the lowest-but-one gets an external stair, the others ladders, each
// on the wall edge with the most open ground in front of it.
export function planRoofs(data: ArenaData, arena: Arena): RoofPlan {
  const collision = new CollisionWorld(data);
  const [centerEast, centerNorth] = toLocal(arena.latitude, arena.longitude);
  const half = arena.sizeMeters / 2 - 3;
  const inside = (east: number, north: number): boolean => Math.abs(east - centerEast) < half && Math.abs(north - centerNorth) < half;
  const plan: RoofPlan = { roofs: [], ladders: [], stairs: [], boxes: [], reachable: [] };
  const candidates: { building: ArenaData["buildings"][number]; ground: number }[] = [];
  for (const building of data.buildings) {
    if (building.outline.length < 3) continue;
    const [east, north] = building.outline.reduce(([e, n], [x, z]) => [e + x / building.outline.length, n + z / building.outline.length], [0, 0]);
    const ground = terrainHeight(data, east, north);
    const roof = new ShapeGeometry(shapeFromOutline(building.outline));
    roof.rotateX(-Math.PI / 2);
    roof.translate(0, ground + building.height, 0);
    const position = roof.getAttribute("position");
    plan.roofs.push({ vertices: new Float32Array(position.array as ArrayLike<number>), indices: new Uint32Array(roof.getIndex()!.array as ArrayLike<number>) });
    roof.dispose();
    if (building.height >= LADDER_HEIGHTS[0] && building.height <= LADDER_HEIGHTS[1] && inside(east, north)) candidates.push({ building, ground });
  }
  candidates.sort((a, b) => a.building.height - b.building.height);
  // The wall edge with the most open ground in front of it for a ladder or a stair.
  const findEdge = (building: ArenaData["buildings"][number], stair: boolean): { score: number; edge: number; start: number } | null => {
    const outline = building.outline, side = area(outline) > 0 ? 1 : -1;
    const run = Math.ceil(building.height / STAIR_RISE) * STAIR_RUN;
    let best: { score: number; edge: number; start: number } | null = null;
    for (let edge = 0; edge < outline.length; edge += 1) {
      const [ax, az] = outline[edge], [bx, bz] = outline[(edge + 1) % outline.length];
      const dx = bx - ax, dz = bz - az, length = Math.hypot(dx, dz);
      // A stair starts 2 m along the wall so its approach is the same open frontage.
      if (length < (stair ? run + 3.8 : 3)) continue;
      const tx = dx / length, tz = dz / length, nx = side * tz, nz = -side * tx;
      // Ground in front of the wall must be clear for the ladder, or along the whole stair.
      const samples = stair ? Array.from({ length: Math.ceil(run + 3.2) }, (_, i) => 0.4 + i) : [length / 2];
      const offsets = stair ? [0.8] : [0.6, 1.4];
      let clear = true;
      for (const s of samples) for (const out of offsets) {
        const east = ax + tx * s + nx * out, north = az + tz * s + nz * out;
        if (!inside(east, north) || collision.blocked(east, north, 0.45)) clear = false;
      }
      if (!clear) continue;
      const mid = { east: ax + tx * length / 2 + nx * 3, north: az + tz * length / 2 + nz * 3 };
      const score = -Math.hypot(mid.east - centerEast, mid.north - centerNorth);
      if (!best || score > best.score) best = { score, edge, start: stair ? 2 : length / 2 };
    }
    return best;
  };
  // The lowest building that has room for a stair gets one (not the smallest kiosk);
  // the other low buildings get ladders.
  const stairBuilding = candidates.slice(1).find(({ building }) => findEdge(building, true))?.building;
  candidates.forEach(({ building, ground }) => {
    const outline = building.outline, side = area(outline) > 0 ? 1 : -1;
    const top = ground + building.height;
    const stair = building === stairBuilding;
    const run = Math.ceil(building.height / STAIR_RISE) * STAIR_RUN;
    const best = findEdge(building, stair);
    if (!best) return;
    const [ax, az] = outline[best.edge], [bx, bz] = outline[(best.edge + 1) % outline.length];
    const length = Math.hypot(bx - ax, bz - az), tx = (bx - ax) / length, tz = (bz - az) / length, nx = side * tz, nz = -side * tx;
    plan.reachable.push({ center: { x: outline.reduce((s, p) => s + p[0], 0) / outline.length, y: top, z: outline.reduce((s, p) => s + p[1], 0) / outline.length }, building: building.id });
    if (!stair) {
      plan.ladders.push({ foot: { x: ax + tx * best.start + nx * 0.3, y: ground, z: az + tz * best.start + nz * 0.3 }, normal: { x: nx, z: nz }, along: { x: tx, z: tz }, top });
      return;
    }
    // Stair: a ramp under the steps rising along the wall, a landing at the top beside the
    // roof edge, and railings on the open side.
    const basis = (along: Vector3, up: Vector3, out: Vector3): { x: number; y: number; z: number; w: number } => {
      const q = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(along, up, out));
      return { x: q.x, y: q.y, z: q.z, w: q.w };
    };
    const height = building.height, slope = Math.atan2(height, run), length3 = Math.hypot(run, height);
    const out = 0.12 + STAIR_WIDTH / 2;
    const start = { x: ax + tx * best.start + nx * out, z: az + tz * best.start + nz * out };
    const rampAlong = new Vector3(tx * Math.cos(slope), Math.sin(slope), tz * Math.cos(slope));
    const wallOut = new Vector3(nx, 0, nz);
    // A right-handed frame per box: x along it, y up from its surface, z = x cross y.
    const up = new Vector3().crossVectors(wallOut, rampAlong).normalize();
    if (up.y < 0) up.negate();
    plan.boxes.push({ half: [length3 / 2, 0.08, STAIR_WIDTH / 2],
      position: { x: start.x + tx * run / 2 - up.x * 0.08, y: ground + height / 2 - up.y * 0.08, z: start.z + tz * run / 2 - up.z * 0.08 },
      rotation: basis(rampAlong, up, new Vector3().crossVectors(rampAlong, up).normalize()) });
    const landing = { x: start.x + tx * (run + 0.7), z: start.z + tz * (run + 0.7) };
    const flat = basis(new Vector3(tx, 0, tz), new Vector3(0, 1, 0), new Vector3(-tz, 0, tx));
    plan.boxes.push({ half: [0.7, 0.08, STAIR_WIDTH / 2], position: { x: landing.x, y: top - 0.08, z: landing.z }, rotation: flat });
    // Railing along the open side of the ramp from a metre up, so the foot can be entered
    // from the side as well as from below, and along the landing.
    const railOut = out + STAIR_WIDTH / 2, railFrom = 1, railMid = (railFrom + run) / 2, railLength = (run - railFrom) / Math.cos(slope);
    plan.boxes.push({ railing: true, half: [railLength / 2, 0.5, 0.03], position: { x: ax + tx * (best.start + railMid) + nx * railOut, y: ground + height * railMid / run + 0.55, z: az + tz * (best.start + railMid) + nz * railOut },
      rotation: basis(rampAlong, new Vector3().crossVectors(wallOut, rampAlong).normalize(), wallOut) });
    plan.boxes.push({ railing: true, half: [0.7, 0.5, 0.03], position: { x: landing.x + nx * STAIR_WIDTH / 2, y: top + 0.5, z: landing.z + nz * STAIR_WIDTH / 2 }, rotation: flat });
    plan.stairs.push({ start, tx, tz, nx, nz, ground, height, run, landing, top });
  });
  return plan;
}

// Steel ladders and the stair: rails and rungs, open-riser steps on stringers, handrails.
export function addRoofAccess(scene: Scene, plan: RoofPlan): void {
  const steel = new MeshStandardMaterial({ color: 0x3d4447, roughness: 0.55, metalness: 0.75 });
  const transform = new Object3D();
  const rails: [Vector3, Vector3][] = [], rungs: { at: Vector3; along: { x: number; z: number } }[] = [];
  for (const ladder of plan.ladders) {
    const height = ladder.top - ladder.foot.y + 1.0;
    for (const side of [-0.23, 0.23]) {
      const base = new Vector3(ladder.foot.x + ladder.along.x * side, ladder.foot.y, ladder.foot.z + ladder.along.z * side);
      rails.push([base, base.clone().add(new Vector3(0, height, 0))]);
    }
    for (let y = 0.3; y < height - 0.1; y += 0.3) rungs.push({ at: new Vector3(ladder.foot.x, ladder.foot.y + y, ladder.foot.z), along: ladder.along });
  }
  const stairs = plan.stairs;
  const steps: { at: Vector3; yaw: number }[] = [], posts: Vector3[] = [];
  for (const stair of stairs) {
    const count = Math.ceil(stair.height / STAIR_RISE);
    const yaw = Math.atan2(stair.tx, stair.tz);
    for (let i = 0; i < count; i += 1) {
      const along = (i + 0.5) * STAIR_RUN;
      steps.push({ at: new Vector3(stair.start.x + stair.tx * along, stair.ground + (i + 1) * (stair.height / count) - 0.03, stair.start.z + stair.tz * along), yaw });
      if (i % 4 === 0) posts.push(new Vector3(stair.start.x + stair.tx * along + stair.nx * STAIR_WIDTH / 2, stair.ground + (i + 1) * (stair.height / count), stair.start.z + stair.tz * along + stair.nz * STAIR_WIDTH / 2));
    }
    steps.push({ at: new Vector3(stair.landing.x, stair.top - 0.04, stair.landing.z), yaw });
  }
  if (rails.length) {
    const mesh = new InstancedMesh(new BoxGeometry(0.05, 1, 0.05), steel, rails.length);
    rails.forEach(([a, b], index) => { transform.position.copy(a).add(b).multiplyScalar(0.5); transform.rotation.set(0, 0, 0); transform.scale.set(1, a.distanceTo(b), 1); transform.updateMatrix(); mesh.setMatrixAt(index, transform.matrix); });
    mesh.castShadow = true;
    scene.add(mesh);
  }
  if (rungs.length) {
    const mesh = new InstancedMesh(new CylinderGeometry(0.018, 0.018, 0.46, 6), steel, rungs.length);
    rungs.forEach(({ at, along }, index) => { transform.position.copy(at); transform.scale.set(1, 1, 1); transform.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), new Vector3(along.x, 0, along.z)); transform.updateMatrix(); mesh.setMatrixAt(index, transform.matrix); });
    scene.add(mesh);
  }
  if (steps.length) {
    const grating = new MeshStandardMaterial({ color: 0x4b5254, roughness: 0.7, metalness: 0.6 });
    const mesh = new InstancedMesh(new BoxGeometry(STAIR_WIDTH, 0.05, STAIR_RUN + 0.02), grating, steps.length);
    steps.forEach(({ at, yaw }, index) => { transform.position.copy(at); transform.rotation.set(0, yaw, 0); transform.scale.set(1, 1, 1); transform.updateMatrix(); mesh.setMatrixAt(index, transform.matrix); });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
  for (const box of plan.boxes.filter((item) => item.railing)) {
    // Handrails: a thin top bar along each railing box.
    const bar = new InstancedMesh(new BoxGeometry(box.half[0] * 2, 0.05, 0.05), steel, 1);
    const m = new Matrix4().compose(new Vector3(box.position.x, box.position.y + box.half[1], box.position.z), new Quaternion(box.rotation.x, box.rotation.y, box.rotation.z, box.rotation.w), new Vector3(1, 1, 1));
    bar.setMatrixAt(0, m);
    scene.add(bar);
  }
  if (posts.length) {
    const mesh = new InstancedMesh(new BoxGeometry(0.04, 1.05, 0.04), steel, posts.length);
    posts.forEach((at, index) => { transform.position.set(at.x, at.y + 0.52, at.z); transform.rotation.set(0, 0, 0); transform.scale.set(1, 1, 1); transform.updateMatrix(); mesh.setMatrixAt(index, transform.matrix); });
    scene.add(mesh);
  }
}
