import { AnimationMixer, Color, Group, LoopOnce, Mesh, MeshStandardMaterial, Object3D, Quaternion, SkinnedMesh, Texture, Vector3, type AnimationAction, type AnimationClip } from "three/webgpu";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";

export type PlayerStance = "idle" | "walk" | "run" | "crouch";

interface Library { scene: Group; clips: AnimationClip[] }

// One rigged character shared by every other player: the GLB is fetched once and each
// peer gets a skeleton clone that shares geometry and textures. A missing or failed
// model leaves the primitive mannequin in place.
export class PlayerModelLibrary {
  private library: Library | null = null;
  private failed = false;
  constructor() {
    const path: unknown = import.meta.env.VITE_PLAYER_MODEL;
    if (typeof path !== "string" || !path) { this.failed = true; return; }
    const url = new URL(path, new URL(import.meta.env.BASE_URL, location.origin));
    if (url.origin !== location.origin) { this.failed = true; return; }
    void new GLTFLoader().loadAsync(url.href).then((gltf) => {
      gltf.scene.traverse((object) => { if (object instanceof Mesh) { object.castShadow = true; object.receiveShadow = true; object.frustumCulled = false; } });
      this.library = { scene: gltf.scene, clips: gltf.animations };
    }).catch((error: unknown) => { this.failed = true; console.warn("Could not load the player model; using mannequins.", error); });
  }
  ready(): boolean { return this.library !== null; }
  unavailable(): boolean { return this.failed; }
  instantiate(tint: Color): PlayerModelInstance | null {
    return this.library ? new PlayerModelInstance(this.library, tint) : null;
  }
  dispose(): void {
    const library = this.library;
    this.library = null;
    library?.scene.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      object.geometry.dispose();
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        for (const value of Object.values(material)) if (value instanceof Texture) value.dispose();
        material.dispose();
      }
    });
  }
}

const FADE = 0.2;
const WORLD_RIGHT = new Vector3(1, 0, 0);

export class PlayerModelInstance {
  readonly root: Object3D;
  readonly weaponSocket: Object3D | null;
  private mixer: AnimationMixer;
  private actions = new Map<string, AnimationAction>();
  private stance: PlayerStance | "" = "";
  private dead = false;
  private pitch = 0;
  private spine: { bone: Object3D; axis: Vector3 }[] = [];
  private materials: MeshStandardMaterial[] = [];
  private scratch = new Quaternion();

  constructor(library: Library, tint: Color) {
    this.root = cloneSkeleton(library.scene);
    this.root.traverse((object) => {
      if (object instanceof Mesh) {
        // Textures stay shared; only the material object is per peer so it can carry the tint.
        const materials = (Array.isArray(object.material) ? object.material : [object.material]) as MeshStandardMaterial[];
        const tinted = materials.map((material) => {
          const copy = material.clone();
          if (material.name.startsWith("body") || material.name.startsWith("equipment")) copy.color.copy(tint);
          this.materials.push(copy);
          return copy;
        });
        object.material = Array.isArray(object.material) ? tinted : tinted[0];
      }
    });
    this.mixer = new AnimationMixer(this.root);
    for (const clip of library.clips) {
      const action = this.mixer.clipAction(clip);
      if (clip.name === "death") { action.setLoop(LoopOnce, 1); action.clampWhenFinished = true; }
      this.actions.set(clip.name, action);
    }
    this.weaponSocket = this.root.getObjectByName("weapon_socket") ?? null;
    this.root.updateMatrixWorld(true);
    // Pitch tilts the upper spine and head about the axis that points to the character's
    // right in the bind pose, split so the lean reads naturally.
    for (const name of ["Bip01 Spine1", "Bip01 Spine2", "Bip01 Head"]) {
      const bone = this.root.getObjectByName(name);
      if (!bone) continue;
      const axis = WORLD_RIGHT.clone().applyQuaternion(bone.getWorldQuaternion(new Quaternion()).invert()).normalize();
      this.spine.push({ bone, axis });
    }
    this.play("idle");
  }

  setStance(stance: PlayerStance): void {
    if (this.dead || stance === this.stance) return;
    this.play(stance);
  }

  setPitch(degrees: number): void { this.pitch = degrees; }

  setDead(dead: boolean): void {
    if (dead === this.dead) return;
    this.dead = dead;
    if (dead) this.play("death");
    else this.play(this.stance || "idle");
  }

  private play(name: string): void {
    const next = this.actions.get(name) ?? this.actions.get("idle");
    if (!next) return;
    for (const [other, action] of this.actions) if (action !== next && action.isRunning()) action.fadeOut(other === "death" ? FADE * 2 : FADE);
    next.reset().fadeIn(FADE).play();
    if (name !== "death") this.stance = name as PlayerStance;
  }

  update(seconds: number): void {
    this.mixer.update(seconds);
    if (this.dead) return;
    const angle = -this.pitch * Math.PI / 180 / this.spine.length;
    for (const { bone, axis } of this.spine) bone.quaternion.multiply(this.scratch.setFromAxisAngle(axis, angle));
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
    for (const material of this.materials) material.dispose();
    this.root.traverse((object) => { if (object instanceof SkinnedMesh) object.skeleton.dispose(); });
  }
}
