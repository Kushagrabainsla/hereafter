import { Group, Mesh, type Object3D } from "three/webgpu";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { type WeaponKind } from "./combatRules";

const KINDS: WeaponKind[] = ["knife", "pistol", "rifle"];
const PATHS: Record<WeaponKind, unknown> = { knife: import.meta.env.VITE_KNIFE_VIEWMODEL, pistol: import.meta.env.VITE_PISTOL_VIEWMODEL, rifle: import.meta.env.VITE_RIFLE_VIEWMODEL };
const loads = new Map<WeaponKind, Promise<GLTF | null>>();

// The authored first-person files hold the arms and the weapon together. Each is loaded
// once: the first-person view uses the whole file, and pickups and other players use a
// copy of just the weapon, so every weapon in the game is the same model.
export function loadWeaponFile(kind: WeaponKind): Promise<GLTF | null> {
  let load = loads.get(kind);
  if (!load) {
    const path = PATHS[kind];
    const url = typeof path === "string" && path ? new URL(path, new URL(import.meta.env.BASE_URL, location.origin)) : null;
    // Only same-origin build settings: no third-party requests.
    load = url && url.origin === location.origin ? new GLTFLoader().loadAsync(url.href).catch((error: unknown) => { console.warn(`Could not load ${kind} model`, error); return null; }) : Promise.resolve(null);
    loads.set(kind, load);
  }
  return load;
}

// Just the weapon from each file, in its own frame: grip at the origin, barrel or blade
// along -Z, up +Y, real size in metres, without the muzzle flash. Copies share geometry
// and materials with the first-person model.
export async function loadWeaponModels(): Promise<Map<WeaponKind, Object3D>> {
  const models = new Map<WeaponKind, Object3D>();
  await Promise.all(KINDS.map(async (kind) => {
    const weapon = (await loadWeaponFile(kind))?.scene.getObjectByName("weapon");
    if (!weapon) return;
    const copy = weapon.clone(true);
    copy.getObjectByName("muzzle")?.removeFromParent();
    copy.position.set(0, 0, 0);
    copy.quaternion.identity();
    copy.scale.set(1, 1, 1);
    copy.traverse((object) => {
      if (object instanceof Mesh) { object.renderOrder = 0; object.frustumCulled = true; object.castShadow = true; object.receiveShadow = true; }
    });
    const holder = new Group();
    holder.name = `${kind}-model`;
    holder.add(copy);
    models.set(kind, holder);
  }));
  return models;
}
