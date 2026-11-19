import type { Node, Texture } from "three/webgpu";
import { abs, attribute, bumpMap, clamp, dot, float, fwidth, max, min, mix, normalLocal, normalWorld, positionLocal, positionWorld, smoothstep, step, texture, texture3D, uniform, vec2, vec3 } from "three/tsl";
import { noiseVolume } from "./noiseVolume";
import { WEAR, WEAR_TILE } from "./wearTextures";
import { outdoorNode, WEATHER } from "./wetness";

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
export const SurfaceKind = { plain: 0, painted: 1, stone: 2, wood: 3, metal: 4, rusted: 5, fabric: 6, appliance: 7, sprayed: 8, pasted: 9 } as const;

export function surfaceKind(name: string): number {
  const n = name.toLowerCase();
  if (n.startsWith("glow_") || n.startsWith("card_") || n.startsWith("sign_")) return SurfaceKind.plain;
  // Spray paint on a wall (the mural) and paper pasted on one (the posters and their tape).
  if (n.startsWith("mural_")) return SurfaceKind.sprayed;
  if (n.startsWith("poster_")) return SurfaceKind.pasted;
  if (n.includes("rust")) return SurfaceKind.rusted;
  if (n === "paint_ac") return SurfaceKind.appliance;
  if (/paint|enamel|lacquer|dumpster|bld_sash|bld_shop|extinguisher|fuel_red|hazard|street_lid|valve|teal|propane|^trim$|^red$|stencil/.test(n)) return SurfaceKind.painted;
  if (/stone|bld_trim|concrete|mortar|fx_brick|insulation/.test(n)) return SurfaceKind.stone;
  if (/wood|plywood|pallet|cedar|walnut|oak|bamboo|panel|butcher|wicker|cue|stall/.test(n)) return SurfaceKind.wood;
  if (/bld_shutter|steel|galv|chrome|iron|grille|brass|copper|alu|grating|rail|checker|conduit|cage|bracket|hoop|lock/.test(n)) return SurfaceKind.metal;
  if (/fabric|awning|sack|felt|paper|poster|tassel|cushion|seat|leather|sleeve/.test(n)) return SurfaceKind.fabric;
  return SurfaceKind.plain;
}

