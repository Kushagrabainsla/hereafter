import {
  ACESFilmicToneMapping, BoxGeometry, BufferGeometry, Color, CylinderGeometry, DirectionalLight,
  DoubleSide, EquirectangularReflectionMapping, ExtrudeGeometry, Float32BufferAttribute, FogExp2, Group, HemisphereLight, InstancedMesh,
  LineSegments, Mesh, MeshBasicMaterial, MeshStandardMaterial, PCFSoftShadowMap,
  Object3D, PerspectiveCamera, PlaneGeometry, Quaternion, Scene, Shape, ShapeGeometry, SphereGeometry, Vector2, Vector3,
  DefaultLoadingManager, WebGPURenderer,
} from "three/webgpu";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { RGBELoader } from "three/addons/loaders/RGBELoader.js";
import { PlayerController, type PlayerPose } from "../game/playerController";
import { RemotePlayers } from "../game/remotePlayers";
import { AuthoredViewModel } from "../game/authoredViewModel";
import { PlayerModelLibrary } from "../game/playerModel";
import { ShotEffects } from "../game/shotEffects";
import { type CombatEvent, type CombatWorld } from "../game/matchState";
import { WeaponVisuals } from "../game/weaponVisuals";
import { loadWeaponModels } from "../game/weaponModels";
import { gameAudio } from "../game/gameAudio";
import { SoundStage } from "../game/soundStage";
import { bloomAfterShot, currentBloom, makeWeaponPickups, spreadDegrees, type WeaponKind } from "../game/combatRules";
import { terrainHeight, type Arena, type ArenaData, type Point } from "./arena";
import { loadMapData, mapById, type GameMap } from "./maps";
import { buildNightMarket, duskSky } from "./nightMarket";
import { loadSurfaceTextures, type SurfaceTextures } from "./surfaceTextures";
import { addCover } from "./cover";
import { PhysicsWorld, type ShotRay } from "./physics";
import { addBuildingDoors, addBuildingWindows, addFacadeTrim, addStorefronts, addStreetLights, createSkyTexture, makeRoadDetails, makeStreetFurniture, streetLightPlacements, windowPlacements, type InstanceRef } from "./scenery";
import { buildEntities, EntityRegistry, type WorldEntity } from "./entities";
import { WorldEffects } from "./worldEffects";
import { loadPropModels, placeStreetProps, propEntity, PropViews } from "./props";
import { addRoofAccess, planRoofs, type Ladder, type RoofPlan } from "./rooftops";
import { type PropState } from "../network/peerRoom";

export type MapState = "loading" | "ready" | "error";

export interface MapMetrics {
  fps: number;
  renderer: string;
  drawCalls: number;
  triangles: number;
  pixelRatio: number;
}

export interface MapViewerEvents {
  onStatus: (state: MapState, message: string) => void;
  onMetrics: (metrics: MapMetrics) => void;
  // Current hip-fire spread as a crosshair gap in CSS pixels; melee is true for the knife.
  onAim?: (spreadPixels: number, melee: boolean) => void;
  // Loading progress from 0 to 1, with the step under way when it changes.
  onProgress?: (fraction: number, step?: string) => void;
  // A landing at this speed (m/s), fast enough that it may hurt.
  onHardLanding?: (speed: number) => void;
}

export interface MapViewer {
  arenaData: () => ArenaData;
  setArena: (arena: Arena) => void;
  setPaused: (paused: boolean) => void;
  playerPose: () => PlayerPose;
  clearShot: (ray: ShotRay) => boolean;
  traceShot: (ray: ShotRay) => number;
  showShot: (event: CombatEvent, local: boolean) => void;
  setSpawnSlot: (slot: number) => void;
  respawn: () => void;
  setWeapon: (kind: WeaponKind) => void;
  setTakenPickups: (taken: string[]) => void;
  weaponReady: () => boolean;
  holdSprint: (seconds: number) => void;
  combatWorld: () => CombatWorld;
  setEntityHealth: (health: Record<string, number>) => void;
  playEvent: (event: CombatEvent, selfId: string) => void;
  seenTimes: () => Record<string, number>;
  flinch: (damage: number) => void;
  remoteFlinch: (peerId: string, damage: number) => void;
  remotePosition: (peerId: string) => { x: number; y: number; z: number } | null;
  setLocalDead: (dead: boolean) => void;
  propStates: (all: boolean) => PropState[];
  applyPropStates: (states: PropState[]) => void;
  setAuthority: (authority: boolean) => void;
  resetWorld: () => void;
  quickThrow: () => void;
  playAttack: (weapon: WeaponKind) => void;
  startReload: (weapon: WeaponKind, durationMs: number) => void;
  cancelReload: () => void;
  combatSound: (event: CombatEvent, selfId: string) => void;
  remoteReload: (peerId: string, weapon: WeaponKind) => void;
  setRemotePose: (peerId: string, pose: PlayerPose, sentAt?: number) => void;
  setRemoteHealth: (peerId: string, health: number) => void;
  setRemoteWeapon: (peerId: string, weapon: WeaponKind) => void;
  removeRemotePeer: (peerId: string) => void;
  clearRemotePeers: () => void;
  destroy: () => void;
}

function shapeFromOutline(outline: Point[]): Shape {
  const shape = new Shape();
  outline.forEach(([east, north], index) => {
    if (index === 0) shape.moveTo(east, -north);
    else shape.lineTo(east, -north);
  });
  shape.closePath();
  return shape;
}

