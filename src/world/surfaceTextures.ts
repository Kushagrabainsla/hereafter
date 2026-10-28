import { CanvasTexture, RepeatWrapping, SRGBColorSpace, type Texture } from "three/webgpu";

export interface SurfaceTextures {
  ground: CanvasTexture;
  grass: CanvasTexture;
  asphalt: CanvasTexture;
  pavement: CanvasTexture;
  facade: CanvasTexture;
  roof: CanvasTexture;
  bark: CanvasTexture;
  leaves: CanvasTexture;
  dispose: () => void;
}

function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function makeTexture(size: number, tileMeters: number, paint: (context: CanvasRenderingContext2D, next: () => number) => void, seed: number): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas textures are unavailable");
  paint(context, random(seed));
  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(1 / tileMeters, 1 / tileMeters);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function speckles(context: CanvasRenderingContext2D, next: () => number, count: number, light: string, dark: string): void {
  const size = context.canvas.width;
  for (let index = 0; index < count; index += 1) {
    context.fillStyle = next() > 0.55 ? light : dark;
    const diameter = 0.5 + next() * 2.5;
    context.fillRect(next() * size, next() * size, diameter, diameter);
  }
}

export function createSurfaceTextures(): SurfaceTextures {
  const ground = makeTexture(256, 12, (context, next) => {
    context.fillStyle = "#8c9c88";
    context.fillRect(0, 0, 256, 256);
    speckles(context, next, 4000, "#a8b59a", "#637c72");
    for (let index = 0; index < 550; index += 1) {
      const x = next() * 256;
      const y = next() * 256;
      context.strokeStyle = next() > 0.5 ? "#718e73" : "#b4b59a";
      context.lineWidth = 0.8 + next();
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(x + next() * 3 - 1.5, y - 2 - next() * 5);
      context.stroke();
    }
  }, 11);
  const grass = makeTexture(256, 8, (context, next) => {
    context.fillStyle = "#83a87e";
    context.fillRect(0, 0, 256, 256);
    speckles(context, next, 5000, "#b5c997", "#5b8468");
    for (let index = 0; index < 900; index += 1) {
      const x = next() * 256;
      const y = next() * 256;
      context.strokeStyle = next() > 0.5 ? "#b8d19b" : "#4f7d60";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(x + next() * 4 - 2, y - 3 - next() * 5);
      context.stroke();
    }
  }, 23);
  const asphalt = makeTexture(256, 5, (context, next) => {
    context.fillStyle = "#59636a";
    context.fillRect(0, 0, 256, 256);
    speckles(context, next, 8500, "#859096", "#3d4a52");
    for (let index = 0; index < 22; index += 1) {
      const x = next() * 256;
      const y = next() * 256;
      context.strokeStyle = "#424c53";
      context.lineWidth = 0.7;
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(x + 7 + next() * 18, y + next() * 6 - 3);
      context.stroke();
    }
  }, 37);
  const pavement = makeTexture(256, 3, (context, next) => {
    context.fillStyle = "#c0beb0";
    context.fillRect(0, 0, 256, 256);
    speckles(context, next, 3000, "#d4d1c3", "#9eaa9f");
    context.strokeStyle = "#909d9a";
    context.lineWidth = 2;
    for (let position = 0; position <= 256; position += 64) {
      context.beginPath();
      context.moveTo(position, 0);
      context.lineTo(position, 256);
      context.moveTo(0, position);
      context.lineTo(256, position);
      context.stroke();
    }
  }, 41);
  const facade = makeTexture(256, 4, (context, next) => {
    context.fillStyle = "#e0ded5";
    context.fillRect(0, 0, 256, 256);
    speckles(context, next, 1600, "#f1eee7", "#c0c2bb");
    context.fillStyle = "#b1b9b6";
    context.fillRect(0, 0, 256, 8);
    context.fillRect(0, 244, 256, 12);
    context.fillStyle = "#697e86";
    context.fillRect(45, 43, 166, 152);
    context.fillStyle = "#354e5d";
    context.fillRect(53, 51, 150, 136);
    context.fillStyle = "#78959d";
    context.fillRect(62, 57, 52, 121);
    context.fillStyle = "#a5bac0";
    context.fillRect(68, 62, 11, 110);
    context.fillStyle = "#c5c8bf";
    context.fillRect(124, 43, 8, 152);
    context.fillRect(45, 113, 166, 7);
    context.fillStyle = "#b9bdb5";
    context.fillRect(35, 196, 186, 7);
  }, 53);
  facade.repeat.set(1 / 4, 1 / 3.2);
  const roof = makeTexture(256, 7, (context, next) => {
    context.fillStyle = "#7f8d8c";
    context.fillRect(0, 0, 256, 256);
    speckles(context, next, 3600, "#a2acab", "#5d7177");
    context.strokeStyle = "#687b7e";
    context.lineWidth = 3;
    for (let position = 0; position <= 256; position += 64) {
      context.beginPath();
      context.moveTo(position, 0);
      context.lineTo(position, 256);
      context.moveTo(0, position);
      context.lineTo(256, position);
      context.stroke();
    }
  }, 67);
  const bark = makeTexture(128, 2, (context, next) => {
    context.fillStyle = "#8b6b50";
    context.fillRect(0, 0, 128, 128);
    for (let index = 0; index < 130; index += 1) {
      const x = next() * 128;
      const y = next() * 128;
      context.strokeStyle = next() > 0.5 ? "#ad8967" : "#5d493a";
      context.lineWidth = 1 + next() * 3;
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(x + next() * 4 - 2, y + 8 + next() * 20);
      context.stroke();
    }
  }, 71);
  const leaves = makeTexture(128, 3, (context, next) => {
    context.fillStyle = "#8ca67b";
    context.fillRect(0, 0, 128, 128);
    for (let index = 0; index < 1000; index += 1) {
      context.fillStyle = ["#648e6c", "#b9c794", "#719783", "#9fb78a"][Math.floor(next() * 4)];
      context.beginPath();
      context.ellipse(next() * 128, next() * 128, 1 + next() * 4, 1 + next() * 2, next() * Math.PI, 0, Math.PI * 2);
      context.fill();
    }
  }, 83);
  const textures: Texture[] = [ground, grass, asphalt, pavement, facade, roof, bark, leaves];
  return { ground, grass, asphalt, pavement, facade, roof, bark, leaves, dispose: () => textures.forEach((texture) => texture.dispose()) };
}
