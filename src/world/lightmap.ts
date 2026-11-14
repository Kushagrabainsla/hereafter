import { BufferAttribute, MeshStandardMaterial, MeshStandardNodeMaterial, SRGBColorSpace, TextureLoader, type BufferGeometry, type Mesh, type Node, type Texture } from "three/webgpu";
import { diffuseColor, float, materialColor, materialRoughness, max, mix, positionWorld, smoothstep, texture, texture3D, uniform, uv, vec3 } from "three/tsl";
import { assetFetch } from "../assetStore";
import { noiseVolume } from "./noiseVolume";
import { outdoorNode } from "./wetness";

// Baked light for the market's static surfaces, made offline by scripts/lightmaps from the
// same map definition. Three images share one atlas, addressed by each surface's second set
// of texture coordinates: how much of the sky a texel can see (sky light and reflections
// are dimmed in corners, under awnings and down narrow alleys), and the light that reaches
// it after bouncing off walls, floors and awnings from the lamps and the low sun, which the
// real-time lights do not provide. Lights shining straight onto surfaces stay real-time.
// The third, the drip mask, marks where rain runs off sills, ledges and fittings down the
// wall below them, so the stains follow the facade's own shapes.
export interface LightmapLook { look: string; vertices: number; checksum: number; uv: string }
export interface LightmapData { version: 1; size: number; bounceScale: number; dayBounceScale?: number; looks: LightmapLook[] }
export interface Lightmap { data: LightmapData; bounce: Texture; sky: Texture; drip: Texture | null }

// How much the baked sky occlusion darkens sky light, from 0 (not at all) to 1 (fully).
const SKY_OCCLUSION = 0.9;
// The bake counts light from the lamps and the sun only; signs, lit windows, shopfronts and
// lanterns glow too and would bounce their light as well. More than this washes the whole
// alley in one even orange and fills the dark gaps between the lamps.
const BOUNCE_GAIN = 0.72;
// The bounce gain as the shader reads it, set per time of day (timeOfDay.ts).
export const BOUNCE = { gain: uniform(BOUNCE_GAIN) };
// Rain stains below sills and ledges: how dark the stain makes the wall, and how much
// smoother (wetter) it is.
const STAIN = { dark: 0.45, gloss: 0.35 };

// A position checksum that tolerates the last-bit differences between JavaScript engines,
// so a lightmap is applied only to the geometry it was baked for.
export function checksum(geometry: BufferGeometry): number {
  const position = geometry.attributes.position.array;
  let sum = 0;
  for (let index = 0; index < position.length; index += 1) sum += Math.abs(position[index]);
  return Math.round(sum * 10) / 10;
}

// By day the bounce light is the sun's alone (baked with bake.py --day); the sky occlusion and the
// drip mask are the same at any time.
export async function loadLightmap(name: string, day = false): Promise<Lightmap | null> {
  try {
    const base = `${import.meta.env.BASE_URL}lightmaps/${name}`;
    const response = await assetFetch(`${base}.json`);
    if (!response.ok) return null;
    const data = await response.json() as LightmapData;
    if (data.version !== 1) return null;
    if (day && !data.dayBounceScale) day = false;
    if (day) data.bounceScale = data.dayBounceScale!;
    const loader = new TextureLoader();
    const [bounce, sky, drip] = await Promise.all([loader.loadAsync(`${base}-${day ? "day-bounce" : "bounce"}.webp`), loader.loadAsync(`${base}-sky.webp`), loader.loadAsync(`${base}-drip.webp`).catch(() => null)]);
    bounce.colorSpace = SRGBColorSpace;
    // Blender writes the atlas with its first row at the top of the image, where the export's
    // texture coordinates start, so the images are read as stored, not flipped.
    for (const image of [bounce, sky, drip]) if (image) { image.flipY = false; image.needsUpdate = true; }
    return { data, bounce, sky, drip };
  } catch (error) {
    console.warn("Baked lighting unavailable; using real-time light only.", error);
    return null;
  }
}

function decode(base64: string): Uint16Array {
  const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  return new Uint16Array(bytes.buffer);
}

