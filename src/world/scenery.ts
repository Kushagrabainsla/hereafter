import {
  BoxGeometry, CanvasTexture, Color, CylinderGeometry, DoubleSide, Group, InstancedMesh,
  MeshBasicMaterial, MeshStandardMaterial, Object3D, PlaneGeometry, Scene, SphereGeometry,
  SRGBColorSpace, type Texture,
} from "three/webgpu";
import { terrainHeight, toLocal, type Arena, type ArenaData, type Point } from "./arena";
import { CollisionWorld } from "./collision";

export interface WindowPosition {
  east: number;
  north: number;
  height: number;
  yaw: number;
  tint: number;
  sill: boolean;
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

function distanceToRoad(east: number, north: number, data: ArenaData): number {
  let nearest = Infinity;
  for (const road of data.roads) {
    if (road.width < 8) continue;
    const [a, b] = road.points;
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const lengthSquared = dx * dx + dz * dz;
    const t = lengthSquared ? Math.max(0, Math.min(1, ((east - a[0]) * dx + (north - a[1]) * dz) / lengthSquared)) : 0;
    nearest = Math.min(nearest, Math.hypot(east - a[0] - t * dx, north - a[1] - t * dz) - road.width / 2);
  }
  return nearest;
}

export function addStorefronts(scene: Scene, data: ArenaData, arena: Arena, textures: [Texture, Texture]): Map<number, Set<number>> {
  const selected = new Map<number, Set<number>>();
  const [centerEast, centerNorth] = toLocal(arena.latitude, arena.longitude);
  const entries: { east: number; north: number; ground: number; yaw: number; style: number }[] = [];
  for (const building of data.buildings) {
    if (building.outline.length < 3 || building.height < 5) continue;
    const [buildingEast, buildingNorth] = building.outline.reduce(([x, z], point) =>
      [x + point[0] / building.outline.length, z + point[1] / building.outline.length], [0, 0]);
    if (Math.abs(buildingEast - centerEast) > arena.sizeMeters / 2 + 10
      || Math.abs(buildingNorth - centerNorth) > arena.sizeMeters / 2 + 10) continue;
    const side = polygonArea(building.outline) > 0 ? 1 : -1;
    const facades: { edge: number; a: Point; b: Point; normalEast: number; normalNorth: number; distance: number; length: number }[] = [];
    for (let edge = 0; edge < building.outline.length; edge += 1) {
      const a = building.outline[edge];
      const b = building.outline[(edge + 1) % building.outline.length];
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const length = Math.hypot(dx, dz);
      if (length < 5) continue;
      const normalEast = side * dz / length;
      const normalNorth = -side * dx / length;
      const east = (a[0] + b[0]) / 2;
      const north = (a[1] + b[1]) / 2;
      const distance = distanceToRoad(east + normalEast * 2, north + normalNorth * 2, data);
      if (distance < 12) facades.push({ edge, a, b, normalEast, normalNorth, distance, length });
    }
    for (const facade of facades.sort((a, b) => a.distance - b.distance).slice(0, 2)) {
      selected.set(building.id, (selected.get(building.id) ?? new Set<number>()).add(facade.edge));
      const count = Math.min(6, Math.max(1, Math.floor(facade.length / 7)));
      for (let panel = 0; panel < count; panel += 1) {
        const t = (panel + 0.5) / count;
        entries.push({
          east: facade.a[0] + (facade.b[0] - facade.a[0]) * t + facade.normalEast * 0.075,
          north: facade.a[1] + (facade.b[1] - facade.a[1]) * t + facade.normalNorth * 0.075,
          ground: terrainHeight(data, buildingEast, buildingNorth),
          yaw: Math.atan2(facade.normalEast, facade.normalNorth),
          style: (building.id + panel + facade.edge) % 2,
        });
      }
    }
  }
  const transform = new Object3D();
  for (let style = 0; style < 2; style += 1) {
    const facades = entries.filter((entry) => entry.style === style);
    if (!facades.length) continue;
    const mesh = new InstancedMesh(
      new PlaneGeometry(4.2, 3),
      new MeshStandardMaterial({ map: textures[style], emissiveMap: textures[style], emissive: 0xffffff, emissiveIntensity: 0.12, roughness: 0.5, metalness: 0.08, side: DoubleSide }),
      facades.length,
    );
    facades.forEach(({ east, north, ground, yaw }, index) => {
      transform.position.set(east, ground + 1.5, north);
      transform.rotation.set(0, yaw, 0);
      transform.scale.set(1, 1, 1);
      transform.updateMatrix();
      mesh.setMatrixAt(index, transform.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    scene.add(mesh);
  }
  return selected;
}

export function addFacadeTrim(scene: Scene, data: ArenaData, arena: Arena): void {
  const [centerEast, centerNorth] = toLocal(arena.latitude, arena.longitude);
  const entries: { east: number; north: number; height: number; length: number; yaw: number; color: number }[] = [];
  for (const building of data.buildings) {
    if (building.outline.length < 3 || building.height < 5) continue;
    const [centerX, centerZ] = building.outline.reduce(([x, z], point) =>
      [x + point[0] / building.outline.length, z + point[1] / building.outline.length], [0, 0]);
    if (Math.abs(centerX - centerEast) > arena.sizeMeters / 2 + 20
      || Math.abs(centerZ - centerNorth) > arena.sizeMeters / 2 + 20) continue;
    const ground = terrainHeight(data, centerX, centerZ);
    const side = polygonArea(building.outline) > 0 ? 1 : -1;
    for (let edge = 0; edge < building.outline.length; edge += 1) {
      const a = building.outline[edge];
      const b = building.outline[(edge + 1) % building.outline.length];
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const length = Math.hypot(dx, dz);
      if (length < 2) continue;
      const east = (a[0] + b[0]) / 2 + side * dz / length * 0.09;
      const north = (a[1] + b[1]) / 2 - side * dx / length * 0.09;
      const yaw = Math.atan2(dx, dz);
      const color = [0xc8c4b8, 0x77736d, 0xaaa9a1][building.id % 3];
      entries.push({ east, north, height: ground + building.height - 0.22, length, yaw, color });
      if (building.id % 3 !== 0) entries.push({ east, north, height: ground + 3.05, length, yaw, color });
    }
  }
  if (!entries.length) return;
  const mesh = new InstancedMesh(new BoxGeometry(0.16, 0.13, 1), new MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 }), entries.length);
  const transform = new Object3D();
  entries.forEach(({ east, north, height, length, yaw, color }, index) => {
    transform.position.set(east, height, north);
    transform.rotation.set(0, yaw, 0);
    transform.scale.set(1, 1, length);
    transform.updateMatrix();
    mesh.setMatrixAt(index, transform.matrix);
    mesh.setColorAt(index, new Color(color));
  });
  mesh.instanceMatrix.needsUpdate = true;
  scene.add(mesh);
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

// Instances that draw one world entity, so it can be hidden or changed when it breaks.
export interface InstanceRef { mesh: InstancedMesh; index: number }

export function windowPlacements(data: ArenaData, arena: Arena, storefrontEdges: Map<number, Set<number>>): WindowPosition[] {
  const maxWindows = 8000;
  const windows: WindowPosition[] = [];
  const [arenaEast, arenaNorth] = toLocal(arena.latitude, arena.longitude);
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
          if (floor === 0 && storefrontEdges.get(building.id)?.has(edge)) continue;
          const tint = (building.id * 13 + edge * 17 + floor * 7 + column * 11) % 13;
          windows.push({
            east: ax + dx * along + normalEast * 0.055,
            north: az + dz * along + normalNorth * 0.055,
            height,
            yaw,
            tint,
            sill: floor < 2 && Math.abs(ax + dx * along - arenaEast) < arena.sizeMeters / 2 + 15
              && Math.abs(az + dz * along - arenaNorth) < arena.sizeMeters / 2 + 15,
          });
          if (windows.length >= maxWindows) break;
        }
        if (windows.length >= maxWindows) break;
      }
      if (windows.length >= maxWindows) break;
    }
  }
  return windows;
}

