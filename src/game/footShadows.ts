import { DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, Matrix4, MeshBasicNodeMaterial, PlaneGeometry, Quaternion, Vector3, type Node, type Object3D } from "three/webgpu";
import { instancedBufferAttribute, smoothstep, uv, varying, vec3 } from "three/tsl";

// A soft dark patch on the ground under each other player. The lamps cast no shadows, so a player
// who stood out of the sun had nothing under the feet and seemed to float above the street. The
// patch is drawn only where the sun does not reach the player: in the sun, the sun's own shadow is
// there already. It fades as the player leaves the ground in a jump, and stays on the floor below.

// How the patch looks. One table, so the look is tuned in one place.
export const FOOT_SHADOW = {
  // Its width in metres under a standing player, how much wider under a crouched one, and how
  // dark its middle is (0 none, 1 black).
  width: 1.15, crouched: 1.2, dark: 0.9,
  // The height above the floor at which it has faded out, in metres.
  fadeHeight: 2.2,
  // How often each player's place is tested against the sun, in frames, and how fast the patch
  // comes and goes when the player walks out of or into the sun (share for each frame).
  sunEvery: 6, ease: 0.15,
};

// What the patches need to know of the world: the floor under a point, and whether the sun reaches it.
export interface ShadowWorld {
  floorBelow(at: { x: number; y: number; z: number }, reach: number): { distance: number } | null;
  sunlit(at: { x: number; y: number; z: number }): boolean;
}
// One player to draw a patch under: where the feet are, and how the player stands.
export interface ShadowCaster { id: string; x: number; y: number; z: number; crouching: boolean }

const FLAT = new Quaternion();
const HIDE = new Matrix4().makeScale(0, 0, 0);

export class FootShadows {
  private mesh: InstancedMesh;
  private strengths: InstancedBufferAttribute;
  // For each player: how much of the patch shows now, and whether the sun reached them at the last test.
  private shown = new Map<string, { amount: number; sun: boolean }>();
  private frame = 0;
  private matrix = new Matrix4();
  private at = new Vector3();
  private size = new Vector3();

  constructor(parent: Object3D, private most = 24) {
    this.strengths = new InstancedBufferAttribute(new Float32Array(most), 1);
    this.strengths.setUsage(DynamicDrawUsage);
    const strength = varying(instancedBufferAttribute(this.strengths) as unknown as Node<"float">);
    // Black: a wide soft patch that is nothing at the rim, and a darker middle close to the boots.
    const out = uv().mul(2).sub(1).length();
    const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    material.colorNode = vec3(0, 0, 0);
    material.opacityNode = smoothstep(1, 0.1, out).mul(smoothstep(1, 0.1, out)).mul(0.55).add(smoothstep(0.55, 0, out).mul(0.45)).mul(strength);
    this.mesh = new InstancedMesh(new PlaneGeometry(1, 1).rotateX(-Math.PI / 2), material, most);
    this.mesh.geometry.setAttribute("strength", this.strengths);
    this.mesh.frustumCulled = false;
    this.mesh.name = "foot shadows";
    for (let i = 0; i < most; i += 1) this.mesh.setMatrixAt(i, HIDE);
    // One copy is always drawn, at no size, so the shader is built as the map loads.
    this.mesh.count = 1;
    parent.add(this.mesh);
  }

  // Places a patch under each living player. `sunCasts` is whether the sun draws shadows at all:
  // if it does not, every player gets a patch.
  update(casters: ShadowCaster[], world: ShadowWorld, sunCasts: boolean): void {
    const look = FOOT_SHADOW, strengths = this.strengths.array as Float32Array;
    this.frame += 1;
    let drawn = 0;
    for (const caster of casters) {
      if (drawn >= this.most) break;
      const state = this.shown.get(caster.id) ?? { amount: 0, sun: false };
      this.shown.set(caster.id, state);
      // The sun is tested for a few players each frame, in turn.
      if (sunCasts && (this.frame + drawn) % look.sunEvery === 0) state.sun = world.sunlit({ x: caster.x, y: caster.y + 1.1, z: caster.z });
      if (!sunCasts) state.sun = false;
      state.amount += ((state.sun ? 0 : 1) - state.amount) * look.ease;
      const floor = world.floorBelow({ x: caster.x, y: caster.y + 0.4, z: caster.z }, look.fadeHeight + 0.6);
      if (!floor) continue;
      const height = Math.max(0, floor.distance - 0.4), strength = look.dark * state.amount * Math.max(0, 1 - height / look.fadeHeight);
      if (strength < 0.01) continue;
      // Wider and fainter as the player leaves the ground.
      const width = look.width * (caster.crouching ? look.crouched : 1) * (1 + height * 0.35);
      this.mesh.setMatrixAt(drawn, this.matrix.compose(this.at.set(caster.x, caster.y - height + 0.02, caster.z), FLAT, this.size.set(width, 1, width)));
      strengths[drawn] = strength;
      drawn += 1;
    }
    if (!drawn) { this.mesh.setMatrixAt(0, HIDE); strengths[0] = 0; }
    this.mesh.count = Math.max(1, drawn);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.strengths.needsUpdate = true;
    // Players who have left are forgotten.
    if (this.frame % 600 === 0) for (const id of this.shown.keys()) if (!casters.some((caster) => caster.id === id)) this.shown.delete(id);
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshBasicNodeMaterial).dispose();
  }
}