// Per kind: how much each layer shows.
//   mottle  colour variation        chips  paint worn through      rust  rust patches
//   grain   wood grain              dirt   dust and grime          relief  surface relief
//   rough   roughness variation     edge   wear on outside edges  cavity  dirt in inside corners
//   soak    how much darker the surface turns when wet (porous ones most)
const LAYERS = ["mottle", "chips", "rust", "grain", "dirt", "relief", "rough", "edge", "cavity", "soak", "grime"] as const;
const KINDS: Record<number, Record<(typeof LAYERS)[number], number>> = {
  [SurfaceKind.plain]: { mottle: 0.05, chips: 0, rust: 0, grain: 0, dirt: 0.25, relief: 0.15, rough: 0.15, edge: 0.25, cavity: 0.6, soak: 0.15, grime: 0 },
  [SurfaceKind.painted]: { mottle: 0.1, chips: 0.38, rust: 0.05, grain: 0, dirt: 1, relief: 0.6, rough: 0.4, edge: 1, cavity: 1, soak: 0.12, grime: 0 },
  [SurfaceKind.stone]: { mottle: 0.18, chips: 0, rust: 0, grain: 0, dirt: 0.7, relief: 1.2, rough: 0.2, edge: 0.7, cavity: 1, soak: 0.45, grime: 0 },
  [SurfaceKind.wood]: { mottle: 0.14, chips: 0, rust: 0, grain: 1, dirt: 0.55, relief: 0.9, rough: 0.35, edge: 0.7, cavity: 1, soak: 0.4, grime: 0 },
  [SurfaceKind.metal]: { mottle: 0.08, chips: 0, rust: 0.55, grain: 0, dirt: 0.5, relief: 0.4, rough: 0.7, edge: 0.8, cavity: 0.9, soak: 0.1, grime: 0 },
  [SurfaceKind.rusted]: { mottle: 0.12, chips: 0, rust: 1, grain: 0, dirt: 0.45, relief: 1.1, rough: 0.3, edge: 0.4, cavity: 1, soak: 0.3, grime: 0 },
  [SurfaceKind.fabric]: { mottle: 0.1, chips: 0, rust: 0, grain: 0, dirt: 0.55, relief: 0.5, rough: 0.15, edge: 0.15, cavity: 0.8, soak: 0.5, grime: 0 },
  [SurfaceKind.appliance]: { mottle: 0.08, chips: 0.15, rust: 0.05, grain: 0, dirt: 1, relief: 0.4, rough: 0.4, edge: 0.3, cavity: 1, soak: 0.12, grime: 1 },
  [SurfaceKind.sprayed]: { mottle: 0.14, chips: 0, rust: 0, grain: 0, dirt: 0.9, relief: 1.1, rough: 0.2, edge: 0, cavity: 0, soak: 0.35, grime: 0 },
  [SurfaceKind.pasted]: { mottle: 0.1, chips: 0, rust: 0, grain: 0, dirt: 0.7, relief: 0.5, rough: 0.15, edge: 0.2, cavity: 0.5, soak: 0.55, grime: 0 },
};
// Sprayed paint and pasted paper left out for years: how far each fades toward grey, and for the
// mural how much of the paint has flaked off to the plaster under it.
export const POSTED = { sprayFade: 0.35, paperFade: 0.3, flaked: 0.14, stains: 0.5 };
// The grimy plaster that shows where the mural's paint has flaked away.
const PLASTER_UNDER = vec3(0.3, 0.27, 0.22);
// The brown of water stains in paper.
const PAPER_STAIN = vec3(0.78, 0.68, 0.5);

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
// The dark brown at the edge of a rust patch.
const RUST_RIM = vec3(0.11, 0.075, 0.05);
// The brown a painted surface takes round rust, as a multiplier.
const RUST_STAIN = vec3(0.72, 0.52, 0.38);
// The dark of dirt packed into a corner.
const CREASE = vec3(0.32, 0.28, 0.24);

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

// No real paint or plastic reflects much more than about 60% of the light (linear): near-white
// paint (the food truck, air conditioners) burned out to pure white in the day sun.
export const ALBEDO = { max: uniform(0.6) };

