import {
  BoxGeometry, BufferGeometry, Color, ConeGeometry, CylinderGeometry, DirectionalLight,
  DoubleSide, ExtrudeGeometry, Float32BufferAttribute, FogExp2, Group, HemisphereLight, InstancedMesh,
  LineBasicMaterial, LineLoop, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  Object3D, PerspectiveCamera, PlaneGeometry, Scene, Shape, ShapeGeometry, Vector3,
  WebGPURenderer,
} from "three/webgpu";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { PlayerController, type PlayerPose } from "../game/playerController";
import { loadArenaData, terrainHeight, toLocal, type Arena, type ArenaData, type Point } from "./arena";

export type MapState = "loading" | "ready" | "error";

export interface MapMetrics {
  fps: number;
  player: PlayerPose;
  renderer: string;
  buildings: number;
  roads: number;
}

export interface MapViewerEvents {
  onStatus: (state: MapState, message: string) => void;
  onMetrics: (metrics: MapMetrics) => void;
}

export interface MapViewer {
  setArena: (arena: Arena) => void;
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

function addTerrain(scene: Scene, data: ArenaData): void {
  const geometry = new PlaneGeometry(data.extentMeters * 2, data.extentMeters * 2, 42, 42);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.getAttribute("position");
  for (let index = 0; index < position.count; index += 1) {
    position.setY(index, terrainHeight(data, position.getX(index), position.getZ(index)));
  }
  geometry.computeVertexNormals();
  const ground = new Mesh(geometry, new MeshStandardMaterial({ color: 0x33545b, roughness: 1, side: DoubleSide }));
  scene.add(ground);
}

function addParks(scene: Scene, data: ArenaData): void {
  const material = new MeshStandardMaterial({ color: 0x5a8066, roughness: 1, side: DoubleSide });
  for (const park of data.parks) {
    if (park.outline.length < 3) continue;
    const geometry = new ShapeGeometry(shapeFromOutline(park.outline));
    geometry.rotateX(-Math.PI / 2);
    const [east, north] = centroid(park.outline);
    geometry.translate(0, terrainHeight(data, east, north) + 0.08, 0);
    scene.add(new Mesh(geometry, material));
  }
}

function roadGeometry(data: ArenaData, walkway: boolean): BufferGeometry {
  const vertices: number[] = [];
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
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function addRoads(scene: Scene, data: ArenaData): void {
  scene.add(new Mesh(roadGeometry(data, false), new MeshBasicMaterial({ color: 0x233544, side: DoubleSide })));
  scene.add(new Mesh(roadGeometry(data, true), new MeshBasicMaterial({ color: 0x93a49d, side: DoubleSide })));
}

function addBuildings(scene: Scene, data: ArenaData): void {
  const walls = [0x8faab1, 0xb9b4a2, 0x7595a3, 0xc2a993, 0x9aa9a2]
    .map((color) => new MeshStandardMaterial({ color, roughness: 0.9, metalness: 0.04, side: DoubleSide }));
  const roof = new MeshStandardMaterial({ color: 0x4b6470, roughness: 0.9, side: DoubleSide });
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
    if (merged) scene.add(new Mesh(merged, walls[index]));
  });
  const mergedRoofs = mergeGeometries(roofGeometry, false);
  roofGeometry.forEach((geometry) => geometry.dispose());
  if (mergedRoofs) scene.add(new Mesh(mergedRoofs, roof));
}

function addTrees(scene: Scene, data: ArenaData): void {
  if (data.trees.length === 0) return;
  const trunks = new InstancedMesh(new CylinderGeometry(0.28, 0.4, 4, 6), new MeshStandardMaterial({ color: 0x5a5141 }), data.trees.length);
  const crowns = new InstancedMesh(new ConeGeometry(3.2, 9, 7), new MeshStandardMaterial({ color: 0x688e71, roughness: 1 }), data.trees.length);
  const transform = new Object3D();
  data.trees.forEach(([east, north], index) => {
    const ground = terrainHeight(data, east, north);
    transform.position.set(east, ground + 2, north);
    transform.updateMatrix();
    trunks.setMatrixAt(index, transform.matrix);
    transform.position.y = ground + 8;
    transform.updateMatrix();
    crowns.setMatrixAt(index, transform.matrix);
  });
  scene.add(trunks, crowns);
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
  geometry.setFromPoints(corners.map(([east, north]) => new Vector3(east, terrainHeight(data, east, north) + 0.8, north)));
  group.add(new LineLoop(geometry, new LineBasicMaterial({ color: 0x85e9e9 })));
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
    if (object instanceof Mesh || object instanceof LineLoop) {
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
    }
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}

export async function createMapViewer(container: HTMLElement, arena: Arena, events: MapViewerEvents): Promise<MapViewer> {
  events.onStatus("loading", "Loading the bundled San Jose arena…");
  const data = await loadArenaData();
  const scene = new Scene();
  scene.background = new Color(0x8ba7b9);
  scene.fog = new FogExp2(0x8ba7b9, 0.0017);
  scene.add(new HemisphereLight(0xe4f4ff, 0x3c5360, 2.3));
  const sun = new DirectionalLight(0xffe2b9, 2.2);
  sun.position.set(-180, 250, 120);
  scene.add(sun);
  addTerrain(scene, data);
  addParks(scene, data);
  addRoads(scene, data);
  addBuildings(scene, data);
  addTrees(scene, data);
  let boundary = makeBoundary(data, arena);
  scene.add(boundary);

  const camera = new PerspectiveCamera(75, 1, 0.05, 2000);
  const renderer = new WebGPURenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  await renderer.init();
  container.appendChild(renderer.domElement);
  const player = new PlayerController(camera, renderer.domElement, data, arena);
  const rendererName = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? "WebGPU" : "WebGL 2";
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
  let previousFrame = 0;
  let lastMetrics = performance.now();
  renderer.setAnimationLoop((time) => {
    player.update(previousFrame ? (time - previousFrame) / 1000 : 0);
    previousFrame = time;
    renderer.render(scene, camera);
    frames += 1;
    if (time - lastMetrics >= 500) {
      events.onMetrics({
        fps: Math.round(frames * 1000 / (time - lastMetrics)),
        player: player.pose(),
        renderer: rendererName,
        buildings: data.buildings.length,
        roads: data.roads.length,
      });
      frames = 0;
      lastMetrics = time;
    }
  });
  events.onStatus("ready", "San Jose arena loaded. Use arrow keys to move and drag on the map to look around.");

  return {
    setArena(nextArena) {
      player.reset(nextArena);
      scene.remove(boundary);
      boundary.traverse((object) => {
        if (object instanceof Mesh || object instanceof LineLoop) {
          object.geometry.dispose();
          if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
          else object.material.dispose();
        }
      });
      boundary = makeBoundary(data, nextArena);
      scene.add(boundary);
    },
    destroy() {
      renderer.setAnimationLoop(null);
      observer.disconnect();
      player.destroy();
      disposeScene(scene);
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