function centroid(outline: Point[]): Point {
  const [east, north] = outline.reduce(([sumEast, sumNorth], point) => [sumEast + point[0], sumNorth + point[1]], [0, 0]);
  return [east / outline.length, north / outline.length];
}

function addTerrain(scene: Scene, data: ArenaData, textures: SurfaceTextures): void {
  textures.ground.repeat.set(data.extentMeters * 2 / 12, data.extentMeters * 2 / 12);
  const geometry = new PlaneGeometry(data.extentMeters * 2, data.extentMeters * 2, 42, 42);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.getAttribute("position");
  for (let index = 0; index < position.count; index += 1) {
    position.setY(index, terrainHeight(data, position.getX(index), position.getZ(index)));
  }
  geometry.computeVertexNormals();
  const ground = new Mesh(geometry, new MeshStandardMaterial({ map: textures.ground, roughness: 1, side: DoubleSide }));
  ground.receiveShadow = true;
  scene.add(ground);
}

function addParks(scene: Scene, data: ArenaData, textures: SurfaceTextures): void {
  const material = new MeshStandardMaterial({ map: textures.grass, roughness: 1, side: DoubleSide });
  for (const park of data.parks) {
    if (park.outline.length < 3) continue;
    const geometry = new ShapeGeometry(shapeFromOutline(park.outline));
    geometry.rotateX(-Math.PI / 2);
    const [east, north] = centroid(park.outline);
    geometry.translate(0, terrainHeight(data, east, north) + 0.08, 0);
    const surface = new Mesh(geometry, material);
    surface.receiveShadow = true;
    scene.add(surface);
  }
}