// The layered surface over a base colour, roughness and metalness.
export function layered(source: ColorNode, roughness: FloatNode, metalness: FloatNode, kind: FloatNode): Layered {
  const bright = dot(source, vec3(0.2126, 0.7152, 0.0722));
  const base = source.mul(min(float(1), ALBEDO.max.div(max(bright, float(1e-3)))));
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
  // Chips gather in a few worn zones, more of them low down, never as an even sprinkle along the
  // bottom of a panel (which read as a row of polka dots); their outlines are ragged.
  const worn = smoothstep(0.4, 0.9, coarse.mul(0.75).add(low.mul(0.45)));
  const flake = flecks.mul(0.75).add(medium.mul(0.25)).add(fine.mul(0.12));
  const edge = float(0.75).sub(chips.mul(0.4).mul(worn));
  const chipped = smoothstep(edge, edge.add(0.08), flake).mul(step(float(0.01), chips)).mul(worn);
  const deep = smoothstep(edge.add(0.1), edge.add(0.2), flake);
  color = mix(color, mix(PRIMER, UNDER, deep), chipped);
  // Rain streaks: grime washed down in fine and broad runs, and paler runs where rain ran clean.
  const wear = triplanar(WEAR.streaks.texture);
  // Rust starts where water sits and paint wears: along a piece's edges, seams and inside corners
  // (edges.ts), and along its bottom. A ragged band about 20 cm wide follows each edge, more of it
  // low down; rust in the middle of a clean panel, away from any edge, read as a pasted blob. Bare
  // metal rusts in patches inside that band; painted pieces rust through the paint in stretches of
  // it, where the noise says the paint has failed.
  const rustEdge = float(1.0).sub(rust.mul(0.85));
  // A grainy, stringy edge, drawn out up and down by the stretched noise, not a cut-out shape.
  const rustField = medium.mul(0.6).add(low.mul(0.6)).add(coarse.mul(0.3)).add(fine.mul(0.25)).add(flecks.mul(0.15));
  const solidEdge = attribute("edgeOut", "vec3"), solidCorner = attribute("edgeIn", "vec3");
  const toSeam = min(min(solidEdge.x, min(solidEdge.y, solidEdge.z)), min(solidCorner.x, min(solidCorner.y, solidCorner.z)));
  const seam = smoothstep(0.2, 0.0, toSeam.add(flecks.mul(0.035)).add(fine.mul(0.02)));
  const rustZone = max(seam.mul(low.mul(0.5).add(0.7)), low.mul(low)).clamp(0, 1);
  const nearSeam = max(smoothstep(0.45, 0.05, toSeam), low);
  const paintRust = seam.mul(smoothstep(0.0, 0.4, coarse.mul(0.5).add(low.mul(0.55)).add(flecks.mul(0.3)))).mul(step(float(0.01), chips));
  const rusty = max(smoothstep(rustEdge, rustEdge.add(0.3), rustField).mul(step(float(0.01), rust)).mul(rustZone), paintRust);
  // Round each patch the rust bleeds into the paint as a brown stain that fades out, and runs down
  // from it in streaks, so a patch never ends at a cut line against clean paint.
  const bleed = max(smoothstep(rustEdge.sub(0.3), rustEdge.add(0.05), rustField.add(wear.r.mul(0.2))).mul(step(float(0.01), rust)).mul(nearSeam), smoothstep(0.0, 0.6, paintRust.add(seam.mul(0.25))));
  color = mix(color, color.mul(RUST_STAIN), bleed.mul(0.55));
  // Mostly the dark brown of old rust, the bright orange only in flecks.
  color = mix(color, mix(RUST_DARK, RUST_LIGHT, fine.mul(0.5).add(0.5).mul(0.8)), rusty);
  // The rust also runs: water carries it down from the seams and edges in thin streaks, along the
  // rain runs of the wear picture, instead of sitting in separate flecks.
  const rustRuns = smoothstep(0.12, 0.35, wear.r).mul(max(smoothstep(0.3, 0.55, rust), smoothstep(0.0, 0.3, paintRust).mul(0.7))).mul(smoothstep(-0.3, 0.3, coarse.add(low.mul(0.5)))).mul(nearSeam);
  color = mix(color, color.mul(RUST_STAIN).mul(0.75), rustRuns.mul(0.9));
  // Dust on what faces up, grime near the ground and in broad patches.
  const up = smoothstep(0.5, 0.95, normalWorld.y);
  // Rain streaks (read above): grime washed down in fine and broad runs, and paler runs where rain ran clean.
  const dirty = clamp(up.mul(0.55).add(low.mul(0.6)).add(smoothstep(0.05, 0.7, coarse).mul(0.45)).add(wear.r.mul(0.7)), 0, 1).mul(dirt);
  color = mix(color, color.mul(GRIME), dirty);
  color = color.mul(float(1).add(wear.g.mul(dirt).mul(0.12)));
  // Sun and weather fade what faces the sky most: tops go paler and greyer than the sides, in
  // patches, and a little more so higher up a piece.
  const faded = up.mul(0.7).add(smoothstep(0.5, 2.5, P.y).mul(0.3)).mul(smoothstep(-0.5, 0.4, coarse)).mul(dirt.mul(0.45));
  const grey = color.x.mul(0.3).add(color.y.mul(0.59)).add(color.z.mul(0.11));
  color = mix(color, vec3(grey).mul(1.12).add(color.mul(0.08)), faded);
  // Spray paint and posters: bright, clean, flat colour read as a picture laid on the wall. Paint and
  // printed paper out in the weather fade toward a warm grey; the mural's paint has flaked off in
  // ragged patches, more of them low down, down to the grimy plaster; the posters carry brown water
  // stains with a darker tide line, gathered toward the bottom where the wet wicks up.
  const sprayed = step(abs(kind.sub(SurfaceKind.sprayed)), float(0.5));
  const pasted = step(abs(kind.sub(SurfaceKind.pasted)), float(0.5));
  const greyNow = dot(color, vec3(0.3, 0.59, 0.11));
  color = mix(color, vec3(greyNow).mul(vec3(1.04, 1, 0.9)), sprayed.mul(POSTED.sprayFade).add(pasted.mul(POSTED.paperFade)));
  const flakeField = flake.mul(0.55).add(coarse.mul(0.3)).add(low.mul(0.25)).add(fine.mul(0.1));
  const flaked = smoothstep(float(0.75 - POSTED.flaked), float(0.8 - POSTED.flaked), flakeField).mul(sprayed);
  color = mix(color, PLASTER_UNDER.mul(float(1).add(medium.mul(0.15))), flaked);
  const stainField = medium.mul(0.7).add(coarse.mul(0.3)).add(low.mul(0.5));
  const stained = smoothstep(0.35, 0.55, stainField).mul(pasted).mul(POSTED.stains);
  const tideLine = smoothstep(0.06, 0.0, abs(stainField.sub(0.45))).mul(pasted).mul(POSTED.stains);
  color = mix(color, color.mul(PAPER_STAIN), stained);
  color = mix(color, color.mul(PAPER_STAIN.mul(0.7)), tideLine.mul(0.6));

  // Wear that follows the shape (edges.ts): within a few centimetres of an outside edge, in
  // stretches broken up by noise, paint is rubbed through to dull primer and old dark metal, and
  // stone, wood and bare metal are worn a little paler; within a few centimetres of an inside corner,
  // dirt gathers dark and dull. Nothing at an edge is made shinier: polished steel caught the sky
  // and drew bright silver outlines round every rim. The wear fades out where a pixel spans more
  // than about a centimetre, as a band thinner than a pixel can only flicker as a line.
  const toEdge = attribute("edgeOut", "vec3"), toCorner = attribute("edgeIn", "vec3"), toOutline = attribute("edgeOpen", "vec3");
  const outsideEdge = min(min(toEdge.x, min(toEdge.y, toEdge.z)), min(toOutline.x, min(toOutline.y, toOutline.z))), insideCorner = min(toCorner.x, min(toCorner.y, toCorner.z));
  const pixel = fwidth(outsideEdge).add(fwidth(insideCorner)).mul(0.5);
  const close = float(1).sub(smoothstep(0.006, 0.016, pixel));
  const edgeAmount = amount(kind, "edge").mul(close), cavityAmount = amount(kind, "cavity").mul(close);
  const ragged = flecks.mul(0.6).add(medium.mul(0.4));
  // Patchy: only stretches of an edge wear, more of them low down where they get knocked.
  const rubbed = smoothstep(0.035, 0.004, outsideEdge.add(ragged.mul(0.014)).sub(low.mul(0.008))).mul(smoothstep(-0.15, 0.3, coarse.mul(0.5).add(ragged.mul(0.5)).add(low.mul(0.45)))).mul(edgeAmount);
  const painted = step(float(0.01), chips);
  const throughPaint = rubbed.mul(painted);
  const deepEdge = smoothstep(0.45, 0.85, throughPaint).mul(smoothstep(0.012, 0.0, outsideEdge.add(ragged.mul(0.006))));
  color = mix(color, PRIMER.mul(0.6), throughPaint.mul(0.8));
  color = mix(color, UNDER, deepEdge);
  color = color.mul(float(1).add(rubbed.mul(float(1).sub(painted)).mul(0.08)));
  const crease = smoothstep(0.05, 0.0, insideCorner.add(medium.mul(0.02))).mul(cavityAmount);
  color = mix(color, color.mul(CREASE), crease.mul(0.5));
  // Appliances left out on a wall for years (the air conditioners): the white paint yellows in
  // patches, dirt runs down the faces from the top, and grime packs dark into the edges and round
  // the grille, where the rubbed-pale edge wear of other paint would look new. Won 45 spots to 0 in
  // four blind tests, together with the heavier weathering of the drums in props.ts.
  const grime = amount(kind, "grime");
  const aged = mix(vec3(1), vec3(0.93, 0.86, 0.72), smoothstep(-0.6, 0.6, coarse).mul(0.5).add(0.5));
  color = mix(color, color.mul(aged), grime);
  const runsDown = smoothstep(0.1, 0.5, wear.r).mul(float(1).sub(up));
  const edgeGrime = smoothstep(0.05, 0.0, min(outsideEdge, insideCorner).add(flecks.mul(0.012)));
  const grimed = clamp(runsDown.mul(0.7).add(edgeGrime.mul(0.8)).add(up.mul(0.5)), 0, 1).mul(grime);
  color = mix(color, color.mul(GRIME.mul(0.75)), grimed);
  // Rust patches painted on a piece (street_rust, bld_rust) are flat shapes with cut outlines, and
  // bright rust against clean paint read as a sticker. Toward its outline each patch turns to the
  // dark, dull brown that rings real rust, ragged with fine noise, so it fades into the paint.
  const rustPatch = step(abs(kind.sub(SurfaceKind.rusted)), float(0.5));
  const finer = signed(texture3D(volume, P.mul(1 / 0.06)).r);
  const rim = smoothstep(0.05, 0.0, outsideEdge.add(finer.mul(0.02)).add(flecks.mul(0.012))).mul(rustPatch);
  color = mix(color, RUST_RIM, rim.mul(0.85));

  // Rain: what faces up stays wet, runs of water follow the grime streaks down the sides, and a band
  // near the ground is splashed; a wet surface darkens (porous ones most) and turns glossy. Broad
  // patches stay drier, and indoors nothing is wet. Smudges vary the gloss of dry metal and paint,
  // where one even sheen read as plastic.
  const soak = amount(kind, "soak");
  const splash = smoothstep(0.45, 0.0, P.y).mul(float(1).sub(up));
  const runs = smoothstep(0.3, 0.7, wear.r).mul(float(1).sub(up));
  const wet = clamp(up.mul(0.6).add(runs.mul(0.75)).add(splash.mul(0.6)), 0, 1)
    .mul(smoothstep(-0.45, 0.15, coarse.add(medium.mul(0.4)))).mul(smoothstep(0.97, 1, outdoorNode(positionWorld))).mul(WEATHER.wet);
  color = color.mul(float(1).sub(wet.mul(soak)));
  const smudge = signed(near.g).mul(rough.mul(0.35));

  const dry = clamp(roughness.mul(float(1).add(fine.mul(rough.mul(0.5))).add(coarse.mul(rough.mul(0.4))).add(smudge))
    .add(chipped.mul(0.25)).add(rusty.mul(0.45)).add(dirty.mul(0.15)).add(crease.mul(0.25)).add(throughPaint.mul(0.25)), 0.04, 1);
  // Wet gloss is broken up: beads and drier spots between them, not one even sheen (that read as
  // plastic across a whole lid).
  const beaded = float(0.16).add(smoothstep(-0.35, 0.55, flecks.add(fine.mul(0.3))).mul(0.3));
  const surface = mix(dry, min(dry, beaded), wet.mul(0.8));
  const metal = metalness.mul(float(1).sub(rusty)).mul(float(1).sub(chipped.mul(deep).mul(0.5))).mul(float(1).sub(throughPaint.mul(0.7)));
  // Relief in metres: chips sink below the paint, rust and grain stand up a little.
  // Flaked mural paint leaves a step down to the plaster.
  const height = medium.mul(0.25).add(fine.mul(grain.mul(0.6).add(0.15))).sub(chipped.mul(0.8)).add(rusty.mul(0.5)).sub(flaked.mul(0.6)).mul(relief).mul(0.0012);
  return { color, roughness: surface, metalness: metal, normal: bumpMap(height) };
}
