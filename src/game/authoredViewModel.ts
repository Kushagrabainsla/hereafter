import { AnimationMixer, AnimationUtils, Group, LoopOnce, Mesh, Object3D, PerspectiveCamera, Texture, Vector3, type AnimationAction } from "three/webgpu";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { type WeaponKind } from "./combatRules";
import { type PlayerMotion } from "./playerController";
import { type ViewDynamics } from "./weaponVisuals";

interface Model { root: Group; mixer: AnimationMixer; clips: Map<string, AnimationAction>; muzzle: Object3D | null }

// Each GLB contains arms + weapon authored together in camera-local coordinates with
// idle, walk, run and fire clips (see scripts/viewmodels/build.py). URLs are explicit
// build settings: no downloads or third-party requests by default.
export class AuthoredViewModel {
  private models = new Map<WeaponKind, Model>();
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
            object.frustumCulled = false;
            for (const material of Array.isArray(object.material) ? object.material : [object.material]) { material.depthTest = true; material.depthWrite = true; }
          }
        });
        const mixer = new AnimationMixer(root);
        const clips = new Map<string, AnimationAction>();
        for (const source of gltf.animations) {
          const name = source.name.toLowerCase();
          let clip = source;
          if (name === "fire") {
            // The fire clip starts on the neutral pose, so it layers over whichever
            // locomotion clip is playing instead of averaging with it. It is cloned first:
            // exporters share one accessor between identical constant tracks of different
            // clips, and makeClipAdditive subtracts from the track arrays in place.
            clip = AnimationUtils.makeClipAdditive(source.clone());
          }
          const action = mixer.clipAction(clip);
          if (name === "fire") action.setLoop(LoopOnce, 1);
          clips.set(name, action);
        }
        root.visible = false;
        camera.add(root);
        this.models.set(kind, { root, mixer, clips, muzzle: root.getObjectByName("muzzle") ?? null });
        this.locomotion = "";
      }).catch((error: unknown) => console.warn(`Could not load ${kind} view model; using fallback.`, error));
    }
  }
  hasModel(): boolean { return this.models.has(this.active); }
  // Muzzle position in camera-local metres for tracers, when the active model has one.
  muzzle(): Vector3 | undefined {
    const muzzle = this.models.get(this.active)?.muzzle;
    return muzzle ? muzzle.getWorldPosition(new Vector3()) : undefined;
  }
  fire(): void {
    const action = this.models.get(this.active)?.clips.get("fire");
    if (action) { action.reset().play(); action.clampWhenFinished = false; }
  }
  update(seconds: number, motion: PlayerMotion, dynamics: ViewDynamics): void {
    if (dynamics.active !== this.active) { this.models.get(this.active)?.mixer.stopAllAction(); this.locomotion = ""; this.active = dynamics.active; }
    for (const [kind, model] of this.models) model.root.visible = kind === this.active;
    const model = this.models.get(this.active);
    if (!model) return;
    const desired = motion.moving && !motion.airborne ? motion.running ? "run" : "walk" : "idle";
    const next = model.clips.has(desired) ? desired : "idle";
    if (next !== this.locomotion) {
      model.clips.get(this.locomotion)?.fadeOut(0.15);
      model.clips.get(next)?.reset().fadeIn(0.15).play();
      this.locomotion = next;
    }
    model.mixer.update(seconds);
    // Turn settling, landing dips and the lower-and-raise switch come from the shared
    // procedural state so authored and fallback weapons behave the same way.
    const lower = dynamics.lower;
    model.root.position.set(dynamics.turnLag + lower * 0.05, dynamics.pitchLag - dynamics.landing - lower * 0.55, lower * 0.06);
    model.root.rotation.set(-lower * 0.6, -dynamics.turnLag * 0.8 + lower * 0.25, -lower * 0.3);
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