export function addBuildingWindows(scene: Scene, windows: WindowPosition[]): { texture: CanvasTexture; glass: Map<string, InstanceRef[]> } {
  const glassTexture = windowTexture();
  const refs = new Map<string, InstanceRef[]>();
  if (windows.length === 0) return { texture: glassTexture, glass: refs };
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
  const sills = new InstancedMesh(
    new BoxGeometry(1.62, 0.09, 0.18),
    new MeshStandardMaterial({ color: 0xd4d0c6, roughness: 0.9 }),
    windows.filter((window) => window.sill).length,
  );
  const transform = new Object3D();
  const tints = [0xffffff, 0xe5eef4, 0xc7dee4, 0xa7c8d4, 0xf4e6bf];
  let sillIndex = 0;
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
    refs.set(`window:${index}`, [{ mesh: glass, index }]);
    if (window.sill) {
      transform.position.set(window.east + Math.sin(window.yaw) * 0.11, window.height - 0.98, window.north + Math.cos(window.yaw) * 0.11);
      transform.updateMatrix();
      sills.setMatrixAt(sillIndex++, transform.matrix);
    }
  });
  frame.instanceMatrix.needsUpdate = true;
  glass.instanceMatrix.needsUpdate = true;
  sills.instanceMatrix.needsUpdate = true;
  if (glass.instanceColor) glass.instanceColor.needsUpdate = true;
  scene.add(frame, glass, sills);
  return { texture: glassTexture, glass: refs };
}

