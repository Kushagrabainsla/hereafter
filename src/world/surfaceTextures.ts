import { RepeatWrapping, SRGBColorSpace, TextureLoader, type Texture } from "three/webgpu";

// Bundled Poly Haven photo materials (see docs/data-sources.md). Tiled textures repeat once
// every `tileMeters`, so geometry with texture coordinates in metres keeps their real scale.
export interface SurfaceTextures {
  asphalt: Texture;
  asphaltNormal: Texture;
  pavement: Texture;
  pavementNormal: Texture;
  plaster: Texture;
  plasterNormal: Texture;
  concrete: Texture;
  concreteNormal: Texture;
  brick: Texture;
  brickNormal: Texture;
  storefrontStone: Texture;
  storefrontCafe: Texture;
  dispose: () => void;
}

export async function loadSurfaceTextures(): Promise<SurfaceTextures> {
  const loader = new TextureLoader();
  const tiled = async (file: string, tileMeters: number, isColor: boolean): Promise<Texture> => {
    const texture = await loader.loadAsync(`${import.meta.env.BASE_URL}textures/${file}`);
    if (isColor) texture.colorSpace = SRGBColorSpace;
    texture.wrapS = texture.wrapT = RepeatWrapping;
    texture.repeat.set(1 / tileMeters, 1 / tileMeters);
    texture.anisotropy = 8;
    return texture;
  };
  const pair = (name: string, tileMeters: number): Promise<Texture>[] => [tiled(`${name}_diff.jpg`, tileMeters, true), tiled(`${name}_normal.jpg`, tileMeters, false)];
  const [asphalt, asphaltNormal, pavement, pavementNormal, plaster, plasterNormal, concrete, concreteNormal, brick, brickNormal, storefrontStone, storefrontCafe] = await Promise.all([
    ...pair("asphalt_02", 5), ...pair("concrete_pavement_02", 4), ...pair("plastered_wall_04", 5),
    ...pair("concrete_wall_003", 5), ...pair("brick_wall_001", 2),
    loader.loadAsync(`${import.meta.env.BASE_URL}textures/storefront-stone.jpg`),
    loader.loadAsync(`${import.meta.env.BASE_URL}textures/storefront-cafe.jpg`),
  ]);
  storefrontStone.colorSpace = storefrontCafe.colorSpace = SRGBColorSpace;
  storefrontStone.anisotropy = storefrontCafe.anisotropy = 4;
  const textures = [asphalt, asphaltNormal, pavement, pavementNormal, plaster, plasterNormal, concrete, concreteNormal, brick, brickNormal, storefrontStone, storefrontCafe];
  return {
    asphalt, asphaltNormal, pavement, pavementNormal, plaster, plasterNormal, concrete, concreteNormal, brick, brickNormal, storefrontStone, storefrontCafe,
    dispose: () => textures.forEach((texture) => texture.dispose()),
  };
}
