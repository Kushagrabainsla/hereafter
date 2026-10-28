import { CanvasTexture, RepeatWrapping, SRGBColorSpace, TextureLoader, type Texture } from "three/webgpu";

export interface SurfaceTextures {
  ground: Texture;
  grass: Texture;
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
  roof: Texture;
  bark: Texture;
  canopy: Texture;
  leaves: Texture;
  leavesAlpha: Texture;
  dispose: () => void;
}

function foliageTexture(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas textures are unavailable");
  context.fillStyle = "#93af79";
  context.fillRect(0, 0, 256, 256);
  let seed = 83;
  const next = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  for (let index = 0; index < 4000; index += 1) {
    context.fillStyle = ["#668b5e", "#bfd09b", "#7d9d70", "#d2d8aa"][Math.floor(next() * 4)];
    context.beginPath();
    context.ellipse(next() * 256, next() * 256, 1 + next() * 5, 1 + next() * 3, next() * Math.PI, 0, Math.PI * 2);
    context.fill();
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = texture.wrapT = RepeatWrapping;
  return texture;
}

export async function loadSurfaceTextures(): Promise<SurfaceTextures> {
  const loader = new TextureLoader();
  const color = async (name: string, tileMeters: number): Promise<Texture> => {
    const texture = await loader.loadAsync(`${import.meta.env.BASE_URL}textures/${name}_diff.jpg`);
    texture.colorSpace = SRGBColorSpace;
    texture.wrapS = texture.wrapT = RepeatWrapping;
    texture.repeat.set(1 / tileMeters, 1 / tileMeters);
    texture.anisotropy = 4;
    return texture;
  };
  const normal = async (name: string, tileMeters: number): Promise<Texture> => {
    const texture = await loader.loadAsync(`${import.meta.env.BASE_URL}textures/${name}_normal.jpg`);
    texture.wrapS = texture.wrapT = RepeatWrapping;
    texture.repeat.set(1 / tileMeters, 1 / tileMeters);
    texture.anisotropy = 4;
    return texture;
  };
  const [grass, asphalt, asphaltNormal, pavement, pavementNormal, plaster, plasterNormal, concrete, concreteNormal, brick, brickNormal, roof, bark, leaves, leavesAlpha] = await Promise.all([
    color("grass_ground", 10),
    color("asphalt_01", 5), normal("asphalt_01", 5),
    color("concrete_pavement_02", 4), normal("concrete_pavement_02", 4),
    color("plastered_wall_04", 5), normal("plastered_wall_04", 5),
    color("concrete_wall_003", 5), normal("concrete_wall_003", 5),
    color("brick_wall_001", 2), normal("brick_wall_001", 2),
    color("grey_roof_tiles", 5), color("bark_platanus", 2),
    color("tree_leaves", 1), loader.loadAsync(`${import.meta.env.BASE_URL}textures/tree_leaves_alpha.png`),
  ]);
  const ground = grass.clone();
  ground.needsUpdate = true;
  leaves.repeat.set(0.56, 1);
  leavesAlpha.repeat.set(0.56, 1);
  const canopy = foliageTexture();
  const textures = [ground, grass, asphalt, asphaltNormal, pavement, pavementNormal, plaster, plasterNormal, concrete, concreteNormal, brick, brickNormal, roof, bark, canopy, leaves, leavesAlpha];
  return {
    ground, grass, asphalt, asphaltNormal, pavement, pavementNormal, plaster, plasterNormal,
    concrete, concreteNormal, brick, brickNormal, roof, bark, canopy, leaves, leavesAlpha,
    dispose: () => textures.forEach((texture) => texture.dispose()),
  };
}
