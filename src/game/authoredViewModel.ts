import { AnimationMixer, Group, LoopOnce, Mesh, PerspectiveCamera, Texture, type AnimationAction } from "three/webgpu";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { type WeaponKind } from "./combatRules";
import { type PlayerMotion } from "./playerController";

// Each GLB contains arms + weapon authored together in camera-local coordinates.
// URLs are explicit build settings: no downloads or third-party requests by default.
export class AuthoredViewModel {
  private models = new Map<WeaponKind, { root: Group; mixer: AnimationMixer; clips: Map<string, AnimationAction> }>();
  private active: WeaponKind = "knife";
  private locomotion = "";
  private disposed = false;
  constructor(private camera: PerspectiveCamera) {
    const paths = { knife: import.meta.env.VITE_KNIFE_VIEWMODEL, pistol: import.meta.env.VITE_PISTOL_VIEWMODEL, rifle: import.meta.env.VITE_RIFLE_VIEWMODEL };
    for (const kind of ["knife", "pistol", "rifle"] as const) {
      const path: unknown = paths[kind];
      if (typeof path !== "string" || !path) continue;
      const url = new URL(path, new URL(import.meta.env.BASE_URL, location.origin));
      if (url.origin !== location.origin) continue;
      void new GLTFLoader().loadAsync(url.href).then((gltf) => {
        const root = gltf.scene;
        if (this.disposed) { this.release(root); return; }
        root.traverse((object) => {
          if (object instanceof Mesh) {
            object.renderOrder = 50;
            for (const material of Array.isArray(object.material) ? object.material : [object.material]) { material.depthTest = false; material.depthWrite = false; }
          }
        });
        const mixer = new AnimationMixer(root);
        const clips = new Map(gltf.animations.map((clip) => [clip.name.toLowerCase(), mixer.clipAction(clip)]));
        root.visible = false;
        camera.add(root);
        this.models.set(kind, { root, mixer, clips });
        this.locomotion = "";
      }).catch((error: unknown) => console.warn(`Could not load ${kind} view model; using fallback.`, error));
    }
  }
  setActive(kind: WeaponKind): void {
    if (this.active !== kind) { this.models.get(this.active)?.mixer.stopAllAction(); this.locomotion = ""; }
    this.active = kind;
  }
  hasModel(): boolean { return this.models.has(this.active); }
  fire(): void {
    const action = this.models.get(this.active)?.clips.get("fire");
    if (action) { action.reset().setLoop(LoopOnce, 1).play(); action.clampWhenFinished = false; }
  }
  update(seconds: number, motion: PlayerMotion): void {
    for (const [kind, model] of this.models) model.root.visible = kind === this.active;
    const model = this.models.get(this.active);
    if (!model) return;
    const desired = motion.moving ? motion.running ? "run" : "walk" : "idle";
    const next = model.clips.has(desired) ? desired : "idle";
    if (next !== this.locomotion) {
      model.clips.get(this.locomotion)?.fadeOut(0.15);
      model.clips.get(next)?.reset().fadeIn(0.15).play();
      this.locomotion = next;
    }
    model.mixer.update(seconds);
  }
  private release(root: Group): void {
    root.traverse((object) => {
      if (object instanceof Mesh) {
        object.geometry.dispose();
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          for (const value of Object.values(material)) if (value instanceof Texture) value.dispose();
          material.dispose();
        }
      }
    });
  }
  dispose(): void {
    this.disposed = true;
    for (const model of this.models.values()) { model.mixer.stopAllAction(); model.mixer.uncacheRoot(model.root); this.camera.remove(model.root); this.release(model.root); }
    this.models.clear();
  }
}
