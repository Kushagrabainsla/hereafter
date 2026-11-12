import { Vector2, Vector3, type Camera } from "three/webgpu";
import { dot, exp, float, max, mix, pow, smoothstep, uniform } from "three/tsl";
import type { Node } from "three/webgpu";

// The air of the market at the end of a wet afternoon: a haze that thickens with distance and
// near the ground, and lights up toward the low sun, so the far end of an alley glows and the
// near shops stay clear. It is laid over the world after it is drawn, from each pixel's distance
// and direction, so it costs one pass of arithmetic. The light shafts through the haze and the
// sun's disc are added here too.

export const ATMOSPHERE = {
  // Haze per metre at ground level, and the height over which it thins to a third.
  density: uniform(0.008),
  height: uniform(9),
  // The haze's own colour (sky light scattered in it) and the sun's colour in it.
  haze: uniform(new Vector3(0.02, 0.026, 0.04)),
  sun: uniform(new Vector3(1.0, 0.72, 0.45)),
  // How strongly the haze lights up toward the sun: a wide glow and a tight one.
  glow: uniform(0.4),
  tight: uniform(0.6),
  // How much haze lies over the sky itself.
  skyHaze: uniform(0.08),
  // The light shafts' strength.
  shafts: uniform(0.6),
  // The direction toward the sun.
  toSun: uniform(new Vector3(0, 0.14, 1).normalize()),
  // The sun's place on the screen (0 to 1, may lie outside) and how far the view faces it (0 to
  // 1); the viewer sets both each frame (aimShafts).
  sunScreen: uniform(new Vector2(0.5, 0.5)),
  sunInView: uniform(0),
};

// How bright the open sky is toward the sun, for the light shafts.
export function sunward(direction: Node<"vec3">): Node<"float"> {
  return pow(max(dot(direction, ATMOSPHERE.toSun), 0), 12);
}

const projected = new Vector3();
const forward = new Vector3();

// Puts the sun on the screen for the shafts: they fade out as the view turns away from it.
export function aimShafts(camera: Camera): void {
  projected.copy(ATMOSPHERE.toSun.value).multiplyScalar(1000).add(camera.position).project(camera);
  ATMOSPHERE.sunScreen.value.set(projected.x * 0.5 + 0.5, 0.5 - projected.y * 0.5);
  camera.getWorldDirection(forward);
  const facing = forward.dot(ATMOSPHERE.toSun.value);
  ATMOSPHERE.sunInView.value = Math.max(0, Math.min(1, (facing - 0.2) / 0.5));
}

// The haze and sun over a colour seen `distance` metres away along the unit world direction
// `direction` from an eye at height `eyeY`. `sky` is 1 where the pixel is sky; `shafts` is the
// share of the view ray the sun lights (0 to 1).
export function atmosphere(color: Node<"vec3">, distance: Node<"float">, direction: Node<"vec3">, eyeY: Node<"float">, sky: Node<"float">, shafts: Node<"float">): Node<"vec3"> {
  const a = ATMOSPHERE;
  // Haze thins with height; the ray's middle height stands for the whole ray.
  const middle = max(eyeY.add(direction.y.mul(distance).mul(0.5)), 0);
  const thickness = distance.mul(a.density).mul(exp(middle.div(a.height).negate()));
  const amount = mix(float(1).sub(exp(thickness.negate())), a.skyHaze, sky);
  const facing = max(dot(direction, a.toSun), 0);
  const phase = float(0.18).add(pow(facing, 4).mul(a.glow)).add(pow(facing, 48).mul(a.tight));
  const sunlit = a.sun.mul(phase);
  const inscatter = a.haze.add(sunlit);
  const hazed = color.mul(float(1).sub(amount)).add(inscatter.mul(amount));
  // Shafts: sunlit haze along the ray, strongest looking toward the sun.
  const shaft = sunlit.mul(shafts).mul(a.shafts).mul(float(1).sub(sky));
  // The sun's disc and its bright core, on the sky only.
  const disc = a.sun.mul(smoothstep(0.99955, 0.99985, facing).mul(30).add(pow(facing, 600).mul(6))).mul(sky);
  return hazed.add(shaft).add(disc);
}
