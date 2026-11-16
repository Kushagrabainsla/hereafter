import { type Texture } from "three/webgpu";
import { abs, cameraPosition, cross, dot, float, min, mix, normalize, normalWorld, positionWorld, select, sign, texture, uv, vec2, vec3 } from "three/tsl";
import type { Node } from "three/webgpu";

// A room seen through a window, with depth (interior mapping): the view ray is traced on from the
// glass into a box 3 m deep behind it, and the colour is read from where it lands. The painted
// room picture is the back wall; the side walls, the floor and the ceiling take the colours at the
// picture's own edges, blurred (a coarse mip level, so blinds and curtains at the edge do not smear
// into stripes along the walls) and darker as they run back from the window. So the room shifts as
// the player moves and reads as a real space, where the picture alone was a flat panel. Only
// window pixels pay for it.

// The glass card (buildings.py, card_window): 1.38 m by 1.76 m. The room behind it is 3 m deep.
const HALF_X = 0.69;
const HALF_Y = 0.88;
const DEPTH = 3.0;

// A component of the ray kept away from zero, with its sign.
const safe = (v: Node<"float">): Node<"float"> => select(abs(v).lessThan(1e-4), float(1e-4), v);

export function windowRoom(room: Texture): Node<"vec3"> {
  // The card's frame in the world: its outward normal, and across it to the viewer's right.
  const n = normalize(normalWorld);
  const across = normalize(cross(vec3(0, 1, 0), n));
  const view = normalize(positionWorld.sub(cameraPosition));
  const dx = safe(dot(view, across)), dy = safe(view.y), dz = dot(view, n).negate().max(0.02);
  const x0 = uv().x.sub(0.5).mul(HALF_X * 2), y0 = uv().y.sub(0.5).mul(HALF_Y * 2);
  // Distance along the ray to a side wall, to the floor or ceiling, and to the back wall.
  const tx = sign(dx).mul(HALF_X).sub(x0).div(dx);
  const ty = sign(dy).mul(HALF_Y).sub(y0).div(dy);
  const tz = float(DEPTH).div(dz);
  const t = min(tx, min(ty, tz));
  const hx = x0.add(dx.mul(t)), hy = y0.add(dy.mul(t)), deep = dz.mul(t).div(DEPTH);
  const u = hx.div(HALF_X * 2).add(0.5), v = hy.div(HALF_Y * 2).add(0.5);
  const backWall = texture(room, vec2(u, v)).rgb;
  const side = texture(room, vec2(select(hx.greaterThan(0), float(0.97), float(0.03)), v.clamp(0.02, 0.98))).level(float(5)).rgb.mul(mix(float(0.8), float(0.45), deep));
  const ceiling = hy.greaterThan(0);
  const level = texture(room, vec2(u.clamp(0.02, 0.98), select(ceiling, float(0.97), float(0.03)))).level(float(5)).rgb
    .mul(select(ceiling, float(0.85), float(0.5))).mul(mix(float(0.9), float(0.55), deep));
  const wall = select(tx.lessThan(ty), side, level);
  return select(tz.lessThanEqual(min(tx, ty)), backWall, wall);
}