export function addBuildingDoors(scene: Scene, data: ArenaData, arena: Arena, storefrontEdges: Map<number, Set<number>>): void {
  const entries: { east: number; north: number; ground: number; yaw: number; id: number }[] = [];
  const [arenaEast, arenaNorth] = toLocal(arena.latitude, arena.longitude);
  for (const building of data.buildings) {
    if (storefrontEdges.has(building.id)) continue;
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
    entries.push({ east, north, ground, yaw: Math.atan2(normalEast, normalNorth), id: building.id });
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
  const awnings = entries.filter(({ east, north, id }) => id % 3 !== 0
    && Math.abs(east - arenaEast) < arena.sizeMeters / 2 + 10
    && Math.abs(north - arenaNorth) < arena.sizeMeters / 2 + 10);
  if (awnings.length === 0) return;
  const fabric = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.83, side: DoubleSide });
  const canopy = new InstancedMesh(new BoxGeometry(2.05, 0.09, 1.0), fabric, awnings.length);
  const valance = new InstancedMesh(new BoxGeometry(2.05, 0.25, 0.055), fabric, awnings.length);
  const colors = [0x805648, 0x556c66, 0xb59e77, 0x526a80];
  awnings.forEach(({ east, north, ground, yaw, id }, index) => {
    const facingEast = Math.sin(yaw);
    const facingNorth = Math.cos(yaw);
    transform.rotation.set(0, yaw, 0);
    transform.position.set(east + facingEast * 0.46, ground + 2.53, north + facingNorth * 0.46);
    transform.updateMatrix();
    canopy.setMatrixAt(index, transform.matrix);
    transform.position.set(east + facingEast * 0.94, ground + 2.39, north + facingNorth * 0.94);
    transform.updateMatrix();
    valance.setMatrixAt(index, transform.matrix);
    canopy.setColorAt(index, new Color(colors[id % colors.length]));
    valance.setColorAt(index, new Color(colors[id % colors.length]));
  });
  canopy.instanceMatrix.needsUpdate = true;
  valance.instanceMatrix.needsUpdate = true;
  canopy.castShadow = true;
  scene.add(canopy, valance);
}

