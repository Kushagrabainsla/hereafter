import {
  ACESFilmicToneMapping, BoxGeometry, BufferGeometry, Color, CylinderGeometry, DirectionalLight,
  DoubleSide, EquirectangularReflectionMapping, ExtrudeGeometry, Float32BufferAttribute, FogExp2, Group, HemisphereLight, InstancedMesh,
  LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, MeshStandardMaterial, PCFSoftShadowMap,
  Object3D, PerspectiveCamera, PlaneGeometry, Scene, Shape, ShapeGeometry, SphereGeometry, Vector2, Vector3,
  WebGPURenderer,
} from "three/webgpu";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { RGBELoader } from "three/addons/loaders/RGBELoader.js";
import { PlayerController, type PlayerPose } from "../game/playerController";
import { PlayerHands } from "../game/playerHands";
import { RemotePlayers } from "../game/remotePlayers";
import { loadArenaData, terrainHeight, toLocal, type Arena, type ArenaData, type Point } from "./arena";
import { loadSurfaceTextures, type SurfaceTextures } from "./surfaceTextures";
import { addBuildingDoors, addBuildingWindows, addFacadeTrim, addStorefronts, addStreetLights, createSkyTexture, makeRoadDetails, makeStreetFurniture } from "./scenery";

export type MapState = "loading" | "ready" | "error";

export interface MapMetrics {
  fps: number;
  renderer: string;
}

export interface MapViewerEvents {
  onStatus: (state: MapState, message: string) => void;
  onMetrics: (metrics: MapMetrics) => void;
}

