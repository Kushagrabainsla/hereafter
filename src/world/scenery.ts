import {
  BoxGeometry, CanvasTexture, Color, CylinderGeometry, DoubleSide, InstancedMesh,
  MeshBasicMaterial, MeshStandardMaterial, Object3D, PlaneGeometry, Scene,
  SRGBColorSpace,
} from "three/webgpu";
import { terrainHeight, type ArenaData, type Point } from "./arena";
import { CollisionWorld } from "./collision";

interface WindowPosition {
  east: number;
  north: number;
  height: number;
  yaw: number;
  tint: number;
}

function polygonArea(outline: Point[]): number {
  let area = 0;
  for (let index = 0; index < outline.length; index += 1) {
    const a = outline[index];
    const b = outline[(index + 1) % outline.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  return area / 2;
}

function windowTexture(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas textures are unavailable");
  const gradient = context.createLinearGradient(0, 0, 128, 128);
  gradient.addColorStop(0, "#8ca8b1");
  gradient.addColorStop(0.45, "#355566");
  gradient.addColorStop(1, "#1f3542");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  context.fillStyle = "rgba(217, 236, 235, 0.26)";
  context.beginPath();
  context.moveTo(12, 0);
  context.lineTo(50, 0);
  context.lineTo(10, 128);
  context.lineTo(0, 128);
  context.fill();
  context.fillStyle = "rgba(230, 237, 228, 0.13)";
  context.fillRect(0, 83, 128, 5);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

export function addBuildingWindows(scene: Scene, data: ArenaData): CanvasTexture {
  const maxWindows = 8000;
  const windows: WindowPosition[] = [];
  const buildings = [...data.buildings].sort((a, b) => {
    const distance = (building: typeof a): number => {
      const [east, north] = building.outline[0];
      return east * east + north * north;
    };
    return distance(a) - distance(b);
  });
  for (const building of buildings) {
    if (windows.length >= maxWindows || building.outline.length < 3) break;
    const outline = building.outline;
    const side = polygonArea(outline) > 0 ? 1 : -1;
    const center = outline.reduce(([sumEast, sumNorth], [east, north]) => [sumEast + east, sumNorth + north], [0, 0]);
    const centerEast = center[0] / outline.length;
    const centerNorth = center[1] / outline.length;
    const distance = Math.hypot(centerEast, centerNorth);
    const step = distance < 140 ? 1 : distance < 230 ? 2 : 3;
    const ground = terrainHeight(data, centerEast, centerNorth);
    const floors = Math.floor((building.height - 0.7) / 3.15);
    for (let edge = 0; edge < outline.length; edge += 1) {
      const [ax, az] = outline[edge];
      const [bx, bz] = outline[(edge + 1) % outline.length];
      const dx = bx - ax;
      const dz = bz - az;
      const length = Math.hypot(dx, dz);
      const columns = Math.min(14, Math.floor((length - 1.1) / (2.7 * step)));
      if (columns < 1) continue;
      const normalEast = side * dz / length;
      const normalNorth = -side * dx / length;
      const yaw = Math.atan2(normalEast, normalNorth);
      for (let floor = 0; floor < floors; floor += step) {
        const height = ground + 1.75 + floor * 3.15;
        if (height + 0.9 > ground + building.height) break;
        for (let column = 0; column < columns; column += 1) {
          const along = (column + 0.5) / columns;
          const tint = (building.id * 13 + edge * 17 + floor * 7 + column * 11) % 13;
          windows.push({
            east: ax + dx * along + normalEast * 0.055,
            north: az + dz * along + normalNorth * 0.055,
            height,
            yaw,
            tint,
          });
          if (windows.length >= maxWindows) break;
        }
        if (windows.length >= maxWindows) break;
      }
      if (windows.length >= maxWindows) break;
    }
  }
  const glassTexture = windowTexture();
  if (windows.length === 0) return glassTexture;
  const frame = new InstancedMesh(
    new PlaneGeometry(1.56, 1.94),
    new MeshStandardMaterial({ color: 0x2c383c, roughness: 0.75, metalness: 0.35, side: DoubleSide }),
    windows.length,
  );
  const glass = new InstancedMesh(
    new PlaneGeometry(1.38, 1.76),
    new MeshStandardMaterial({ map: glassTexture, roughness: 0.2, metalness: 0.25, emissive: 0x10202a, emissiveIntensity: 0.18, side: DoubleSide }),
    windows.length,
  );
  frame.userData.windowDetail = true;
  glass.userData.windowDetail = true;
  const transform = new Object3D();
  const tints = [0xffffff, 0xe5eef4, 0xc7dee4, 0xa7c8d4, 0xf4e6bf];
  windows.forEach((window, index) => {
    transform.position.set(window.east, window.height, window.north);
    transform.rotation.set(0, window.yaw, 0);
    transform.updateMatrix();
    frame.setMatrixAt(index, transform.matrix);
    transform.position.x += Math.sin(window.yaw) * 0.015;
    transform.position.z += Math.cos(window.yaw) * 0.015;
    transform.updateMatrix();
    glass.setMatrixAt(index, transform.matrix);
    glass.setColorAt(index, new Color(tints[window.tint < 2 ? 4 : window.tint % 4]));
  });
  frame.instanceMatrix.needsUpdate = true;
  glass.instanceMatrix.needsUpdate = true;
  if (glass.instanceColor) glass.instanceColor.needsUpdate = true;
  scene.add(frame, glass);
  return glassTexture;
}

export function addBuildingDoors(scene: Scene, data: ArenaData): void {
  const entries: { east: number; north: number; ground: number; yaw: number }[] = [];
  for (const building of data.buildings) {
    if (building.outline.length < 3 || building.height < 3.4) continue;
    const outline = building.outline;
    const side = polygonArea(outline) > 0 ? 1 : -1;
    let best: { a: Point; b: Point; length: number } | null = null;
    for (let index = 0; index < outline.length; index += 1) {
      const a = outline[index];
      const b = outline[(index + 1) % outline.length];
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (length >= 3.2 && (!best || length > best.length)) best = { a, b, length };
    }
    if (!best) continue;
    const normalEast = side * (best.b[1] - best.a[1]) / best.length;
    const normalNorth = -side * (best.b[0] - best.a[0]) / best.length;
    const east = (best.a[0] + best.b[0]) / 2 + normalEast * 0.08;
    const north = (best.a[1] + best.b[1]) / 2 + normalNorth * 0.08;
    const center = outline.reduce(([sumEast, sumNorth], [x, z]) => [sumEast + x, sumNorth + z], [0, 0]);
    const ground = terrainHeight(data, center[0] / outline.length, center[1] / outline.length);
    entries.push({ east, north, ground, yaw: Math.atan2(normalEast, normalNorth) });
  }
  if (entries.length === 0) return;
  const frame = new InstancedMesh(new PlaneGeometry(1.75, 2.55), new MeshStandardMaterial({ color: 0x383e3e, roughness: 0.75, side: DoubleSide }), entries.length);
  const panel = new InstancedMesh(new PlaneGeometry(1.48, 2.35), new MeshStandardMaterial({ color: 0x59615f, roughness: 0.6, metalness: 0.18, side: DoubleSide }), entries.length);
  const glass = new InstancedMesh(new PlaneGeometry(0.9, 0.75), new MeshStandardMaterial({ color: 0x365564, roughness: 0.24, metalness: 0.35, side: DoubleSide }), entries.length);
  const transform = new Object3D();
  entries.forEach(({ east, north, ground, yaw }, index) => {
    transform.rotation.set(0, yaw, 0);
    transform.position.set(east, ground + 1.27, north);
    transform.updateMatrix();
    frame.setMatrixAt(index, transform.matrix);
    transform.position.set(east + Math.sin(yaw) * 0.012, ground + 1.27, north + Math.cos(yaw) * 0.012);
    transform.updateMatrix();
    panel.setMatrixAt(index, transform.matrix);
    transform.position.set(east + Math.sin(yaw) * 0.025, ground + 1.75, north + Math.cos(yaw) * 0.025);
    transform.updateMatrix();
    glass.setMatrixAt(index, transform.matrix);
  });
  scene.add(frame, panel, glass);
}

export function addStreetLights(scene: Scene, data: ArenaData): void {
  const collision = new CollisionWorld(data);
  const positions: { east: number; north: number; towardEast: number; towardNorth: number }[] = [];
  const roads = [...data.roads].filter((road) => road.width >= 8).sort((a, b) => {
    const distance = (road: typeof a): number => {
      const [east, north] = road.points[0];
      return east * east + north * north;
    };
    return distance(a) - distance(b);
  });
  for (const road of roads) {
    if (positions.length >= 90) break;
    const [a, b] = road.points;
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const length = Math.hypot(dx, dz);
    if (length < 16) continue;
    const side = road.id % 2 === 0 ? 1 : -1;
    const normalEast = side * -dz / length;
    const normalNorth = side * dx / length;
    const east = (a[0] + b[0]) / 2 + normalEast * (road.width / 2 + 1.1);
    const north = (a[1] + b[1]) / 2 + normalNorth * (road.width / 2 + 1.1);
    if (collision.blocked(east, north, 0.6) || positions.some((position) => Math.hypot(position.east - east, position.north - north) < 21)) continue;
    positions.push({ east, north, towardEast: -normalEast, towardNorth: -normalNorth });
  }
  if (positions.length === 0) return;
  const metal = new MeshStandardMaterial({ color: 0x3c4848, roughness: 0.5, metalness: 0.8 });
  const light = new MeshBasicMaterial({ color: 0xffe3aa });
  const poles = new InstancedMesh(new CylinderGeometry(0.065, 0.11, 6.3, 7), metal, positions.length);
  const arms = new InstancedMesh(new BoxGeometry(1.05, 0.075, 0.09), metal, positions.length);
  const heads = new InstancedMesh(new BoxGeometry(0.42, 0.07, 0.25), light, positions.length);
  const transform = new Object3D();
  positions.forEach((position, index) => {
    const ground = terrainHeight(data, position.east, position.north);
    transform.position.set(position.east, ground + 3.15, position.north);
    transform.rotation.set(0, 0, 0);
    transform.updateMatrix();
    poles.setMatrixAt(index, transform.matrix);
    const yaw = Math.atan2(position.towardNorth, position.towardEast);
    transform.position.set(position.east + position.towardEast * 0.52, ground + 6.24, position.north + position.towardNorth * 0.52);
    transform.rotation.set(0, -yaw, 0);
    transform.updateMatrix();
    arms.setMatrixAt(index, transform.matrix);
    transform.position.set(position.east + position.towardEast * 1.05, ground + 6.18, position.north + position.towardNorth * 1.05);
    transform.updateMatrix();
    heads.setMatrixAt(index, transform.matrix);
  });
  poles.castShadow = true;
  scene.add(poles, arms, heads);
}

export function createSkyTexture(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 512;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas textures are unavailable");
  const gradient = context.createLinearGradient(0, 0, 0, 512);
  gradient.addColorStop(0, "#74a7ca");
  gradient.addColorStop(0.55, "#a9c9d7");
  gradient.addColorStop(0.88, "#d9ded5");
  gradient.addColorStop(1, "#e5d9c2");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 512, 512);
  context.save();
  context.filter = "blur(17px)";
  context.fillStyle = "rgba(255, 255, 255, 0.19)";
  for (const [x, y, width, height] of [[76, 95, 125, 18], [319, 142, 176, 20], [461, 64, 96, 14], [206, 211, 112, 13]]) {
    context.beginPath();
    context.ellipse(x, y, width, height, 0, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}
