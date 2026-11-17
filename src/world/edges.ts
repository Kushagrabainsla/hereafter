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
  // Each side of each triangle: an outside edge, an inside corner, or nothing (the diagonal of a flat
  // face), or an open border. Open borders are the outlines of thin paint layers (lettering, hazard
  // stripes, posters): their own attribute, `edgeOpen`, lets the paint wear at its outline without
  // the rust that grows along a solid's edges spreading over the whole of a thin stripe.
  const kinds: ("out" | "in" | "open" | null)[] = new Array(triangles * 3).fill(null);
  const flatWith: number[][] = Array.from({ length: triangles }, () => []);
  for (let t = 0; t < triangles; t += 1) {
    const corners = [p(t * 3), p(t * 3 + 1), p(t * 3 + 2)];
    const n = [normals[t * 3], normals[t * 3 + 1], normals[t * 3 + 2]];
    for (let s = 0; s < 3; s += 1) {
      const a = corners[(s + 1) % 3], b = corners[(s + 2) % 3], opposite = corners[s];
      if (Math.hypot(...sub(b, a)) < 1e-6) continue;
      const neighbours = (sides.get(sideKey(t * 3 + ((s + 1) % 3), t * 3 + ((s + 2) % 3))) ?? []).filter((other) => other !== t);
      if (!neighbours.length) { kinds[t * 3 + s] = "open"; continue; }
      const o = neighbours[0], m = [normals[o * 3], normals[o * 3 + 1], normals[o * 3 + 2]];
      const facing = n[0] * m[0] + n[1] * m[1] + n[2] * m[2];
      if (facing > FLAT) { flatWith[t].push(o); continue; }
      // Out of this face across the side, in its plane: the neighbour's normal leans that way
      // on an outside edge and back toward this face in an inside corner.
      const along = sub(b, a), toOpposite = sub(opposite, a);
      let away = cross(along, n);
      if (dot(away, toOpposite) > 0) away = away.map((v) => -v) as [number, number, number];
      kinds[t * 3 + s] = dot(away, m) > 0 ? "out" : "in";
    }
  }
  // The flat faces: triangles joined across sides that do not count. A triangle measures to the
  // edges of its whole face, not only its own sides, or wear along an edge would stop at the face's
  // diagonal in a hard triangle. Each triangle keeps the three edges of each kind nearest to it; the
  // distance to an edge's line is linear across the triangle, so the graphics card interpolates it
  // exactly.
  const face = new Int32Array(triangles).fill(-1), faces: number[][] = [];
  for (let t = 0; t < triangles; t += 1) {
    if (face[t] >= 0) continue;
    const members: number[] = [], stack = [t];
    face[t] = faces.length;
    while (stack.length) {
      const u = stack.pop()!;
      members.push(u);
      for (const v of flatWith[u]) if (face[v] < 0) { face[v] = faces.length; stack.push(v); }
    }
    faces.push(members);
  }
  const outside = new Float32Array(count * 3).fill(FAR), inside = new Float32Array(count * 3).fill(FAR), open = new Float32Array(count * 3).fill(FAR);
  for (const members of faces) {
    const edges: { a: V; b: V; kind: "out" | "in" | "open" }[] = [];
    for (const t of members) for (let s = 0; s < 3; s += 1) {
      const kind = kinds[t * 3 + s];
      if (kind) edges.push({ a: p(t * 3 + ((s + 1) % 3)), b: p(t * 3 + ((s + 2) % 3)), kind });
    }
    if (!edges.length) continue;
    for (const t of members) {
      const corners = [p(t * 3), p(t * 3 + 1), p(t * 3 + 2)];
      const n: V = [normals[t * 3], normals[t * 3 + 1], normals[t * 3 + 2]];
      const centre: V = [(corners[0][0] + corners[1][0] + corners[2][0]) / 3, (corners[0][1] + corners[1][1] + corners[2][1]) / 3, (corners[0][2] + corners[1][2] + corners[2][2]) / 3];
      const cornerKeys = new Set(corners.map((corner) => key(...corner)));
      const ownSide = (edge: { a: V; b: V }): boolean => cornerKeys.has(key(...edge.a)) && cornerKeys.has(key(...edge.b));
      for (const kind of ["out", "in", "open"] as const) {
        // Only edges the triangle lies beside, not beyond an end: the line of a window opening's side
        // would otherwise run on across the frame above and below it as a false edge. A side of the
        // triangle itself always counts, and first: a long thin triangle
        // reaching in to a round opening (an air conditioner's fan) lies beside none of the opening's
        // short sides, not even its own, and left pale wedges in the grime round the opening.
        const nearest = edges.filter((edge) => edge.kind === kind && (ownSide(edge) || beside(centre, edge.a, edge.b)))
          .map((edge) => ({ edge, d: segmentDistance(centre, edge.a, edge.b) - (ownSide(edge) ? 1e3 : 0) })).sort((x, y) => x.d - y.d).slice(0, 3);
        const target = kind === "out" ? outside : kind === "in" ? inside : open;
        nearest.forEach(({ edge }, slot) => {
          // In the face's plane, across the edge: distance from its line, never below zero.
          const along = sub(edge.b, edge.a), length = Math.hypot(...along);
          let across = cross(n, along).map((v) => v / length) as V;
          if (dot(across, sub(centre, edge.a)) < 0) across = across.map((v) => -v) as V;
          for (let c = 0; c < 3; c += 1) target[(t * 3 + c) * 3 + slot] = Math.max(0, dot(across, sub(corners[c], edge.a)));
        });
      }
    }
  }
  geometry.setAttribute("edgeOut", new BufferAttribute(outside, 3));
  geometry.setAttribute("edgeIn", new BufferAttribute(inside, 3));
  geometry.setAttribute("edgeOpen", new BufferAttribute(open, 3));
  return geometry;
}

type V = [number, number, number];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V | number[], b: V | number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V | number[], b: V | number[]): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
// Whether a point lies beside a segment: its foot on the segment's line falls between the ends.
function beside(point: V, a: V, b: V): boolean {
  const ab = sub(b, a), k = dot(sub(point, a), ab) / (dot(ab, ab) || 1);
  return k >= 0 && k <= 1;
}
// The distance from a point to a segment.
function segmentDistance(point: V, a: V, b: V): number {
  const ab = sub(b, a), ap = sub(point, a);
  const k = Math.max(0, Math.min(1, dot(ap, ab) / (dot(ab, ab) || 1)));
  return Math.hypot(ap[0] - ab[0] * k, ap[1] - ab[1] * k, ap[2] - ab[2] * k);
}
