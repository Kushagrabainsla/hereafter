import { BufferAttribute, type BufferGeometry } from "three/webgpu";

// Where a model's edges are, for wear that follows its shape (surfaces.ts): paint rubs off and
// metal polishes on outside edges, and dirt gathers in inside corners. Worked out once at load
// from the triangles themselves, so no model needs texture coordinates or a baked map.
//
// Each triangle gets its own three corners. For each of its sides the neighbouring triangle across
// it is found: if the two lie flat (within FLAT), the side is only the diagonal of a face and does
// not count; otherwise it is an outside edge (the neighbour turns away) or an inside corner (it
// turns toward this face). A side with no neighbour is an open edge and counts as outside.
// Two attributes carry, for each of the three sides, the distance in metres to it, which the
// graphics card interpolates exactly across the triangle: `edgeOut` for outside edges and
// `edgeIn` for inside corners, FAR where a side does not count.
const FLAT = Math.cos((20 * Math.PI) / 180);
const FAR = 9;

const key = (x: number, y: number, z: number): string => `${Math.round(x * 2000)},${Math.round(y * 2000)},${Math.round(z * 2000)}`;

export function withEdges(source: BufferGeometry): BufferGeometry {
  if (source.getAttribute("edgeOut")) return source;
  const geometry = source.index ? source.toNonIndexed() : source;
  const position = geometry.getAttribute("position");
  const count = position.count, triangles = Math.floor(count / 3);
  const p = (i: number): [number, number, number] => [position.getX(i), position.getY(i), position.getZ(i)];
  // Face normals, from the winding.
  const normals = new Float32Array(triangles * 3);
  for (let t = 0; t < triangles; t += 1) {
    const [ax, ay, az] = p(t * 3), [bx, by, bz] = p(t * 3 + 1), [cx, cy, cz] = p(t * 3 + 2);
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz) || 1;
    nx /= length; ny /= length; nz /= length;
    normals.set([nx, ny, nz], t * 3);
  }
  // Every side, by its two ends in either order: the triangles that share it.
  const sides = new Map<string, number[]>();
  const sideKey = (a: number, b: number): string => {
    const ka = key(...p(a)), kb = key(...p(b));
    return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
  };
  for (let t = 0; t < triangles; t += 1) for (let s = 0; s < 3; s += 1) {
    const k = sideKey(t * 3 + ((s + 1) % 3), t * 3 + ((s + 2) % 3));
    const list = sides.get(k);
    if (list) list.push(t); else sides.set(k, [t]);
  }
  const outside = new Float32Array(count * 3).fill(FAR), inside = new Float32Array(count * 3).fill(FAR);
  for (let t = 0; t < triangles; t += 1) {
    const corners = [p(t * 3), p(t * 3 + 1), p(t * 3 + 2)];
    const n = [normals[t * 3], normals[t * 3 + 1], normals[t * 3 + 2]];
    // Twice the area, for each corner's height above the opposite side.
    const doubleArea = Math.hypot(...cross(sub(corners[1], corners[0]), sub(corners[2], corners[0])));
    for (let s = 0; s < 3; s += 1) {
      const a = corners[(s + 1) % 3], b = corners[(s + 2) % 3], opposite = corners[s];
      const sideLength = Math.hypot(...sub(b, a));
      if (sideLength < 1e-6 || doubleArea < 1e-9) continue;
      const neighbours = (sides.get(sideKey(t * 3 + ((s + 1) % 3), t * 3 + ((s + 2) % 3))) ?? []).filter((other) => other !== t);
      let kind: "out" | "in" | null = "out";
      if (neighbours.length) {
        const o = neighbours[0], m = [normals[o * 3], normals[o * 3 + 1], normals[o * 3 + 2]];
        const facing = n[0] * m[0] + n[1] * m[1] + n[2] * m[2];
        if (facing > FLAT) kind = null;
        else {
          // Out of this face across the side, in its plane: the neighbour's normal leans that way
          // on an outside edge and back toward this face in an inside corner.
          const along = sub(b, a), toOpposite = sub(opposite, a);
          let away = cross(along, n);
          if (dot(away, toOpposite) > 0) away = away.map((v) => -v) as [number, number, number];
          kind = dot(away, m) > 0 ? "out" : "in";
        }
      }
      if (!kind) continue;
      // Linear across the triangle: the corner's height above the side there, zero on the side.
      const height = doubleArea / sideLength;
      const target = kind === "out" ? outside : inside;
      for (let c = 0; c < 3; c += 1) target[(t * 3 + c) * 3 + s] = c === s ? height : 0;
    }
  }
  geometry.setAttribute("edgeOut", new BufferAttribute(outside, 3));
  geometry.setAttribute("edgeIn", new BufferAttribute(inside, 3));
  return geometry;
}

type V = [number, number, number];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V | number[], b: V | number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V | number[]): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
