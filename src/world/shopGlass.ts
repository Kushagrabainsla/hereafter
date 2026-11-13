import { DoubleSide, Mesh, MeshBasicNodeMaterial, type Object3D, type Scene, type TextureNode } from "three/webgpu";
import { abs, cameraFar, cameraNear, dot, float, normalize, normalView, perspectiveDepthToViewZ, positionView, pow, screenUV, step, vec3 } from "three/tsl";

// The shops' plate glass. Drawn in the world pass, a see-through pane still wrote its own normal
// into the buffer that ambient occlusion and the reflections read, and laid a grainy grey film over
// every lit shop. So the panes draw in the clouds' pass instead (like the rain), after those
// effects, hidden behind anything nearer by the world's depth: a player in front of a window is not
// glazed over. The glass shows little face on and reflects more at a grazing angle, as real glass
// does, in the cool grey of the evening sky; the lit room shows through it.
export const SHOP_GLASS = "shopGlass";

export function moveShopGlass(world: Scene, clouds: Scene, worldDepth: TextureNode): void {
  const facing = abs(dot(normalize(normalView), normalize(positionView).negate()));
  const reflect = float(0.05).add(pow(float(1).sub(facing), 4).mul(0.35));
  const scene = perspectiveDepthToViewZ(worldDepth.sample(screenUV), cameraNear, cameraFar);
  const inFront = step(scene.sub(0.03), positionView.z);
  const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: DoubleSide });
  material.colorNode = vec3(0.3, 0.33, 0.37);
  material.opacityNode = reflect.mul(inFront);
  const panes: Mesh[] = [];
  world.traverse((object) => {
    if (object instanceof Mesh && (object.material as { name?: string }).name === SHOP_GLASS) panes.push(object);
  });
  for (const pane of panes) {
    pane.material = material;
    (clouds as Object3D).attach(pane);
  }
}