export function makeRoadDetails(data: ArenaData, arena: Arena): Group {
  const group = new Group();
  const [centerEast, centerNorth] = toLocal(arena.latitude, arena.longitude);
  const half = arena.sizeMeters / 2 - 5;
  const manholes: { east: number; north: number; yaw: number }[] = [];
  const drains: { east: number; north: number; yaw: number }[] = [];
  for (const road of data.roads) {
    if (road.width < 8) continue;
    const [a, b] = road.points;
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const length = Math.hypot(dx, dz);
    if (length < 15) continue;
    const east = (a[0] + b[0]) / 2;
    const north = (a[1] + b[1]) / 2;
    if (Math.abs(east - centerEast) > half || Math.abs(north - centerNorth) > half) continue;
    const yaw = Math.atan2(dx, dz);
    if (manholes.every((entry) => Math.hypot(entry.east - east, entry.north - north) > 16)) {
      manholes.push({ east, north, yaw });
    }
    for (const side of [-1, 1]) {
      const drainEast = east - side * dz / length * (road.width / 2 - 0.34);
      const drainNorth = north + side * dx / length * (road.width / 2 - 0.34);
      if (drains.every((entry) => Math.hypot(entry.east - drainEast, entry.north - drainNorth) > 10)) {
        drains.push({ east: drainEast, north: drainNorth, yaw });
      }
    }
  }
  const transform = new Object3D();
  if (manholes.length) {
    const outer = new InstancedMesh(new CylinderGeometry(0.49, 0.49, 0.012, 20), new MeshStandardMaterial({ color: 0x343d3d, roughness: 0.7, metalness: 0.55 }), manholes.length);
    const inner = new InstancedMesh(new CylinderGeometry(0.4, 0.4, 0.014, 20), new MeshStandardMaterial({ color: 0x626864, roughness: 0.82, metalness: 0.4 }), manholes.length);
    const bar = new InstancedMesh(new BoxGeometry(0.56, 0.008, 0.035), new MeshStandardMaterial({ color: 0x303938, roughness: 0.7, metalness: 0.5 }), manholes.length * 2);
    manholes.forEach(({ east, north, yaw }, index) => {
      const ground = terrainHeight(data, east, north) + 0.16;
      transform.position.set(east, ground, north);
      transform.rotation.set(0, yaw, 0);
      transform.updateMatrix();
      outer.setMatrixAt(index, transform.matrix);
      transform.position.y += 0.014;
      transform.updateMatrix();
      inner.setMatrixAt(index, transform.matrix);
      for (let groove = 0; groove < 2; groove += 1) {
        const offset = groove ? 0.13 : -0.13;
        transform.position.set(east + Math.sin(yaw) * offset, ground + 0.026, north + Math.cos(yaw) * offset);
        transform.updateMatrix();
        bar.setMatrixAt(index * 2 + groove, transform.matrix);
      }
    });
    group.add(outer, inner, bar);
  }
  if (drains.length) {
    const housing = new InstancedMesh(new BoxGeometry(0.78, 0.016, 0.43), new MeshStandardMaterial({ color: 0x293434, roughness: 0.8, metalness: 0.4 }), drains.length);
    const slats = new InstancedMesh(new BoxGeometry(0.48, 0.008, 0.036), new MeshStandardMaterial({ color: 0x6d7470, roughness: 0.7, metalness: 0.55 }), drains.length * 4);
    drains.forEach(({ east, north, yaw }, index) => {
      const ground = terrainHeight(data, east, north) + 0.153;
      transform.rotation.set(0, yaw, 0);
      transform.position.set(east, ground, north);
      transform.updateMatrix();
      housing.setMatrixAt(index, transform.matrix);
      for (let slat = 0; slat < 4; slat += 1) {
        const offset = (slat - 1.5) * 0.11;
        transform.position.set(east + Math.sin(yaw) * offset, ground + 0.014, north + Math.cos(yaw) * offset);
        transform.updateMatrix();
        slats.setMatrixAt(index * 4 + slat, transform.matrix);
      }
    });
    group.add(housing, slats);
  }
  return group;
}

