import { LinearFilter, LinearMipmapLinearFilter, MeshBasicNodeMaterial, NoBlending, QuadMesh, RenderTarget, RepeatWrapping, RGBAFormat, UnsignedByteType, type Renderer } from "three/webgpu";
import { clamp, dot, float, floor, Fn, fract, mix, mod, smoothstep, uv, vec2, vec3, vec4 } from "three/tsl";
import type { Node } from "three/webgpu";

// Rain streaks for the modelled pieces, drawn as a picture by the graphics card once at load, after
// the way Saltline (a Fable 5.2 game) draws its textures from code: sharp, long runs of grime that
// a per-pixel noise block cannot give. surfaces.ts lays the picture over each piece from three sides.
//
//   r  grime: a broad film, and fine and broad runs washed down by the rain
//   g  paler runs where the rain ran clean
//
// Paint chips, rust and relief drawn the same way lost two blind tests to the noise-block layers
// (the chips read as decals scattered over flat panels), so only the streaks are drawn.
//
// The picture spans WEAR_TILE metres. All of it is periodic value noise whose frequencies are whole
// numbers, so it repeats without seams.
export const WEAR_TILE = 1.6;
const SIZE = 1024;

type F = Node<"float">;
type V2 = Node<"vec2">;
type V4 = Node<"vec4">;

// A hash of a lattice cell (Dave Hoskins' hash without sine), with a seed.
const hash = (cell: V2, seed: F): F => {
  const p3 = fract(vec3(cell.x, cell.y, cell.x).add(seed.mul(17.13)).mul(vec3(0.1031, 0.103, 0.0973)));
  const q = p3.add(dot(p3, vec3(p3.y, p3.z, p3.x).add(33.33)));
  return fract(q.x.add(q.y).mul(q.z));
};

// Value noise of period `per` cells (0 to 1).
const gn = Fn(([p, per, seed]: [V2, V2, F]) => {
  const i = floor(p), f = fract(p);
  const u = f.mul(f).mul(f).mul(f.mul(f.mul(6).sub(15)).add(10));
  const at = (dx: number, dy: number): F => hash(mod(i.add(vec2(dx, dy)), per), seed);
  return mix(mix(at(0, 0), at(1, 0), u.x), mix(at(0, 1), at(1, 1), u.x), u.y);
}).setLayout({ name: "wearNoise", type: "float", inputs: [{ name: "p", type: "vec2" }, { name: "per", type: "vec2" }, { name: "seed", type: "float" }] });

// Fractal noise over the tile (uv 0 to 1) at whole-number base frequencies `f`.
function fbm(at: V2, f: [number, number], octaves: number, seed: number): F {
  let sum: F = float(0), weight = 0.5, total = 0;
  for (let k = 0; k < octaves; k += 1) {
    const scale = 2 ** k;
    sum = sum.add(gn(at.mul(vec2(f[0] * scale, f[1] * scale)), vec2(f[0] * scale, f[1] * scale), float(seed + k * 7)).mul(weight));
    total += weight;
    weight *= 0.5;
  }
  return sum.div(total);
}

// Runs are stretched along the picture's height, which the three-sided read lays up the walls.
function streaksNode(): V4 {
  const at = uv();
  const film = smoothstep(0.42, 0.85, fbm(at, [3, 2], 5, 41));
  const fine = fbm(at, [70, 1], 3, 42), broad = fbm(at, [22, 1], 3, 43), wide = fbm(at, [9, 2], 3, 44);
  const grime = clamp(film.mul(0.35)
    .add(smoothstep(0.55, 0.85, fine).mul(film.add(0.4)).mul(0.3))
    .add(smoothstep(0.55, 0.8, broad).mul(film.add(0.3)).mul(0.38))
    .add(smoothstep(0.5, 0.8, wide).mul(0.2)), 0, 1);
  const clean = smoothstep(0.6, 0.85, float(1).sub(broad)).mul(0.6);
  return vec4(grime, clean, 0, 1);
}

function target(): RenderTarget {
  const rt = new RenderTarget(SIZE, SIZE, { type: UnsignedByteType, format: RGBAFormat, depthBuffer: false, generateMipmaps: true, minFilter: LinearMipmapLinearFilter, magFilter: LinearFilter });
  rt.texture.wrapS = rt.texture.wrapT = RepeatWrapping;
  rt.texture.anisotropy = 8;
  return rt;
}

export const WEAR = { streaks: target() };

// Draws the picture; call once the renderer is ready, before the first frame. Returns milliseconds.
export function drawWearTextures(renderer: Renderer): number {
  const start = performance.now();
  const previous = renderer.getRenderTarget();
  const material = new MeshBasicNodeMaterial();
  // The channels exactly as worked out: no lighting, blending or colour conversion.
  material.fragmentNode = streaksNode();
  material.blending = NoBlending;
  material.toneMapped = false;
  const quad = new QuadMesh(material);
  renderer.setRenderTarget(WEAR.streaks);
  quad.render(renderer);
  material.dispose();
  renderer.setRenderTarget(previous);
  return performance.now() - start;
}