function roadGeometry(data: ArenaData, roads: ArenaData["roads"], walkway: boolean): BufferGeometry {
  const vertices: number[] = [];
  const uvs: number[] = [];
  for (const road of roads) {
    const isWalkway = ["footway", "path", "steps", "pedestrian", "cycleway", "platform"].includes(road.kind);
    if (isWalkway !== walkway) continue;
    const [a, b] = road.points;
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const length = Math.hypot(dx, dz);
    if (length < 0.2) continue;
    const sideEast = -dz / length * road.width / 2;
    const sideNorth = dx / length * road.width / 2;
    const corners: Point[] = [
      [a[0] + sideEast, a[1] + sideNorth], [a[0] - sideEast, a[1] - sideNorth],
      [b[0] + sideEast, b[1] + sideNorth], [b[0] - sideEast, b[1] - sideNorth],
    ];
    const y = walkway ? 0.17 : 0.12;
    const vertex = (index: number): number[] => {
      const [east, north] = corners[index];
      return [east, terrainHeight(data, east, north) + y, north];
    };
    vertices.push(...vertex(0), ...vertex(2), ...vertex(1));
    vertices.push(...vertex(1), ...vertex(2), ...vertex(3));
    const uv = (index: number): Point => corners[index];
    uvs.push(...uv(0), ...uv(2), ...uv(1), ...uv(1), ...uv(2), ...uv(3));
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(vertices, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  return geometry;
}

function addRoads(scene: Scene, data: ArenaData, textures: SurfaceTextures): void {
  const asphaltMaterial = new MeshStandardMaterial({ map: textures.asphalt, normalMap: textures.asphaltNormal, normalScale: new Vector2(0.5, 0.5), roughness: 0.96, side: DoubleSide });
  const pavementMaterial = new MeshStandardMaterial({ map: textures.pavement, normalMap: textures.pavementNormal, normalScale: new Vector2(0.4, 0.4), roughness: 0.94, side: DoubleSide });
  const cells = new Map<string, ArenaData["roads"]>();
  for (const road of data.roads) {
    const [a, b] = road.points;
    const key = `${Math.floor((a[0] + b[0]) / 128)}:${Math.floor((a[1] + b[1]) / 128)}`;
    const cell = cells.get(key) ?? [];
    cell.push(road);
    cells.set(key, cell);
  }
  for (const roads of cells.values()) {
    for (const walkway of [false, true]) {
      const geometry = roadGeometry(data, roads, walkway);
      if (geometry.getAttribute("position").count === 0) { geometry.dispose(); continue; }
      const mesh = new Mesh(geometry, walkway ? pavementMaterial : asphaltMaterial);
      mesh.receiveShadow = true;
      scene.add(mesh);
    }
  }
  const marks: number[] = [];
  for (const road of data.roads) {
    if (road.width < 8) continue;
    const [a, b] = road.points;
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const length = Math.hypot(dx, dz);
    if (length < 8) continue;
    const east = dx / length;
    const north = dz / length;
    for (let distance = 3; distance + 2 < length; distance += 7) {
      const point = (along: number, side: number): number[] => {
        const x = a[0] + east * along - north * side;
        const z = a[1] + north * along + east * side;
        return [x, terrainHeight(data, x, z) + 0.145, z];
      };
      marks.push(...point(distance, -0.07), ...point(distance + 2, -0.07), ...point(distance, 0.07));
      marks.push(...point(distance, 0.07), ...point(distance + 2, -0.07), ...point(distance + 2, 0.07));
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(marks, 3));
  geometry.computeVertexNormals();
  scene.add(new Mesh(geometry, new MeshBasicMaterial({ color: 0xd6d3bc, side: DoubleSide })));
  const endpointCounts = new Map<string, number>();
  const roadKey = ([east, north]: Point): string => `${Math.round(east * 2)}:${Math.round(north * 2)}`;
  for (const road of data.roads) {
    if (road.width < 8) continue;
    for (const point of road.points) {
      const key = roadKey(point);
      endpointCounts.set(key, (endpointCounts.get(key) ?? 0) + 1);
    }
  }
  const crosswalks: number[] = [];
  for (const road of data.roads) {
    if (road.width < 8) continue;
    for (const endpoint of [0, 1]) {
      const origin = road.points[endpoint];
      if ((endpointCounts.get(roadKey(origin)) ?? 0) < 3) continue;
      const other = road.points[1 - endpoint];
      const dx = other[0] - origin[0];
      const dz = other[1] - origin[1];
      const length = Math.hypot(dx, dz);
      if (length < 8) continue;
      const alongEast = dx / length;
      const alongNorth = dz / length;
      const acrossEast = -alongNorth;
      const acrossNorth = alongEast;
      const centerEast = origin[0] + alongEast * 4.2;
      const centerNorth = origin[1] + alongNorth * 4.2;
      const vertex = (along: number, across: number): number[] => {
        const east = centerEast + alongEast * along + acrossEast * across;
        const north = centerNorth + alongNorth * along + acrossNorth * across;
        return [east, terrainHeight(data, east, north) + 0.16, north];
      };
      for (let across = -road.width / 2 + 1; across + 0.55 < road.width / 2 - 0.5; across += 1.1) {
        crosswalks.push(...vertex(-0.8, across), ...vertex(0.8, across), ...vertex(-0.8, across + 0.55));
        crosswalks.push(...vertex(-0.8, across + 0.55), ...vertex(0.8, across), ...vertex(0.8, across + 0.55));
      }
    }
  }
  const crosswalkGeometry = new BufferGeometry();
  crosswalkGeometry.setAttribute("position", new Float32BufferAttribute(crosswalks, 3));
  scene.add(new Mesh(crosswalkGeometry, new MeshBasicMaterial({ color: 0xe9e5da, side: DoubleSide })));
  const curbs: { east: number; north: number; length: number; yaw: number }[] = [];
  for (const road of data.roads) {
    if (road.width < 8) continue;
    const [a, b] = road.points;
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const length = Math.hypot(dx, dz);
    if (length < 4) continue;
    for (const side of [-1, 1]) {
      curbs.push({
        east: (a[0] + b[0]) / 2 - side * dz / length * (road.width / 2 + 0.12),
        north: (a[1] + b[1]) / 2 + side * dx / length * (road.width / 2 + 0.12),
        length,
        yaw: Math.atan2(dx, dz),
      });
    }
  }
  if (curbs.length > 0) {
    const curbMesh = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial({ color: 0xb4b4a9, roughness: 0.94 }), curbs.length);
    const transform = new Object3D();
    curbs.forEach((curb, index) => {
      transform.position.set(curb.east, terrainHeight(data, curb.east, curb.north) + 0.17, curb.north);
      transform.rotation.set(0, curb.yaw, 0);
      transform.scale.set(0.24, 0.17, curb.length);
      transform.updateMatrix();
      curbMesh.setMatrixAt(index, transform.matrix);
    });
    curbMesh.castShadow = true;
    curbMesh.receiveShadow = true;
    scene.add(curbMesh);
  }
}

function addBuildings(scene: Scene, data: ArenaData, textures: SurfaceTextures): void {
  const wallTypes = [
    { map: textures.plaster, normal: textures.plasterNormal, tint: 0xf4f1e9 },
    { map: textures.concrete, normal: textures.concreteNormal, tint: 0xe8e2d7 },
    { map: textures.brick, normal: textures.brickNormal, tint: 0xffffff },
    { map: textures.plaster, normal: textures.plasterNormal, tint: 0xdce7e5 },
    { map: textures.plaster, normal: textures.plasterNormal, tint: 0xe4d7cb },
  ];
  const walls = wallTypes.map(({ map, normal, tint }) => new MeshStandardMaterial({ color: tint, map, normalMap: normal, normalScale: new Vector2(0.36, 0.36), roughness: 0.91, side: DoubleSide }));
  const roof = new MeshStandardMaterial({ map: textures.roof, roughness: 0.95, side: DoubleSide });
  const wallGeometry = new Map<string, BufferGeometry[]>();
  const roofGeometry = new Map<string, BufferGeometry[]>();
  for (const building of data.buildings) {
    if (building.outline.length < 3) continue;
    const shape = shapeFromOutline(building.outline);
    const geometry = new ExtrudeGeometry(shape, { depth: building.height, bevelEnabled: false, steps: 1 });
    geometry.rotateX(-Math.PI / 2);
    const [east, north] = centroid(building.outline);
    const ground = terrainHeight(data, east, north);
    geometry.translate(0, ground, 0);
    geometry.clearGroups();
    const cell = `${Math.floor(east / 64)}:${Math.floor(north / 64)}`;
    const wallKey = `${cell}:${building.id % walls.length}`;
    wallGeometry.set(wallKey, [...(wallGeometry.get(wallKey) ?? []), geometry]);
    const cap = new ShapeGeometry(shape);
    cap.rotateX(-Math.PI / 2);
    cap.translate(0, ground + building.height + 0.02, 0);
    roofGeometry.set(cell, [...(roofGeometry.get(cell) ?? []), cap]);
  }
  wallGeometry.forEach((geometries, key) => {
    const merged = mergeGeometries(geometries, false);
    geometries.forEach((geometry) => geometry.dispose());
    if (merged) {
      const mesh = new Mesh(merged, walls[Number(key.split(":").at(-1))]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
    }
  });
  roofGeometry.forEach((geometries) => {
    const merged = mergeGeometries(geometries, false);
    geometries.forEach((geometry) => geometry.dispose());
    if (merged) {
      const mesh = new Mesh(merged, roof);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
    }
  });
}

function addTrees(scene: Scene, data: ArenaData, textures: SurfaceTextures): (time: number) => void {
  if (data.trees.length === 0) return () => undefined;
  textures.bark.repeat.set(1, 1);
  const trunks = new InstancedMesh(new CylinderGeometry(0.19, 0.32, 5.7, 8), new MeshStandardMaterial({ map: textures.bark, roughness: 1 }), data.trees.length);
  const branches = new InstancedMesh(new CylinderGeometry(0.07, 0.13, 2.7, 6), new MeshStandardMaterial({ map: textures.bark, roughness: 1 }), data.trees.length * 2);
  const crowns = new InstancedMesh(new SphereGeometry(1, 10, 8), new MeshStandardMaterial({ map: textures.canopy, roughness: 1 }), data.trees.length * 4);
  const leafCards = new InstancedMesh(
    new PlaneGeometry(2.25, 2.05),
    new MeshStandardMaterial({ map: textures.leaves, alphaMap: textures.leavesAlpha, alphaTest: 0.48, roughness: 1, side: DoubleSide, depthWrite: true }),
    data.trees.length * 36,
  );
  const cardPositions: { x: number; y: number; z: number; yaw: number; tree: number; scale: number }[] = [];
  const transform = new Object3D();
  data.trees.forEach(([east, north], index) => {
    const ground = terrainHeight(data, east, north);
    transform.position.set(east, ground + 2.85, north);
    transform.rotation.set(0, 0, 0);
    transform.scale.set(1, 1, 1);
    transform.updateMatrix();
    trunks.setMatrixAt(index, transform.matrix);
    for (let branch = 0; branch < 2; branch += 1) {
      transform.position.set(east + (branch ? 0.65 : -0.65), ground + 5.4, north);
      transform.rotation.set(0, 0, branch ? 0.62 : -0.62);
      transform.updateMatrix();
      branches.setMatrixAt(index * 2 + branch, transform.matrix);
    }
    for (let cluster = 0; cluster < 4; cluster += 1) {
      const angle = cluster * Math.PI * 0.5 + (index % 4) * 0.3;
      const spread = cluster === 0 ? 0 : 1.65;
      transform.position.set(east + Math.cos(angle) * spread, ground + (cluster === 0 ? 8.3 : 7.1), north + Math.sin(angle) * spread);
      transform.rotation.set(0, angle, 0);
      const variation = 0.85 + ((index * 7 + cluster * 3) % 9) / 30;
      transform.scale.set(1.08 * variation, 0.94 * variation, 1.08 * variation);
      transform.updateMatrix();
      crowns.setMatrixAt(index * 4 + cluster, transform.matrix);
      crowns.setColorAt(index * 4 + cluster, new Color([0xb5c9a4, 0x94b398, 0xc4cba0, 0xa2ba9b][(index + cluster) % 4]));
    }
    for (let card = 0; card < 36; card += 1) {
      const layer = Math.floor(card / 9);
      const angle = card * 2.39996 + index * 0.42;
      const spread = layer === 0 ? 1.2 : layer === 1 ? 2.05 : layer === 2 ? 1.7 : 0.9;
      cardPositions.push({
        x: east + Math.cos(angle) * spread,
        y: ground + 5.8 + layer * 0.85 + (card % 3) * 0.16,
        z: north + Math.sin(angle) * spread,
        yaw: angle + Math.PI / 2,
        tree: index,
        scale: 0.83 + ((index * 3 + card * 7) % 6) / 24,
      });
    }
  });
  trunks.castShadow = true;
  branches.castShadow = true;
  crowns.castShadow = true;
  leafCards.castShadow = true;
  scene.add(trunks, branches, crowns, leafCards);
  const update = (time: number): void => {
    cardPositions.forEach((card, index) => {
      const wind = Math.sin(time * 0.85 + card.tree * 0.73 + index * 0.17) * 0.07;
      transform.position.set(card.x + wind, card.y, card.z + wind * 0.5);
      transform.rotation.set(wind * 0.15, card.yaw + wind * 0.4, wind * 0.22);
      transform.scale.setScalar(card.scale);
      transform.updateMatrix();
      leafCards.setMatrixAt(index, transform.matrix);
    });
    leafCards.instanceMatrix.needsUpdate = true;
  };
  update(0);
  return update;
}

function disposeScene(scene: Scene): void {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<{ dispose: () => void }>();
  scene.traverse((object) => {
    if (object instanceof Mesh || object instanceof LineSegments) {
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
    }
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}

function disposeGroup(group: Group): void {
  group.traverse((object) => {
    if (object instanceof Mesh || object instanceof LineSegments) {
      object.geometry.dispose();
      if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
      else object.material.dispose();
    }
  });
}

// Gives the browser a chance to paint the loading screen's new step before blocking
// work starts. requestAnimationFrame does not run in a background tab, so a timeout
// stands in for it there.
function paint(): Promise<void> {
  return new Promise((resolve) => { requestAnimationFrame(() => setTimeout(resolve, 0)); setTimeout(resolve, 60); });
}

export async function createMapViewer(container: HTMLElement, arena: Arena, events: MapViewerEvents, map: GameMap = mapById("san-jose")): Promise<MapViewer> {
  // Each step owns a span of the loading bar. Files that finish during a step (Three.js
  // loaders report them to the default manager) fill that step's span, so the bar keeps
  // moving on a slow connection without running ahead of the work.
  let from = 0.04, until = 0.45;
  DefaultLoadingManager.onProgress = (_url, loaded, total) => { if (total > 0) events.onProgress?.(from + (until - from) * loaded / total); };
  const step = async (fraction: number, next: number, label: string): Promise<void> => {
    from = fraction;
    until = next;
    events.onProgress?.(fraction, label);
    await paint();
  };
  events.onStatus("loading", `Loading ${map.name} and its materials…`);
  events.onProgress?.(0.04, `Loading ${map.name}`);
  const [data, textures, skyHdri] = await Promise.all([
    loadMapData(map, arena),
    loadSurfaceTextures(),
    new RGBELoader().loadAsync(`${import.meta.env.BASE_URL}textures/san-jose-sky.hdr`).catch(() => null),
  ]);
  await step(0.45, 0.55, data.layout ? "Building alleys and buildings" : "Building streets and buildings");
  const scene = new Scene();
  // Hand-built maps choose their own light: the night market is at dusk, under a low sun.
  const dusk = data.layout?.sky === "dusk";
  const sky = dusk ? duskSky() : skyHdri ?? createSkyTexture();
  if (dusk) sky.mapping = EquirectangularReflectionMapping;
  if (skyHdri) {
    skyHdri.mapping = EquirectangularReflectionMapping;
    scene.environment = skyHdri;
    scene.environmentIntensity = dusk ? 0.06 : 0.24;
  }
  scene.background = sky;
  scene.fog = dusk ? new FogExp2(0x2c2a3c, 0.006) : new FogExp2(0xc5d2d2, 0.0035);
  scene.add(dusk ? new HemisphereLight(0x8796c4, 0x2a2228, 0.95) : new HemisphereLight(0xe7f2ff, 0x716b62, 1.2));
  if (!dusk) {
    const fill = new DirectionalLight(0xc5d8e8, 0.3);
    fill.position.set(180, 110, -150);
    scene.add(fill);
  }
  const sunOffset = dusk ? new Vector3(-220, 70, -60) : new Vector3(-180, 300, 130);
  const sun = new DirectionalLight(dusk ? 0xff9a5a : 0xffe7c5, dusk ? 0.7 : 2.15);
  sun.position.copy(sunOffset);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const shadowReach = dusk ? 55 : 125;
  sun.shadow.camera.left = -shadowReach;
  sun.shadow.camera.right = shadowReach;
  sun.shadow.camera.top = shadowReach;
  sun.shadow.camera.bottom = -shadowReach;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 700;
  sun.shadow.bias = -0.0002;
  sun.shadow.normalBias = 0.035;
  scene.add(sun, sun.target);
  // Every breakable or solid object is an entity with a stable id; refs record the instances
  // that draw each one, and groups the plain objects, so it can disappear when destroyed.
  const refs = new Map<string, InstanceRef[]>();
  const merge = (more: Map<string, InstanceRef[]>): void => { for (const [id, list] of more) refs.set(id, list); };
  const entities = new EntityRegistry();
  const propModels = await loadPropModels();
  const propViews = new PropViews(scene);
  let groups = new Map<string, Object3D[]>();
  let ladders: Ladder[] = [];
  let roofPlan: RoofPlan = { roofs: [], ladders: [], stairs: [], boxes: [], reachable: [] };
  let props: WorldEntity[] = [];
  let updateTrees = (_seconds: number): void => undefined;
  let rebuildStreets = (_next: Arena): void => undefined;
  let disposeWorld = (): void => undefined;
  if (data.layout) {
    const built = buildNightMarket(scene, textures, propModels);
    merge(built.refs);
    groups = built.groups;
    ladders = built.ladders;
    for (const entity of built.entities) entities.add(entity);
    props = built.props;
    disposeWorld = built.dispose;
    await step(0.55, 0.7, "Placing stalls, props and lights");
    await propViews.load(propModels);
  } else {
    addTerrain(scene, data, textures);
    addParks(scene, data, textures);
    addRoads(scene, data, textures);
    addBuildings(scene, data, textures);
    merge(await addCover(scene, data));
    const storefrontEdges = addStorefronts(scene, data, arena, [textures.storefrontStone, textures.storefrontCafe]);
    const windows = windowPlacements(data, arena, storefrontEdges);
    const { texture: glassTexture, glass } = addBuildingWindows(scene, windows);
    merge(glass);
    addBuildingDoors(scene, data, arena, storefrontEdges);
    addFacadeTrim(scene, data, arena);
    updateTrees = addTrees(scene, data, textures);
    const lights = streetLightPlacements(data);
    merge(addStreetLights(scene, data, lights));
    let roadDetails = makeRoadDetails(data, arena);
    scene.add(roadDetails);
    let streetFurniture = makeStreetFurniture(data, arena, refs);
    scene.add(streetFurniture);
    rebuildStreets = (next) => {
      scene.remove(roadDetails);
      disposeGroup(roadDetails);
      roadDetails = makeRoadDetails(data, next);
      scene.add(roadDetails);
      scene.remove(streetFurniture);
      disposeGroup(streetFurniture);
      streetFurniture = makeStreetFurniture(data, next, refs);
      scene.add(streetFurniture);
    };
    for (const entity of buildEntities(data, windows, lights)) entities.add(entity);
    await step(0.55, 0.7, "Placing cover, props and roofs");
    await propViews.load(propModels);
    props = placeStreetProps(data, arena, propModels);
    // Roofs are solid; low buildings get ladders or a stair, and their roofs get cover.
    roofPlan = planRoofs(data, arena);
    addRoofAccess(scene, roofPlan);
    ladders = roofPlan.ladders;
    const aircon = propModels.find((model) => model.name === "aircon_unit");
    if (aircon) roofPlan.reachable.forEach((roof, index) => {
      for (const [dx, dz] of [[-1.3, 0.4], [1.2, -0.6]]) props.push(propEntity(`prop:${props.length}`, aircon, roof.center.x + dx, roof.center.z + dz, roof.center.y + 0.02, index * 0.9 + dx));
    });
    disposeWorld = () => glassTexture.dispose();
  }
  for (const prop of props) { entities.add(prop); propViews.add(prop); }
  propViews.build(props);

  await step(0.7, 0.8, "Starting the renderer");
  const camera = new PerspectiveCamera(75, 1, 0.05, 2000);
  const renderer = new WebGPURenderer({ antialias: true, forceWebGL: new URLSearchParams(window.location.search).get("renderer") === "webgl" });
  const maximumPixelRatio = Math.min(window.devicePixelRatio, 2);
  const minimumPixelRatio = Math.min(maximumPixelRatio, 1.25);
  let pixelRatio = maximumPixelRatio;
  renderer.setPixelRatio(pixelRatio);
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = dusk ? 1.25 : 1.08;
  renderer.shadowMap.type = PCFSoftShadowMap;
  renderer.shadowMap.enabled = true;
  await renderer.init();
  const isWebGPU = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend === true;
  container.appendChild(renderer.domElement);
  await step(0.8, 0.92, "Building physics");
  const physics = new PhysicsWorld(data, arena);
  for (const roof of roofPlan.roofs) physics.addRoof(roof.vertices, roof.indices);
  for (const box of roofPlan.boxes) physics.addBox(box.half, box.position, box.rotation, box.railing ? "boundary" : "metal-solid");
  for (const solid of data.layout?.solids ?? []) physics.addBox(solid.half, solid.center, solid.rotation ?? { x: 0, y: 0, z: 0, w: 1 }, solid.material);
  for (const entity of entities.all()) physics.addEntity(entity);
  entities.locate = (entity) => physics.propPose(entity.id)?.position ?? entity.center;
  const player = new PlayerController(camera, renderer.domElement, data, arena, physics);
  player.setLadders(ladders);
  const playerModels = new PlayerModelLibrary();
  const remotePlayers = new RemotePlayers(scene, data, playerModels, physics);
  // Sounds behind buildings and cover are dulled: one ray from the listener toward the source.
  gameAudio.occlusion = (from, to) => {
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const distance = Math.hypot(dx, dy, dz);
    if (distance < 1.5) return false;
    return !physics.clearShot({ origin: { x: from.x, y: from.y, z: from.z }, direction: { x: dx / distance, y: dy / distance, z: dz / distance }, distance: distance - 0.4 });
  };
  const soundStage = new SoundStage(data, (peerId) => remotePlayers.position(peerId));
  scene.add(camera);
  const viewScene = new Scene();
  viewScene.environment = scene.environment;
  const viewCamera = new PerspectiveCamera(camera.fov, camera.aspect, 0.01, 10);
  viewScene.add(viewCamera);
  viewScene.add(new HemisphereLight(dusk ? 0x9aa4c8 : 0xe6f1ff, 0x605b4a, dusk ? 1.0 : 2));
  const viewSun = new DirectionalLight(dusk ? 0xffc890 : 0xffe6c4, dusk ? 1.4 : 2.5);
  viewSun.position.set(-2, 4, 3);
  viewScene.add(viewSun);
  const weaponVisuals = new WeaponVisuals(viewCamera, scene, data, makeWeaponPickups(data, arena));
  const authoredViewModel = new AuthoredViewModel(viewCamera);
  // Pickups and other players use the first-person weapon models once they load.
  void loadWeaponModels().then((models) => {
    weaponVisuals.useModels(models);
    remotePlayers.setWeaponModels(models);
  });
  const shotEffects = new ShotEffects(scene);
  const effects = new WorldEffects(scene, data, refs, () => camera.position, groups);
  // What the coordinating peer asks of this world when it resolves shots and blasts.
  const combatWorld: CombatWorld = {
    clearShot: (ray) => physics.clearShot(ray),
    traceBullet: (ray) => physics.traceBullet(ray, (point) => entities.windowAt(point)?.id ?? null),
    entity: (id) => {
      const entity = entities.get(id);
      return entity && !entities.destroyed(id) ? { material: entity.material, maxHealth: entity.maxHealth } : null;
    },
    entitiesNear: (center, radius) => entities.near(center, radius),
    grenadeRest: (origin, velocity, seconds) => physics.grenadePath(origin, velocity, seconds).points.at(-1)!,
    push: (id, point, impulse) => physics.push(id, point, impulse),
  };
  let lastLandings = 0;
  // The first-person view drops and rolls when eliminated, from the pose at that moment.
  let deathView: { position: Vector3; quaternion: Quaternion; time: number } | null = null;
  const rendererName = isWebGPU ? "WebGPU" : "WebGL 2";
  const resize = (): void => {
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();

  let frames = 0;
  let renderedFrames = 0;
  let previousFrame = 0;
  let lastMetrics = performance.now();
  let readySent = false;
  let slowSamples = 0;
  let fastSamples = 0;
  let localBloom = 0;
  let lastLocalShot = 0;
  let lastSpread = -1;
  renderer.setAnimationLoop((time) => {
    const delta = previousFrame ? (time - previousFrame) / 1000 : 0;
    const steps = physics.steps;
    player.update(delta);
    // Paused or eliminated players do not move the world, so step it for ragdolls and props.
    if (physics.steps === steps) physics.advance(delta);
    if (deathView) {
      deathView.time += delta;
      const fall = Math.min(1, deathView.time / 0.7), eased = 1 - (1 - fall) ** 3;
      camera.position.copy(deathView.position).add(new Vector3(0, -1.3 * eased, 0));
      camera.quaternion.copy(deathView.quaternion).multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 1.15 * eased));
    }
    remotePlayers.update(delta);
    soundStage.update(camera, player.gait(), player.motion(), remotePlayers);
    const gait = player.gait();
    if (gait.landings !== lastLandings) {
      lastLandings = gait.landings;
      if (gait.landingSpeed > 9) events.onHardLanding?.(gait.landingSpeed);
    }
    shotEffects.update(delta);
    effects.update(Math.min(delta, 0.1));
    for (const prop of props) {
      const pose = physics.propPose(prop.id);
      if (pose) propViews.place(prop.id, pose.position, pose.rotation);
    }
    // Nearby blasts shake the view; the controller resets the camera every frame.
    if (effects.shake > 0.01) {
      const amount = effects.shake * 0.05;
      camera.position.x += (Math.random() - 0.5) * amount;
      camera.position.y += (Math.random() - 0.5) * amount;
      camera.rotateZ((Math.random() - 0.5) * effects.shake * 0.02);
    }
    const pose = player.pose();
    weaponVisuals.update(delta, player.motion(), pose.heading, pose.pitch);
    authoredViewModel.update(delta, player.motion(), weaponVisuals.dynamics());
    weaponVisuals.setFallbackVisible(!authoredViewModel.hasModel());
    // The crosshair opens with the same spread the leader applies to this player's shots.
    const motion = player.motion(), active = weaponVisuals.dynamics().active;
    const spread = spreadDegrees(active, motion, currentBloom(active, localBloom, (performance.now() - lastLocalShot) / 1000));
    const spreadPixels = Math.tan(spread * Math.PI / 180) * (container.clientHeight / 2) / Math.tan(camera.fov * Math.PI / 360);
    if (Math.abs(spreadPixels - lastSpread) > 0.25) {
      lastSpread = spreadPixels;
      events.onAim?.(spreadPixels, active === "knife");
    }
    updateTrees(time / 1000);
    sun.target.position.set(camera.position.x, 0, camera.position.z);
    sun.position.set(camera.position.x + sunOffset.x, sunOffset.y, camera.position.z + sunOffset.z);
    sun.target.updateMatrixWorld();
    previousFrame = time;
    renderer.render(scene, camera);
    const worldCalls = renderer.info.render.drawCalls, worldTriangles = renderer.info.render.triangles;
    viewCamera.aspect = camera.aspect;
    viewCamera.fov = camera.fov;
    viewCamera.updateProjectionMatrix();
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(viewScene, viewCamera);
    renderer.autoClear = true;
    frames += 1;
    renderedFrames += 1;
    if (renderedFrames === 1) { DefaultLoadingManager.onProgress = () => undefined; events.onProgress?.(0.92, "Preparing shaders"); }
    if (!readySent && renderedFrames >= 2) {
      events.onStatus("ready", `${map.name} loaded. Use arrow keys to move and drag on the map to look around.`);
      readySent = true;
    }
    if (time - lastMetrics >= 500) {
      const fps = Math.round(frames * 1000 / (time - lastMetrics));
      slowSamples = !document.hidden && fps < 45 ? slowSamples + 1 : 0;
      fastSamples = !document.hidden && fps >= 57 ? fastSamples + 1 : 0;
      if (slowSamples >= 6 && pixelRatio > minimumPixelRatio) {
        pixelRatio = Math.max(minimumPixelRatio, pixelRatio - 0.25);
        renderer.setPixelRatio(pixelRatio);
        resize();
        slowSamples = 0;
        fastSamples = 0;
      } else if (fastSamples >= 24 && pixelRatio < maximumPixelRatio) {
        pixelRatio = Math.min(maximumPixelRatio, pixelRatio + 0.25);
        renderer.setPixelRatio(pixelRatio);
        resize();
        slowSamples = 0;
        fastSamples = 0;
      }
      events.onMetrics({
        fps,
        renderer: rendererName,
        drawCalls: worldCalls + renderer.info.render.drawCalls,
        triangles: worldTriangles + renderer.info.render.triangles,
        pixelRatio,
      });
      frames = 0;
      lastMetrics = time;
    }
  });

  return {
    arenaData() { return data; },
    setArena(nextArena) {
      player.reset(nextArena);
      remotePlayers.clear();
      rebuildStreets(nextArena);
    },
    setPaused(paused) {
      player.setPaused(paused);
    },
    playerPose() {
      return player.pose();
    },
    traceShot(ray) { return physics.traceShot(ray); },
    showShot(event, local) { shotEffects.show(event, local ? (authoredViewModel.muzzle() ?? weaponVisuals.muzzle())?.applyMatrix4(camera.matrixWorld) : undefined); },
    clearShot(ray) {
      return physics.clearShot(ray);
    },
    setSpawnSlot(slot) {
      player.setSpawnSlot(slot);
    },
    respawn() {
      player.reset(arena);
    },
    setWeapon(kind) {
      weaponVisuals.setActive(kind);
    },
    setTakenPickups(taken) {
      weaponVisuals.setTaken(taken);
    },
    weaponReady() { const motion = player.motion(); return weaponVisuals.ready() && !motion.mantling && !motion.climbing; },
    holdSprint(seconds) { player.holdSprint(seconds); },
    combatWorld() { return combatWorld; },
    setEntityHealth(health) {
      // Anything destroyed earlier but intact in this table was restored (a room reset).
      for (const entity of entities.all()) {
        if (entities.destroyed(entity.id) && !((health[entity.id] ?? entity.maxHealth) <= 0)) {
          physics.restoreEntity(entity.id);
          effects.restore(entity);
          if (entity.kind === "prop") propViews.setVisible(entity.id, true);
        }
      }
      if (!Object.keys(health).length) entities.resetHealth();
      for (const entity of entities.applyHealth(health)) {
        const at = physics.propPose(entity.id)?.position;
        physics.removeEntity(entity.id);
        effects.destroy(at ? { ...entity, center: at } : entity);
        if (entity.kind === "prop") propViews.setVisible(entity.id, false);
      }
    },
    playEvent(event, selfId) {
      soundStage.combat(event, selfId);
      for (const impact of event.impacts ?? []) effects.impact(impact, { x: impact.nx, y: impact.ny, z: impact.nz }, impact.material, impact.exit);
      if (event.kind === "throw" && event.position && event.velocity && event.grenade !== undefined) {
        effects.throwGrenade(event.grenade, physics.grenadePath(event.position, event.velocity, (event.fuseMs ?? 2600) / 1000));
      }
      if (event.kind === "explode" && event.position) {
        if (event.grenade !== undefined) effects.removeGrenade(event.grenade);
        effects.explosion(event.position);
      }
      if ((event.kind === "hit" || event.kind === "death") && event.target && event.target !== selfId && event.cause !== "fall") {
        const at = remotePlayers.position(event.target);
        if (at) {
          effects.impact({ x: at.x, y: at.y + (event.zone === "head" ? 1.65 : 1.15), z: at.z }, { x: 0, y: 0.4, z: 0 }, "flesh");
          // The killing blow knocks the ragdoll away from where it came from.
          if (event.kind === "death") {
            const from = event.from ?? { x: at.x, y: at.y + 1, z: at.z - 1 };
            const dx = at.x - from.x, dz = at.z - from.z, length = Math.hypot(dx, dz) || 1;
            const blast = event.cause === "grenade" ? 140 * Math.max(0.2, 1 - Math.hypot(dx, dz) / 7) : 0;
            const strength = blast || { knife: 10, pistol: 20, rifle: 28 }[event.cause as "knife" | "pistol" | "rifle"] || 15;
            remotePlayers.kill(event.target, event.zone === "head" ? "head" : "chest", { x: dx / length * strength, y: blast ? strength * 0.6 : 2, z: dz / length * strength });
          }
        }
      }
    },
    seenTimes() { return remotePlayers.seen(); },
    flinch(damage) { player.flinch(damage); },
    remoteFlinch(peerId, damage) { remotePlayers.flinch(peerId, damage); },
    remotePosition(peerId) { return remotePlayers.position(peerId); },
    quickThrow() { weaponVisuals.quickThrow(); },
    propStates(all) { return physics.propStates(all); },
    applyPropStates(states) { physics.applyPropStates(states); },
    setAuthority(authority) { physics.setAuthority(authority); },
    resetWorld() { physics.resetProps(); },
    setLocalDead(dead) {
      if (dead && !deathView) deathView = { position: camera.position.clone(), quaternion: camera.quaternion.clone(), time: 0 };
      if (!dead) deathView = null;
    },
    playAttack(weapon) {
      weaponVisuals.attack();
      authoredViewModel.fire();
      gameAudio.fire(weapon);
      const now = performance.now();
      localBloom = bloomAfterShot(weapon, localBloom, (now - lastLocalShot) / 1000);
      lastLocalShot = now;
      if (weapon !== "knife") player.kickRecoil(weapon === "rifle" ? 0.7 : 1.2);
    },
    startReload(weapon, durationMs) {
      weaponVisuals.reload(weapon, durationMs);
      gameAudio.reload(weapon);
    },
    cancelReload() {
      weaponVisuals.cancelReload();
      gameAudio.cancelReload();
    },
    combatSound(event, selfId) {
      soundStage.combat(event, selfId);
    },
    remoteReload(peerId, weapon) {
      const at = remotePlayers.position(peerId);
      if (at) gameAudio.remoteReload(weapon, { x: at.x, y: at.y + 1.1, z: at.z });
    },
    setRemotePose(peerId, pose, sentAt) {
      remotePlayers.setPose(peerId, pose, sentAt);
    },
    setRemoteHealth(peerId, health) {
      remotePlayers.setHealth(peerId, health);
    },
    setRemoteWeapon(peerId, weapon) {
      remotePlayers.setWeapon(peerId, weapon);
    },
    removeRemotePeer(peerId) {
      remotePlayers.remove(peerId);
    },
    clearRemotePeers() {
      remotePlayers.clear();
    },
    destroy() {
      renderer.setAnimationLoop(null);
      observer.disconnect();
      gameAudio.occlusion = () => false;
      player.destroy();
      physics.dispose();
      shotEffects.dispose();
      authoredViewModel.dispose();
      remotePlayers.clear();
      playerModels.dispose();
      disposeScene(scene);
      disposeScene(viewScene);
      textures.dispose();
      disposeWorld();
      sky.dispose();
      if (skyHdri && skyHdri !== sky) skyHdri.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
