import {
  ACESFilmicToneMapping, BoxGeometry, BufferGeometry, Color, CylinderGeometry, DirectionalLight,
  DoubleSide, EquirectangularReflectionMapping, ExtrudeGeometry, Float32BufferAttribute, FogExp2, Group, HemisphereLight, InstancedMesh,
  LineSegments, Mesh, MeshBasicMaterial, MeshStandardMaterial, PCFSoftShadowMap,
  Object3D, PerspectiveCamera, PlaneGeometry, Scene, Shape, ShapeGeometry, SphereGeometry, Vector2,
  WebGPURenderer,
} from "three/webgpu";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { RGBELoader } from "three/addons/loaders/RGBELoader.js";
import { PlayerController, type PlayerPose } from "../game/playerController";
import { RemotePlayers } from "../game/remotePlayers";
import { AuthoredViewModel } from "../game/authoredViewModel";
import { PlayerModelLibrary } from "../game/playerModel";
import { ShotEffects } from "../game/shotEffects";
import { type CombatEvent } from "../game/matchState";
import { WeaponVisuals } from "../game/weaponVisuals";
import { gameAudio } from "../game/gameAudio";
import { SoundStage } from "../game/soundStage";
import { makeWeaponPickups, type WeaponKind } from "../game/combatRules";
import { loadArenaData, terrainHeight, type Arena, type ArenaData, type Point } from "./arena";
import { loadSurfaceTextures, type SurfaceTextures } from "./surfaceTextures";
import { addCover } from "./cover";
import { PhysicsWorld, type ShotRay } from "./physics";
import { addBuildingDoors, addBuildingWindows, addFacadeTrim, addStorefronts, addStreetLights, createSkyTexture, makeRoadDetails, makeStreetFurniture } from "./scenery";

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
  playAttack: (weapon: WeaponKind) => void;
  startReload: (weapon: WeaponKind, durationMs: number) => void;
  cancelReload: () => void;
  combatSound: (event: CombatEvent, selfId: string) => void;
  remoteReload: (peerId: string, weapon: WeaponKind) => void;
  setRemotePose: (peerId: string, pose: PlayerPose) => void;
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

export async function createMapViewer(container: HTMLElement, arena: Arena, events: MapViewerEvents): Promise<MapViewer> {
  events.onStatus("loading", "Loading the bundled San Jose arena and materials…");
  const [data, textures, skyHdri] = await Promise.all([
    loadArenaData(arena),
    loadSurfaceTextures(),
    new RGBELoader().loadAsync(`${import.meta.env.BASE_URL}textures/san-jose-sky.hdr`).catch(() => null),
  ]);
  const scene = new Scene();
  const sky = skyHdri ?? createSkyTexture();
  if (skyHdri) {
    skyHdri.mapping = EquirectangularReflectionMapping;
    scene.environment = skyHdri;
    scene.environmentIntensity = 0.24;
  }
  scene.background = sky;
  scene.fog = new FogExp2(0xc5d2d2, 0.0035);
  scene.add(new HemisphereLight(0xe7f2ff, 0x716b62, 1.2));
  const fill = new DirectionalLight(0xc5d8e8, 0.3);
  fill.position.set(180, 110, -150);
  scene.add(fill);
  const sun = new DirectionalLight(0xffe7c5, 2.15);
  sun.position.set(-180, 300, 130);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -125;
  sun.shadow.camera.right = 125;
  sun.shadow.camera.top = 125;
  sun.shadow.camera.bottom = -125;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 700;
  sun.shadow.bias = -0.0002;
  sun.shadow.normalBias = 0.035;
  scene.add(sun, sun.target);
  addTerrain(scene, data, textures);
  addParks(scene, data, textures);
  addRoads(scene, data, textures);
  addBuildings(scene, data, textures);
  await addCover(scene, data);
  const storefrontEdges = addStorefronts(scene, data, arena, [textures.storefrontStone, textures.storefrontCafe]);
  const glassTexture = addBuildingWindows(scene, data, arena, storefrontEdges);
  addBuildingDoors(scene, data, arena, storefrontEdges);
  addFacadeTrim(scene, data, arena);
  const updateTrees = addTrees(scene, data, textures);
  addStreetLights(scene, data);
  let roadDetails = makeRoadDetails(data, arena);
  scene.add(roadDetails);
  let streetFurniture = makeStreetFurniture(data, arena);
  scene.add(streetFurniture);

  const camera = new PerspectiveCamera(75, 1, 0.05, 2000);
  const renderer = new WebGPURenderer({ antialias: true, forceWebGL: new URLSearchParams(window.location.search).get("renderer") === "webgl" });
  const maximumPixelRatio = Math.min(window.devicePixelRatio, 2);
  const minimumPixelRatio = Math.min(maximumPixelRatio, 1.25);
  let pixelRatio = maximumPixelRatio;
  renderer.setPixelRatio(pixelRatio);
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.type = PCFSoftShadowMap;
  renderer.shadowMap.enabled = true;
  await renderer.init();
  const isWebGPU = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend === true;
  container.appendChild(renderer.domElement);
  const physics = new PhysicsWorld(data, arena);
  const player = new PlayerController(camera, renderer.domElement, data, arena, physics);
  const playerModels = new PlayerModelLibrary();
  const remotePlayers = new RemotePlayers(scene, data, playerModels);
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
  viewScene.add(new HemisphereLight(0xe6f1ff, 0x605b4a, 2));
  const viewSun = new DirectionalLight(0xffe6c4, 2.5);
  viewSun.position.set(-2, 4, 3);
  viewScene.add(viewSun);
  const weaponVisuals = new WeaponVisuals(viewCamera, scene, data, makeWeaponPickups(data, arena));
  const authoredViewModel = new AuthoredViewModel(viewCamera);
  const shotEffects = new ShotEffects(scene);
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
  renderer.setAnimationLoop((time) => {
    const delta = previousFrame ? (time - previousFrame) / 1000 : 0;
    player.update(delta);
    remotePlayers.update(delta);
    soundStage.update(camera, player.gait(), player.motion(), remotePlayers);
    shotEffects.update(delta);
    const pose = player.pose();
    weaponVisuals.update(delta, player.motion(), pose.heading, pose.pitch);
    authoredViewModel.update(delta, player.motion(), weaponVisuals.dynamics());
    weaponVisuals.setFallbackVisible(!authoredViewModel.hasModel());
    updateTrees(time / 1000);
    sun.target.position.set(camera.position.x, 0, camera.position.z);
    sun.position.set(camera.position.x - 180, 300, camera.position.z + 130);
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
    if (!readySent && renderedFrames >= 2) {
      events.onStatus("ready", "San Jose arena loaded. Use arrow keys to move and drag on the map to look around.");
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
      scene.remove(roadDetails);
      disposeGroup(roadDetails);
      roadDetails = makeRoadDetails(data, nextArena);
      scene.add(roadDetails);
      scene.remove(streetFurniture);
      disposeGroup(streetFurniture);
      streetFurniture = makeStreetFurniture(data, nextArena);
      scene.add(streetFurniture);
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
    weaponReady() { return weaponVisuals.ready(); },
    playAttack(weapon) {
      weaponVisuals.attack();
      authoredViewModel.fire();
      gameAudio.fire(weapon);
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
    setRemotePose(peerId, pose) {
      remotePlayers.setPose(peerId, pose);
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
      glassTexture.dispose();
      sky.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