export interface MapViewer {
  setArena: (arena: Arena) => void;
  setPaused: (paused: boolean) => void;
  playerPose: () => PlayerPose;
  setSpawnSlot: (slot: number) => void;
  setRemotePose: (peerId: string, pose: PlayerPose) => void;
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

function roadGeometry(data: ArenaData, walkway: boolean): BufferGeometry {
  const vertices: number[] = [];
  const uvs: number[] = [];
  for (const road of data.roads) {
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
  const asphalt = new Mesh(roadGeometry(data, false), new MeshStandardMaterial({ map: textures.asphalt, normalMap: textures.asphaltNormal, normalScale: new Vector2(0.5, 0.5), roughness: 0.96, side: DoubleSide }));
  const pavement = new Mesh(roadGeometry(data, true), new MeshStandardMaterial({ map: textures.pavement, normalMap: textures.pavementNormal, normalScale: new Vector2(0.4, 0.4), roughness: 0.94, side: DoubleSide }));
  asphalt.receiveShadow = true;
  pavement.receiveShadow = true;
  scene.add(asphalt, pavement);
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
  const wallGeometry: BufferGeometry[][] = walls.map(() => []);
  const roofGeometry: BufferGeometry[] = [];
  for (const building of data.buildings) {
    if (building.outline.length < 3) continue;
    const shape = shapeFromOutline(building.outline);
    const geometry = new ExtrudeGeometry(shape, { depth: building.height, bevelEnabled: false, steps: 1 });
    geometry.rotateX(-Math.PI / 2);
    const [east, north] = centroid(building.outline);
    const ground = terrainHeight(data, east, north);
    geometry.translate(0, ground, 0);
    geometry.clearGroups();
    wallGeometry[building.id % walls.length].push(geometry);
    const cap = new ShapeGeometry(shape);
    cap.rotateX(-Math.PI / 2);
    cap.translate(0, ground + building.height + 0.02, 0);
    roofGeometry.push(cap);
  }
  wallGeometry.forEach((geometries, index) => {
    const merged = mergeGeometries(geometries, false);
    geometries.forEach((geometry) => geometry.dispose());
    if (merged) {
      const mesh = new Mesh(merged, walls[index]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
    }
  });
  const mergedRoofs = mergeGeometries(roofGeometry, false);
  roofGeometry.forEach((geometry) => geometry.dispose());
  if (mergedRoofs) {
    const mesh = new Mesh(mergedRoofs, roof);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
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

function makeBoundary(data: ArenaData, arena: Arena): Group {
  const group = new Group();
  const [centerEast, centerNorth] = toLocal(arena.latitude, arena.longitude);
  const half = arena.sizeMeters / 2;
  const corners: Point[] = [
    [centerEast - half, centerNorth - half], [centerEast + half, centerNorth - half],
    [centerEast + half, centerNorth + half], [centerEast - half, centerNorth + half],
  ];
  const geometry = new BufferGeometry();
  geometry.setFromPoints(corners.flatMap(([east, north], index) => {
    const [nextEast, nextNorth] = corners[(index + 1) % corners.length];
    return [
      new Vector3(east, terrainHeight(data, east, north) + 0.8, north),
      new Vector3(nextEast, terrainHeight(data, nextEast, nextNorth) + 0.8, nextNorth),
    ];
  }));
  group.add(new LineSegments(geometry, new LineBasicMaterial({ color: 0x85e9e9 })));
  const postGeometry = new BoxGeometry(1.2, 8, 1.2);
  const postMaterial = new MeshBasicMaterial({ color: 0x85e9e9 });
  for (const [east, north] of corners) {
    const post = new Mesh(postGeometry, postMaterial);
    post.position.set(east, terrainHeight(data, east, north) + 4, north);
    group.add(post);
  }
  return group;
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
    loadArenaData(),
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
  scene.fog = new FogExp2(0xc5d2d2, 0.0021);
  scene.add(new HemisphereLight(0xe7f2ff, 0x716b62, 1.2));
  const fill = new DirectionalLight(0xc5d8e8, 0.3);
  fill.position.set(180, 110, -150);
  scene.add(fill);
  const sun = new DirectionalLight(0xffe7c5, 2.15);
  sun.position.set(-180, 300, 130);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -160;
  sun.shadow.camera.right = 160;
  sun.shadow.camera.top = 160;
  sun.shadow.camera.bottom = -160;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 700;
  sun.shadow.bias = -0.0002;
  sun.shadow.normalBias = 0.035;
  scene.add(sun, sun.target);
  addTerrain(scene, data, textures);
  addParks(scene, data, textures);
  addRoads(scene, data, textures);
  addBuildings(scene, data, textures);
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
  let boundary = makeBoundary(data, arena);
  scene.add(boundary);

  const camera = new PerspectiveCamera(75, 1, 0.05, 2000);
  const renderer = new WebGPURenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.type = PCFSoftShadowMap;
  renderer.shadowMap.enabled = true;
  await renderer.init();
  const isWebGPU = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend === true;
  container.appendChild(renderer.domElement);
  const player = new PlayerController(camera, renderer.domElement, data, arena);
  const remotePlayers = new RemotePlayers(scene, data);
  scene.add(camera);
  const hands = new PlayerHands(camera);
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
  renderer.setAnimationLoop((time) => {
    const delta = previousFrame ? (time - previousFrame) / 1000 : 0;
    player.update(delta);
    remotePlayers.update(delta);
    hands.update(delta, player.motion());
    updateTrees(time / 1000);
    sun.target.position.set(camera.position.x, 0, camera.position.z);
    sun.position.set(camera.position.x - 180, 300, camera.position.z + 130);
    sun.target.updateMatrixWorld();
    previousFrame = time;
    renderer.render(scene, camera);
    frames += 1;
    renderedFrames += 1;
    if (!readySent && renderedFrames >= 2) {
      events.onStatus("ready", "San Jose arena loaded. Use arrow keys to move and drag on the map to look around.");
      readySent = true;
    }
    if (time - lastMetrics >= 500) {
      events.onMetrics({
        fps: Math.round(frames * 1000 / (time - lastMetrics)),
        renderer: rendererName,
      });
      frames = 0;
      lastMetrics = time;
    }
  });

  return {
    setArena(nextArena) {
      player.reset(nextArena);
      remotePlayers.clear();
      scene.remove(boundary);
      disposeGroup(boundary);
      boundary = makeBoundary(data, nextArena);
      scene.add(boundary);
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
    setSpawnSlot(slot) {
      player.setSpawnSlot(slot);
    },
    setRemotePose(peerId, pose) {
      remotePlayers.setPose(peerId, pose);
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
      player.destroy();
      remotePlayers.clear();
      disposeScene(scene);
      textures.dispose();
      glassTexture.dispose();
      sky.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
