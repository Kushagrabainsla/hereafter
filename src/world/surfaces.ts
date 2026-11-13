import type { Node, Texture } from "three/webgpu";
import { abs, bumpMap, clamp, float, mix, normalLocal, normalWorld, positionLocal, smoothstep, step, texture, texture3D, vec2, vec3 } from "three/tsl";
import { noiseVolume } from "./noiseVolume";
import { WEAR, WEAR_TILE } from "./wearTextures";

// Layered surfaces for the modelled pieces, worked out per pixel instead of painted as images,
// the way real materials are built up: a base colour that varies across the surface, paint worn
// through in small chips near the bottom, where boots, carts and rain reach, rust that grows from
// the bottom, grain in wood, dust on what faces up and grime near the ground, roughness that
// changes with all of these, and a little relief so the lamps pick out the surface. The
// patterns follow the piece's own position (for still copies that is where they stand in the
// world), so moving parts such as doors carry their pattern with them and no texture
// coordinates are needed. The noise is read from a block made once at load (noiseVolume.ts). Rain
// streaks come from a picture the graphics card draws once at load
// (wearTextures.ts), read from three sides in the same coordinates.
//
// Each material is given a kind from its name in the model files (docs/asset-pipeline.md).
// Signs stay clean: they are lit and kept up.
export const SurfaceKind = { plain: 0, painted: 1, stone: 2, wood: 3, metal: 4, rusted: 5, fabric: 6 } as const;

export function surfaceKind(name: string): number {
  const n = name.toLowerCase();
  if (n.startsWith("glow_") || n.startsWith("card_") || n.startsWith("sign_")) return SurfaceKind.plain;
  if (n.includes("rust")) return SurfaceKind.rusted;
  if (/paint|enamel|lacquer|dumpster|bld_frame|bld_sash|bld_shutter|bld_shop|extinguisher|fuel_red|hazard|street_lid|valve|teal|propane|^trim$|^red$|stencil/.test(n)) return SurfaceKind.painted;
  if (/stone|bld_trim|concrete|mortar|fx_brick|insulation/.test(n)) return SurfaceKind.stone;
  if (/wood|plywood|pallet|cedar|walnut|oak|bamboo|panel|butcher|wicker|cue|stall/.test(n)) return SurfaceKind.wood;
  if (/steel|galv|chrome|iron|grille|brass|copper|alu|grating|rail|checker|conduit|cage|bracket|hoop|lock/.test(n)) return SurfaceKind.metal;
  if (/fabric|awning|sack|felt|paper|poster|tassel|cushion|seat|leather|sleeve/.test(n)) return SurfaceKind.fabric;
  return SurfaceKind.plain;
}

// Per kind: how much each layer shows.
//   mottle  colour variation        chips  paint worn through      rust  rust patches
//   grain   wood grain              dirt   dust and grime          relief  surface relief
//   rough   roughness variation
const LAYERS = ["mottle", "chips", "rust", "grain", "dirt", "relief", "rough"] as const;
const KINDS: Record<number, Record<(typeof LAYERS)[number], number>> = {
  [SurfaceKind.plain]: { mottle: 0.05, chips: 0, rust: 0, grain: 0, dirt: 0.25, relief: 0.15, rough: 0.15 },
  [SurfaceKind.painted]: { mottle: 0.07, chips: 0.3, rust: 0.05, grain: 0, dirt: 0.6, relief: 0.6, rough: 0.4 },
  [SurfaceKind.stone]: { mottle: 0.18, chips: 0, rust: 0, grain: 0, dirt: 0.7, relief: 1.2, rough: 0.2 },
  [SurfaceKind.wood]: { mottle: 0.14, chips: 0, rust: 0, grain: 1, dirt: 0.55, relief: 0.9, rough: 0.35 },
  [SurfaceKind.metal]: { mottle: 0.08, chips: 0, rust: 0.4, grain: 0, dirt: 0.5, relief: 0.4, rough: 0.7 },
  [SurfaceKind.rusted]: { mottle: 0.12, chips: 0, rust: 1, grain: 0, dirt: 0.45, relief: 1.1, rough: 0.3 },
  [SurfaceKind.fabric]: { mottle: 0.1, chips: 0, rust: 0, grain: 0, dirt: 0.55, relief: 0.5, rough: 0.15 },
};

type FloatNode = Node<"float">;
type ColorNode = Node<"vec3">;

// One layer's amount for a kind, which may differ per vertex.
function amount(kind: FloatNode, layer: (typeof LAYERS)[number]): FloatNode {
  let sum: FloatNode = float(0);
  for (const [key, layers] of Object.entries(KINDS)) {
    if (layers[layer] !== 0) sum = sum.add(step(abs(kind.sub(Number(key))), float(0.5)).mul(layers[layer]));
  }
  return sum;
}

