import { CylinderGeometry, Group, Mesh, MeshBasicMaterial, Scene, SphereGeometry, Vector3 } from "three/webgpu";
import { type CombatEvent } from "./matchState";

// Bounded effects: one shared geometry per shape, no lights or per-frame allocations.
export class ShotEffects {
  private effects: { root: Group; material: MeshBasicMaterial; age: number; life: number; dust: boolean }[] = [];
  private trail = new CylinderGeometry(0.009, 0.009, 1, 5);
  private sphere = new SphereGeometry(1, 6, 4);
  constructor(private scene: Scene) {}

  show(event: CombatEvent, muzzle?: Vector3): void {
    if (!event.shot || event.weapon === "knife") return;
    const { origin, direction, distance } = event.shot;
    const start = new Vector3(origin.x, origin.y, origin.z);
    const end = start.clone().addScaledVector(new Vector3(direction.x, direction.y, direction.z), distance);
    // Very close cover must never produce a trail backwards through the gun.
    if (muzzle && distance > 1.6) start.copy(muzzle);
    const material = new MeshBasicMaterial({ color: 0xffd99a, transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false });
    const root = new Group();
    const tracer = new Mesh(this.trail, material);
    const delta = end.clone().sub(start);
    tracer.position.copy(start).add(end).multiplyScalar(0.5);
    tracer.scale.y = delta.length();
    tracer.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), delta.normalize());
    root.add(tracer);
    this.add(root, material, 0.085, false);
    if (event.impact) {
      const impactMaterial = new MeshBasicMaterial({ color: event.target ? 0xc08c68 : 0xa49b87, transparent: true, opacity: 0.8, depthWrite: false });
      const impact = new Group();
      impact.position.copy(end);
      const mark = new Mesh(this.sphere, impactMaterial);
      mark.scale.setScalar(0.045);
      impact.add(mark);
      for (let i = 0; i < 5; i++) {
        const particle = new Mesh(this.sphere, impactMaterial);
        particle.scale.setScalar(0.022);
        particle.position.set(Math.sin(i*2.4)*0.09, Math.cos(i*1.9)*0.09, Math.sin(i*3.1)*0.09);
        impact.add(particle);
      }
      this.add(impact, impactMaterial, 0.5, true);
    }
  }

  private add(root: Group, material: MeshBasicMaterial, life: number, dust: boolean): void {
    if (this.effects.length >= 48) this.remove(0);
    this.scene.add(root);
    this.effects.push({ root, material, life, age: 0, dust });
  }
  private remove(index: number): void {
    const [effect] = this.effects.splice(index, 1);
    this.scene.remove(effect.root);
    effect.material.dispose();
  }
  update(seconds: number): void {
    for (let i = this.effects.length-1; i >= 0; i--) {
      const effect = this.effects[i];
      effect.age += seconds;
      if (effect.age >= effect.life) { this.remove(i); continue; }
      effect.material.opacity = 0.85 * (1-effect.age/effect.life);
      if (effect.dust) effect.root.scale.setScalar(1+effect.age*4);
    }
  }
  dispose(): void { while (this.effects.length) this.remove(0); this.trail.dispose(); this.sphere.dispose(); }
}