export function makeStreetFurniture(data: ArenaData, arena: Arena, refs = new Map<string, InstanceRef[]>()): Group {
  const group = new Group();
  const [centerEast, centerNorth] = toLocal(arena.latitude, arena.longitude);
  const half = arena.sizeMeters / 2 - 2;
  const positions = new CollisionWorld(data).furniture.map((item, entity) => ({ ...item, entity })).filter(({ east, north }) =>
    Math.abs(east - centerEast) < half && Math.abs(north - centerNorth) < half);
  const planters = positions.filter((item) => item.kind === "planter");
  const hydrants = positions.filter((item) => item.kind === "hydrant");
  const transform = new Object3D();
  if (planters.length) {
    const pots = new InstancedMesh(new BoxGeometry(1.06, 0.55, 1.06), new MeshStandardMaterial({ color: 0x777b75, roughness: 0.95 }), planters.length);
    const rims = new InstancedMesh(new BoxGeometry(1.13, 0.08, 1.13), new MeshStandardMaterial({ color: 0xa3a39a, roughness: 0.9 }), planters.length);
    const soil = new InstancedMesh(new BoxGeometry(0.9, 0.025, 0.9), new MeshStandardMaterial({ color: 0x493b2d, roughness: 1 }), planters.length);
    const shrubs = new InstancedMesh(new SphereGeometry(0.49, 9, 7), new MeshStandardMaterial({ color: 0x65815a, roughness: 1 }), planters.length * 3);
    planters.forEach(({ east, north, entity }, index) => {
      refs.set(`furniture:${entity}`, [{ mesh: pots, index }, { mesh: rims, index }, { mesh: soil, index }, ...[0, 1, 2].map((leaf) => ({ mesh: shrubs, index: index * 3 + leaf }))]);
      const ground = terrainHeight(data, east, north);
      transform.rotation.set(0, 0, 0);
      transform.scale.set(1, 1, 1);
      transform.position.set(east, ground + 0.29, north);
      transform.updateMatrix();
      pots.setMatrixAt(index, transform.matrix);
      transform.position.y = ground + 0.55;
      transform.updateMatrix();
      rims.setMatrixAt(index, transform.matrix);
      transform.position.y = ground + 0.59;
      transform.updateMatrix();
      soil.setMatrixAt(index, transform.matrix);
      for (let leaf = 0; leaf < 3; leaf += 1) {
        const angle = index * 1.7 + leaf * Math.PI * 2 / 3;
        transform.position.set(east + Math.cos(angle) * 0.24, ground + 0.87 + (leaf % 2) * 0.14, north + Math.sin(angle) * 0.24);
        transform.scale.set(0.85, 0.78 + (leaf % 2) * 0.24, 0.85);
        transform.updateMatrix();
        shrubs.setMatrixAt(index * 3 + leaf, transform.matrix);
        shrubs.setColorAt(index * 3 + leaf, new Color([0x567452, 0x769169, 0x4e6c4a][(index + leaf) % 3]));
      }
    });
    pots.castShadow = true;
    shrubs.castShadow = true;
    group.add(pots, rims, soil, shrubs);
  }
  if (hydrants.length) {
    const red = new MeshStandardMaterial({ color: 0xb64134, roughness: 0.56, metalness: 0.22 });
    const dark = new MeshStandardMaterial({ color: 0x6c332c, roughness: 0.65, metalness: 0.35 });
    const bodies = new InstancedMesh(new CylinderGeometry(0.19, 0.25, 0.62, 10), red, hydrants.length);
    const caps = new InstancedMesh(new CylinderGeometry(0.22, 0.22, 0.11, 10), dark, hydrants.length);
    const nozzles = new InstancedMesh(new CylinderGeometry(0.12, 0.12, 0.62, 8), red, hydrants.length);
    hydrants.forEach(({ east, north }, index) => {
      const ground = terrainHeight(data, east, north);
      transform.scale.set(1, 1, 1);
      transform.rotation.set(0, 0, 0);
      transform.position.set(east, ground + 0.32, north);
      transform.updateMatrix();
      bodies.setMatrixAt(index, transform.matrix);
      transform.position.y = ground + 0.66;
      transform.updateMatrix();
      caps.setMatrixAt(index, transform.matrix);
      transform.rotation.set(0, 0, Math.PI / 2);
      transform.position.y = ground + 0.43;
      transform.updateMatrix();
      nozzles.setMatrixAt(index, transform.matrix);
    });
    bodies.castShadow = true;
    group.add(bodies, caps, nozzles);
  }
  return group;
}

export function streetLightPlacements(data: ArenaData): { east: number; north: number; towardEast: number; towardNorth: number }[] {
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
    // Street furniture sits at segment midpoints, so a light tries points either side too.
    for (const along of [0.5, 0.3, 0.7]) {
      const east = a[0] + dx * along + normalEast * (road.width / 2 + 1.1);
      const north = a[1] + dz * along + normalNorth * (road.width / 2 + 1.1);
      if (collision.blocked(east, north, 0.6) || positions.some((position) => Math.hypot(position.east - east, position.north - north) < 21)) continue;
      positions.push({ east, north, towardEast: -normalEast, towardNorth: -normalNorth });
      break;
    }
  }
  return positions;
}

export function addStreetLights(scene: Scene, data: ArenaData, positions: ReturnType<typeof streetLightPlacements>): Map<string, InstanceRef[]> {
  const refs = new Map<string, InstanceRef[]>();
  if (positions.length === 0) return refs;
  const metal = new MeshStandardMaterial({ color: 0x3c4848, roughness: 0.5, metalness: 0.8 });
  const light = new MeshBasicMaterial({ color: 0xffffff });
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
    heads.setColorAt(index, new Color(0xffe3aa));
    refs.set(`lamp:${index}`, [{ mesh: heads, index }]);
  });
  poles.castShadow = true;
  scene.add(poles, arms, heads);
  return refs;
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