// Gives each surface its lightmap coordinates and a material that reads the bake. A surface
// whose geometry no longer matches the bake keeps real-time light only. Returns how many
// surfaces took baked light.
export function applyLightmap(surfaces: Mesh[], lightmap: Lightmap): number {
  const at = uv(1);
  const sky = mix(float(1), texture(lightmap.sky, at).r, SKY_OCCLUSION);
  const bounce = texture(lightmap.bounce, at).rgb.mul(BOUNCE.gain.mul(lightmap.data.bounceScale));
  // The stain runs in streaks of different lengths: noise stretched tall (0.9 m across, 30 m up)
  // gives each narrow column of wall its own cut-off along the fade. The walls run north-south or
  // east-west, so x + z runs along every one of them.
  const along = positionWorld.x.add(positionWorld.z);
  const column = texture3D(noiseVolume(), vec3(along.div(0.9), positionWorld.y.div(30), float(0.53))).g.mul(0.6)
    .add(texture3D(noiseVolume(), vec3(along.div(0.22), positionWorld.y.div(12), float(0.29))).b.mul(0.4));
  const drip = lightmap.drip ? texture(lightmap.drip, at).r : null;
  // A faint even stain under every ledge, and the streaks over it with soft ends. Broad patches
  // (3.5 m across) stay cleaner, so the streaks do not repeat evenly along a wall, and walls over
  // an indoor floor stay clean: there the ray up met a ceiling, not a ledge in the rain.
  const patches = smoothstep(0.3, 0.7, texture3D(noiseVolume(), vec3(along.div(3.5), positionWorld.y.div(9), float(0.81))).r).mul(0.75).add(0.25);
  // Identical windows bake identical drips, so each window's stain is given its own strength from
  // noise about a window's width across (1.4 m): some run dark, some are barely there.
  const own = smoothstep(0.3, 0.7, texture3D(noiseVolume(), vec3(along.div(1.4), positionWorld.y.div(6), float(0.37))).g).mul(0.95).add(0.05);
  const stain = drip ? max(drip.mul(0.3), smoothstep(column.mul(0.85), column.mul(0.85).add(0.35), drip)).mul(patches).mul(own).mul(smoothstep(0.5, 1, outdoorNode(positionWorld))) : null;
  let applied = 0;
  for (const entry of lightmap.data.looks) {
    const mesh = surfaces.find((surface) => surface.name === `static:${entry.look}`);
    const geometry = mesh?.geometry;
    if (!mesh || !geometry || geometry.attributes.position.count !== entry.vertices || Math.abs(checksum(geometry) - entry.checksum) > 0.5) {
      console.warn(`Lightmap does not match ${entry.look}; rebake with npm run build:lightmaps.`);
      continue;
    }
    const coordinates = decode(entry.uv);
    if (coordinates.length !== entry.vertices * 2) continue;
    geometry.setAttribute("uv1", new BufferAttribute(coordinates, 2, true));
    // Materials are shared with things that are not baked, such as window frames and
    // stalls, so each surface gets its own copy.
    const source = mesh.material as MeshStandardMaterial;
    const material = new MeshStandardNodeMaterial();
    material.copy(source);
    material.aoNode = sky;
    // Outside, dirt gathers where little sky reaches: under ledges and sills, in corners and at the
    // foot of narrow walls, where the rain does not wash it off.
    const sheltered = float(1).sub(smoothstep(0.25, 0.85, texture(lightmap.sky, at).r)).mul(smoothstep(0.5, 1, outdoorNode(positionWorld)));
    material.colorNode = ((material.colorNode ?? materialColor) as unknown as Node<"vec3">).mul(mix(float(1), float(0.55), sheltered));
    if (stain) {
      const color = (material.colorNode ?? materialColor) as unknown as Node<"vec3">;
      material.colorNode = color.mul(mix(vec3(1), vec3(0.97, 0.95, 0.9).mul(1 - STAIN.dark), vec3(stain)));
      material.roughnessNode = ((material.roughnessNode ?? materialRoughness) as unknown as Node<"float">).mul(float(1).sub(stain.mul(STAIN.gloss)));
    }
    material.emissiveNode = diffuseColor.rgb.mul(bounce);
    mesh.material = material;
    applied += 1;
  }
  return applied;
}
