import { BoxGeometry, CylinderGeometry, InstancedMesh, MeshStandardMaterial, Object3D, Scene, Vector3 } from "three/webgpu";

export interface Vec3 { x: number; y: number; z: number }

// A ladder against a ledge: its foot in front of the face, the outward normal of the face,
// the direction along it, and the height of the ledge it reaches. Climbing to the top steps
// over the ledge in the direction opposite the normal.
export interface Ladder { foot: Vec3; normal: { x: number; z: number }; along: { x: number; z: number }; top: number }

// A straight stair: where it starts, its direction (t), the open side (n), the height it
// climbs over its run, and the landing at the top.
export interface Stair { start: { x: number; z: number }; tx: number; tz: number; nx: number; nz: number; ground: number; height: number; run: number; landing: { x: number; z: number }; top: number }

export const STAIR_RISE = 0.18;
export const STAIR_RUN = 0.28;
const STAIR_WIDTH = 1.3;

// Steel ladders and stairs: rails and rungs, open-riser steps and posts on the open side.
// Their solid ramps and railings are colliders in the map layout.
export function addClimbing(scene: Scene, ladders: Ladder[], stairs: Stair[]): void {
  const steel = new MeshStandardMaterial({ color: 0x3d4447, roughness: 0.55, metalness: 0.75 });
  const transform = new Object3D();
  const rails: [Vector3, Vector3][] = [], rungs: { at: Vector3; along: { x: number; z: number } }[] = [];
  for (const ladder of ladders) {
    const height = ladder.top - ladder.foot.y + 1.0;
    for (const side of [-0.23, 0.23]) {
      const base = new Vector3(ladder.foot.x + ladder.along.x * side, ladder.foot.y, ladder.foot.z + ladder.along.z * side);
      rails.push([base, base.clone().add(new Vector3(0, height, 0))]);
    }
    for (let y = 0.3; y < height - 0.1; y += 0.3) rungs.push({ at: new Vector3(ladder.foot.x, ladder.foot.y + y, ladder.foot.z), along: ladder.along });
  }
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
  if (posts.length) {
    const mesh = new InstancedMesh(new BoxGeometry(0.04, 1.05, 0.04), steel, posts.length);
    posts.forEach((at, index) => { transform.position.set(at.x, at.y + 0.52, at.z); transform.rotation.set(0, 0, 0); transform.scale.set(1, 1, 1); transform.updateMatrix(); mesh.setMatrixAt(index, transform.matrix); });
    scene.add(mesh);
  }
}