const PRIMER = vec3(0.42, 0.41, 0.38);
// What shows through a deep chip: old dark metal and wood, umber rather than the paint's own hue.
const UNDER = vec3(0.16, 0.11, 0.08);
const RUST_DARK = vec3(0.17, 0.08, 0.04);
const RUST_LIGHT = vec3(0.4, 0.17, 0.06);
const GRIME = vec3(0.5, 0.45, 0.38);

export interface Layered { color: ColorNode; roughness: FloatNode; metalness: FloatNode; normal: ReturnType<typeof bumpMap> }

const signed = (value: FloatNode): FloatNode => value.mul(2).sub(1);

// Samples the wear picture from the three sides of a piece, blended by which way the surface faces,
// in the piece's own coordinates.
function triplanar(map: Texture): Node<"vec4"> {
  const P = positionLocal.div(WEAR_TILE);
  const n = abs(normalLocal);
  const w = n.mul(n).mul(n).mul(n);
  const weights = w.div(w.x.add(w.y).add(w.z));
  return texture(map, vec2(P.z, P.y)).mul(weights.x)
    .add(texture(map, vec2(P.x, P.z)).mul(weights.y))
    .add(texture(map, vec2(P.x, P.y)).mul(weights.z));
}

// The layered surface over a base colour, roughness and metalness.
export function layered(base: ColorNode, roughness: FloatNode, metalness: FloatNode, kind: FloatNode): Layered {
  const P = positionLocal;
  const volume = noiseVolume();
  // Three reads of the noise block: a 6 m block (bumps from 3 m down to 40 cm), an 80 cm block
  // (40 cm down to 5 cm), and one stretched 25 times along the height for grain and brushing.
  const broad = texture3D(volume, P.mul(1 / 6));
  const near = texture3D(volume, P.mul(1 / 0.8));
  const streaked = texture3D(volume, P.mul(vec3(10, 0.4, 10)));
  const coarse = signed(broad.g);
  const medium = signed(broad.a.mul(0.5).add(near.r.mul(0.5)));
  const flecks = signed(near.b.mul(0.65).add(near.a.mul(0.35)));
  const fine = signed(streaked.b);
  const mottle = amount(kind, "mottle"), chips = amount(kind, "chips"), rust = amount(kind, "rust");
  const grain = amount(kind, "grain"), dirt = amount(kind, "dirt"), relief = amount(kind, "relief"), rough = amount(kind, "rough");

  let color: ColorNode = base.mul(float(1).add(coarse.mul(mottle)).add(medium.mul(mottle.mul(0.5))));
  color = color.mul(float(1).add(fine.mul(grain.mul(0.4))));
  // Paint worn through: small chips gathered low down and in a few worn zones, with grey primer
  // at the edge of each and dark old material in the middle.
  const low = float(1).sub(smoothstep(0.05, 1.3, P.y));
  const worn = smoothstep(0.3, 0.8, coarse.mul(0.6).add(low.mul(0.8)));
  const edge = float(0.75).sub(chips.mul(0.4).mul(worn));
  const chipped = smoothstep(edge, edge.add(0.05), flecks).mul(step(float(0.01), chips)).mul(worn);
  const deep = smoothstep(edge.add(0.08), edge.add(0.16), flecks);
  color = mix(color, mix(PRIMER, UNDER, deep), chipped);
  // Rust grows from the bottom of a piece and in patches.
  const rustEdge = float(1.0).sub(rust.mul(0.85));
  const rusty = smoothstep(rustEdge, rustEdge.add(0.15), medium.mul(0.7).add(low.mul(0.6)).add(coarse.mul(0.3))).mul(step(float(0.01), rust));
  color = mix(color, mix(RUST_DARK, RUST_LIGHT, fine.mul(0.5).add(0.5)), rusty);
  // Dust on what faces up, grime near the ground and in broad patches.
  const up = smoothstep(0.5, 0.95, normalWorld.y);
  // Rain streaks: grime washed down in fine and broad runs, and paler runs where rain ran clean.
  const wear = triplanar(WEAR.streaks.texture);
  const dirty = clamp(up.mul(0.55).add(low.mul(0.6)).add(smoothstep(0.05, 0.7, coarse).mul(0.45)).add(wear.r.mul(0.7)), 0, 1).mul(dirt);
  color = mix(color, color.mul(GRIME), dirty);
  color = color.mul(float(1).add(wear.g.mul(dirt).mul(0.12)));

  const surface = clamp(roughness.mul(float(1).add(fine.mul(rough.mul(0.5))).add(coarse.mul(rough.mul(0.4))))
    .add(chipped.mul(0.25)).add(rusty.mul(0.45)).add(dirty.mul(0.15)), 0.04, 1);
  const metal = metalness.mul(float(1).sub(rusty)).mul(float(1).sub(chipped.mul(deep).mul(0.5)));
  // Relief in metres: chips sink below the paint, rust and grain stand up a little.
  const height = medium.mul(0.25).add(fine.mul(grain.mul(0.6).add(0.15))).sub(chipped.mul(0.8)).add(rusty.mul(0.5)).mul(relief).mul(0.0012);
  return { color, roughness: surface, metalness: metal, normal: bumpMap(height) };
}
