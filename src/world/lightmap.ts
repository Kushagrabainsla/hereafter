import { BufferAttribute, MeshStandardMaterial, MeshStandardNodeMaterial, SRGBColorSpace, TextureLoader, type BufferGeometry, type Mesh, type Texture } from "three/webgpu";
import { diffuseColor, float, mix, texture, uv } from "three/tsl";

// Baked light for the market's static surfaces, made offline by scripts/lightmaps from the
// same map definition. Two images share one atlas, addressed by each surface's second set
// of texture coordinates: how much of the sky a texel can see (sky light and reflections
// are dimmed in corners, under awnings and down narrow alleys), and the light that reaches
// it after bouncing off walls, floors and awnings from the lamps and the low sun, which the
// real-time lights do not provide. Lights shining straight onto surfaces stay real-time.
export interface LightmapLook { look: string; vertices: number; checksum: number; uv: string }
export interface LightmapData { version: 1; size: number; bounceScale: number; looks: LightmapLook[] }
export interface Lightmap { data: LightmapData; bounce: Texture; sky: Texture }

// How much the baked sky occlusion darkens sky light, from 0 (not at all) to 1 (fully).
const SKY_OCCLUSION = 0.9;
// The bake counts light from the lamps and the sun only; signs, lit windows, shopfronts and
// lanterns glow too and would bounce their light as well, so the bounce is lifted for them.
const BOUNCE_GAIN = 1.6;

// A position checksum that tolerates the last-bit differences between JavaScript engines,
// so a lightmap is applied only to the geometry it was baked for.
export function checksum(geometry: BufferGeometry): number {
  const position = geometry.attributes.position.array;
  let sum = 0;
  for (let index = 0; index < position.length; index += 1) sum += Math.abs(position[index]);
  return Math.round(sum * 10) / 10;
}

export async function loadLightmap(name: string): Promise<Lightmap | null> {
  try {
    const base = `${import.meta.env.BASE_URL}lightmaps/${name}`;
    const response = await fetch(`${base}.json`);
    if (!response.ok) return null;
    const data = await response.json() as LightmapData;
    if (data.version !== 1) return null;
    const loader = new TextureLoader();
    const [bounce, sky] = await Promise.all([loader.loadAsync(`${base}-bounce.webp`), loader.loadAsync(`${base}-sky.webp`)]);
    bounce.colorSpace = SRGBColorSpace;
    return { data, bounce, sky };
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
  const bounce = texture(lightmap.bounce, at).rgb.mul(lightmap.data.bounceScale * BOUNCE_GAIN);
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
    material.emissiveNode = diffuseColor.rgb.mul(bounce);
    mesh.material = material;
    applied += 1;
  }
  return applied;
}
