import { AnimationMixer, Group, Matrix4, Mesh, Vector3, type Object3D } from "three/webgpu";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";
import { type WeaponKind } from "./combatRules";

const KINDS: WeaponKind[] = ["pistol", "rifle"];
// The first-person files: one per gun, and the bare arms, which the view uses for hands on a
// carried prop or the extinguisher.
export type ViewFile = WeaponKind | "hands";
const PATHS: Record<ViewFile, unknown> = { hands: import.meta.env.VITE_HANDS_VIEWMODEL, pistol: import.meta.env.VITE_PISTOL_VIEWMODEL, rifle: import.meta.env.VITE_RIFLE_VIEWMODEL };
const loads = new Map<ViewFile, Promise<GLTF | null>>();

// The authored first-person files hold the arms and the weapon together. Each is loaded
// once: the first-person view uses the whole file, and pickups and other players use a
// copy of just the weapon, so every weapon in the game is the same model. The arms file was
// built holding a blade, which is taken out as it loads.
export function loadWeaponFile(kind: ViewFile): Promise<GLTF | null> {
  let load = loads.get(kind);
  if (!load) {
    const path = PATHS[kind];
    const url = typeof path === "string" && path ? new URL(path, new URL(import.meta.env.BASE_URL, location.origin)) : null;
    // Only same-origin build settings: no third-party requests.
    load = url && url.origin === location.origin ? new GLTFLoader().loadAsync(url.href).then((gltf) => {
      if (kind === "hands") gltf.scene.getObjectByName("weapon")?.removeFromParent();
      return gltf;
    }).catch((error: unknown) => { console.warn(`Could not load ${kind} model`, error); return null; }) : Promise.resolve(null);
    loads.set(kind, load);
  }
  return load;
}

// How a gun is held, in the gun's own frame, as the first-person arms hold it at the start of
// their idle clip: where each hand sits and turns, where the right shoulder is, and the
// muzzle. Other players' characters copy it, so their hands sit on their guns as the
// player's own do (src/game/playerModel.ts).
export interface HeldGrip { right: Matrix4; left: Matrix4; shoulder: Vector3; muzzle: Vector3 }

function gripOf(gltf: GLTF): HeldGrip | null {
  const scene = cloneSkeleton(gltf.scene);
  const idle = gltf.animations.find((clip) => clip.name === "idle");
  if (idle) { const mixer = new AnimationMixer(scene); mixer.clipAction(idle).play(); mixer.update(0); }
  scene.updateMatrixWorld(true);
  // GLTFLoader replaces spaces in node names with underscores.
  const find = (name: string): Object3D | undefined => scene.getObjectByName(name.replace(/\s+/g, "_")) ?? scene.getObjectByName(name);
  const weapon = find("weapon"), right = find("Bip01 R Hand"), left = find("Bip01 L Hand"), shoulder = find("Bip01 R UpperArm"), muzzle = find("muzzle");
  if (!weapon || !right || !left || !shoulder) return null;
  const into = weapon.matrixWorld.clone().invert();
  return {
    right: into.clone().multiply(right.matrixWorld),
    left: into.clone().multiply(left.matrixWorld),
    shoulder: shoulder.getWorldPosition(new Vector3()).applyMatrix4(into),
    muzzle: muzzle ? muzzle.getWorldPosition(new Vector3()).applyMatrix4(into) : new Vector3(0, 0, -0.5),
  };
}

// Just the gun from each file, in its own frame: grip at the origin, barrel along -Z, up +Y, real size in metres. Its muzzle flash stays, hidden, for other players'
// guns to show as they fire; a gun's userData.grip says how it is held. Copies share
// geometry and materials with the first-person model.
export async function loadWeaponModels(): Promise<Map<WeaponKind, Object3D>> {
  const models = new Map<WeaponKind, Object3D>();
  await Promise.all(KINDS.map(async (kind) => {
    const gltf = await loadWeaponFile(kind);
    const weapon = gltf?.scene.getObjectByName("weapon");
    if (!gltf || !weapon) return;
    const copy = weapon.clone(true);
    const flash = copy.getObjectByName("muzzle");
    if (flash) flash.visible = false;
    copy.position.set(0, 0, 0);
    copy.quaternion.identity();
    copy.scale.set(1, 1, 1);
    copy.traverse((object) => {
      if (object instanceof Mesh) { object.renderOrder = 0; object.frustumCulled = true; object.castShadow = true; object.receiveShadow = true; }
    });
    const holder = new Group();
    holder.name = `${kind}-model`;
    holder.add(copy);
    holder.userData.grip = gripOf(gltf);
    models.set(kind, holder);
  }));
  return models;
}
