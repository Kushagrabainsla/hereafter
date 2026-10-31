import {
  ACESFilmicToneMapping, DirectionalLight, FogExp2, HemisphereLight, Mesh, PCFShadowMap, PerspectiveCamera, PointLight, Quaternion,
  RenderPipeline, Scene, Vector3, DefaultLoadingManager, WebGPURenderer, LineSegments, type BufferGeometry, type Node,
} from "three/webgpu";
import { float, luminance, mix, pass, renderOutput, screenUV, smoothstep, vec3, vec4 } from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { ao } from "three/addons/tsl/display/GTAONode.js";
import { film } from "three/addons/tsl/display/FilmNode.js";
import { smaa } from "three/addons/tsl/display/SMAANode.js";
import { ClusteredLighting } from "three/addons/lighting/ClusteredLighting.js";
import { PlayerController, type PlayerPose } from "../game/playerController";
import { RemotePlayers } from "../game/remotePlayers";
import { AuthoredViewModel } from "../game/authoredViewModel";
import { PlayerModelLibrary } from "../game/playerModel";
import { ShotEffects } from "../game/shotEffects";
import { BLAST_RADIUS, type CombatEvent, type CombatWorld, type Drop } from "../game/matchState";
import { ViewLighting } from "../game/viewLighting";
import { LootViews } from "../game/loot";
import { Ejecta } from "../game/ejecta";
import { WeaponVisuals } from "../game/weaponVisuals";
import { loadWeaponModels } from "../game/weaponModels";
import { gameAudio } from "../game/gameAudio";
import { SoundStage } from "../game/soundStage";
import { bloomAfterShot, currentBloom, makeWeaponPickups, spreadDegrees, KNIFE, type GunKind, type KnifeStroke, type WeaponKind } from "../game/combatRules";
import { type Arena, type ArenaData } from "./arena";
import { buildNightMarket, nightMarketData, MARKET_SUN } from "./nightMarket";
import { duskSky } from "./duskSky";
import { applyLightmap, loadLightmap } from "./lightmap";
import { FoodTruck, loadFoodTruck, swingPose, TRUCK_ENTITIES, TRUCK_SWINGS } from "./foodTruck";
import { DOOR_LEAVES } from "./doors";
import { kitPieces, loadMarketKit } from "./kit";
import { loadSurfaceTextures } from "./surfaceTextures";
import { PhysicsWorld, type GrenadePath, type ShotRay } from "./physics";
import { EntityRegistry } from "./entities";
import { WorldEffects } from "./worldEffects";
import { loadPropModels, PropViews } from "./props";
import { type PropPush, type PropState } from "../network/peerRoom";

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
  playAttack: (weapon: WeaponKind, stroke?: KnifeStroke) => void;
  // The mass of everything the player carries, in kilograms.
  setLoad: (kilograms: number) => void;
  // Another player's carried mass, for how hard they shove props.
  setRemoteMass: (peerId: string, kilograms: number) => void;
  // Dropped guns and magazines; ones named in fresh just fell and tumble into place.
  setDrops: (drops: Drop[], fresh: Set<string>) => void;
  // Which doors and hatches are open, from the shared state.
  setOpen: (open: Record<string, boolean>) => void;
  // The closest thing within reach that the player can open or close.
  nearestUse: () => { id: string; label: string; open: boolean } | null;
  // Props this player walked into since the last call, for the coordinating peer to shove.
  takeShoves: () => PropPush[];
  applyShoves: (shoves: PropPush[]) => void;
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

// Gives the browser a chance to paint the loading screen's new step before blocking
// work starts. requestAnimationFrame does not run in a background tab, so a timeout
// stands in for it there.
function paint(): Promise<void> {
  return new Promise((resolve) => { requestAnimationFrame(() => setTimeout(resolve, 0)); setTimeout(resolve, 60); });
}

export async function createMapViewer(container: HTMLElement, arena: Arena, events: MapViewerEvents): Promise<MapViewer> {
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
  const data = nightMarketData();
  events.onStatus("loading", `Loading the ${data.layout.name} and its materials…`);
  events.onProgress?.(0.04, `Loading the ${data.layout.name}`);
  const [textures, lightmap] = await Promise.all([loadSurfaceTextures(), loadLightmap("night-market")]);
  await step(0.45, 0.55, "Building alleys and buildings");
  const scene = new Scene();
  // Dusk: the last low orange light catches the upper floors while the alleys fall into
  // shadow, lit by the market itself. The painted sky is also what surfaces reflect.
  const sunOffset = new Vector3(...MARKET_SUN.offset);
  const sky = duskSky(sunOffset.clone().normalize());
  scene.background = sky;
  scene.environment = sky;
  scene.environmentIntensity = 0.55;
  scene.fog = new FogExp2(0x2a2638, 0.0075);
  scene.add(new HemisphereLight(0x7c88b8, 0x2a2026, 0.85));
  const sun = new DirectionalLight(MARKET_SUN.color, MARKET_SUN.intensity);
  sun.position.copy(sunOffset);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -55;
  sun.shadow.camera.right = 55;
  sun.shadow.camera.top = 55;
  sun.shadow.camera.bottom = -55;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 700;
  sun.shadow.bias = -0.0002;
  sun.shadow.normalBias = 0.035;
  scene.add(sun, sun.target);
  // Every breakable or solid object is an entity with a stable id; refs record the instances
  // that draw each one, and groups the plain objects, so it can disappear when destroyed.
  const entities = new EntityRegistry();
  const [propModels, truckModel, kitModel] = await Promise.all([loadPropModels(), loadFoodTruck(), loadMarketKit()]);
  const propViews = new PropViews(scene);
  const built = buildNightMarket(scene, textures, propModels, kitPieces(kitModel));
  // Baked sky occlusion and bounce light on the static surfaces, when the bake matches.
  if (lightmap) applyLightmap(built.surfaces, lightmap);
  const refs = built.refs;
  const groups = built.groups;
  const ladders = built.ladders;
  const props = built.props;
  for (const entity of built.entities) entities.add(entity);
  // The food truck: its glass, tyres and gas cylinders are entities; its doors and hatch swing.
  const toggleDefaults = Object.fromEntries(data.layout.toggles.map((toggle) => [toggle.id, toggle.open]));
  let toggleState: Record<string, boolean> = { ...toggleDefaults };
  let physicsReady: PhysicsWorld | null = null;
  const truck = new FoodTruck(scene, truckModel, (id, swing, angle) => {
    const pose = swingPose(swing, angle);
    physicsReady?.setMover(`${id}:${swing.node}`, pose.center, pose.rotation);
  });
  for (const entity of TRUCK_ENTITIES) entities.add(entity);
  for (const [id, objects] of truck.groups) groups.set(id, objects);
  await step(0.55, 0.7, "Placing stalls, props and lights");
  await propViews.load(propModels);
  for (const prop of props) { entities.add(prop); propViews.add(prop); }
  propViews.build(props);

  await step(0.7, 0.8, "Starting the renderer");
  const camera = new PerspectiveCamera(75, 1, 0.05, 2000);
  const renderer = new WebGPURenderer({ antialias: false, forceWebGL: new URLSearchParams(window.location.search).get("renderer") === "webgl" });
  const maximumPixelRatio = Math.min(window.devicePixelRatio, 2);
  const minimumPixelRatio = Math.min(maximumPixelRatio, 1.25);
  let pixelRatio = maximumPixelRatio;
  renderer.setPixelRatio(pixelRatio);
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.shadowMap.enabled = true;
  await renderer.init();
  const isWebGPU = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend === true;
  // On WebGPU, clustered lighting lets every lamp, bulb string and sign be a real light at a
  // fixed shading cost; WebGL 2 keeps a handful of lights and painted pools of light instead.
  const clustered = isWebGPU;
  if (clustered) renderer.lighting = new ClusteredLighting();
  built.light(clustered);
  container.appendChild(renderer.domElement);
  await step(0.8, 0.92, "Building physics");
  const physics = new PhysicsWorld(data, arena);
  for (const solid of data.layout.solids) physics.addBox(solid.half, solid.center, solid.rotation ?? { x: 0, y: 0, z: 0, w: 1 }, solid.material);
  for (const entity of entities.all()) physics.addEntity(entity);
  for (const [id, swings] of Object.entries(TRUCK_SWINGS)) for (const swing of swings) physics.addMover(`${id}:${swing.node}`, swing.half, "metal-thin");
  // Door leaves swing with their colliders, which carry their entity so rounds wear them down.
  for (const leaf of DOOR_LEAVES) physics.addMover(leaf.id, leaf.half, leaf.model.material, leaf.id);
  built.doors.setSwing((leaf, pose) => physics.setMover(leaf.id, pose.center, pose.rotation));
  physicsReady = physics;
  truck.setOpen(toggleState, toggleDefaults, true);
  built.doors.setOpen(toggleState, true);
  // A pipe that burst before this peer's first health table only leaks.
  let healthSeen = false;
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
  const soundStage = new SoundStage((peerId) => remotePlayers.position(peerId));
  scene.add(camera);
  const viewScene = new Scene();
  viewScene.environment = scene.environment;
  viewScene.environmentIntensity = scene.environmentIntensity;
  const viewCamera = new PerspectiveCamera(camera.fov, camera.aspect, 0.01, 10);
  viewScene.add(viewCamera);
  // The arms and weapon are lit by the lamps around the player, not a studio light.
  const viewLighting = new ViewLighting(viewScene, built.lightSources, sunOffset.clone().normalize(), sun.intensity, (from, to) => {
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z, distance = Math.hypot(dx, dy, dz);
    return distance < 0.4 || physics.clearShot({ origin: from, direction: { x: dx / distance, y: dy / distance, z: dz / distance }, distance: distance - 0.3 });
  });
  // On WebGPU a muzzle flash lights the alley around the shooter for a moment.
  const muzzleLight = clustered ? new PointLight(0xffb45a, 0, 9, 2) : null;
  if (muzzleLight) scene.add(muzzleLight);
  // The world renders once, writing its colour, depth, normals and how rough and metallic
  // each pixel is; the first-person view renders in its own multisampled pass. The world's
  // buffers feed two screen-space effects at half resolution: ambient occlusion darkens contact and creases the lightmap
  // is too coarse for (and anything that moves, which it cannot hold), and reflections put
  // the lamps, signs and lit windows in the wet paving and glass. The view is laid over the
  // world, smoothed by SMAA (the effects need a depth buffer that multisampling would not
  // give them), by its own coverage (both clear to transparent), then bloom makes lamps, lanterns,
  // neon, lit windows and muzzle flashes glow, a grade cools the shadows and warms the
  // highlights, and a soft vignette frames the picture. After tone mapping, fine film grain
  // breaks up banding and the too-clean look of rendered surfaces. Drawing straight to the
  // canvas after the pipeline would replace its output, so everything goes through it.
  renderer.setClearColor(0x000000, 0);
  const pipeline = new RenderPipeline(renderer);
  const worldPass = pass(scene, camera);
  const world = worldPass.getTextureNode("output");
  // Without a normal buffer GTAO rebuilds normals from depth, which saves writing one.
  const occlusionPass = ao(worldPass.getTextureNode("depth"), null as unknown as Node, camera);
  occlusionPass.resolutionScale = 0.5;
  occlusionPass.radius.value = 0.8;
  occlusionPass.samples.value = 12;
  const occlusion = mix(float(1), occlusionPass.getTextureNode().r, 0.85);
  const lit = smaa(vec4(world.rgb.mul(occlusion), 1)).getTextureNode().rgb;
  const held = pass(viewScene, viewCamera, { samples: 4 }).getTextureNode("output");
  const picture = lit.mul(float(1).sub(held.a)).add(held.rgb);
  const glow = picture.add(bloom(vec4(picture, 1), 0.75, 0.55, 0.9).rgb);
  const brightness = luminance(glow);
  const grade = mix(vec3(0.94, 1.0, 1.07), vec3(1.06, 1.0, 0.93), smoothstep(0.02, 0.5, brightness));
  const graded = mix(vec3(brightness), glow, 1.08).mul(grade).max(0);
  const vignette = float(1).sub(smoothstep(0.32, 0.95, screenUV.sub(0.5).length()).mul(0.42));
  pipeline.outputColorTransform = false;
  pipeline.outputNode = film(renderOutput(vec4(graded.mul(vignette), 1)), float(0.06));
  const pickupData = makeWeaponPickups(data);
  const weaponVisuals = new WeaponVisuals(viewCamera, scene, data, pickupData);
  const authoredViewModel = new AuthoredViewModel(viewCamera);
  // Pickups and other players use the first-person weapon models once they load.
  void loadWeaponModels().then((models) => {
    weaponVisuals.useModels(models);
    remotePlayers.setWeaponModels(models);
  });
  const shotEffects = new ShotEffects(scene);
  const loot = new LootViews(scene, pickupData);
  void loadWeaponModels().then((models) => loot.setWeaponModels(models));
  const ejecta = new Ejecta(scene, (origin, direction, distance) => physics.sweep(origin, direction, distance));
  const remoteMass = new Map<string, number>();
  let muzzleGlow = 0;
  // Where the camera was and how fast it moved, for what spent cases inherit.
  const eyeVelocity = new Vector3();
  const lastEye = new Vector3();
  const flashAt = (at: Vector3, strength: number): void => {
    if (!muzzleLight) return;
    muzzleLight.position.copy(at);
    muzzleGlow = Math.max(muzzleGlow, strength);
  };
  // A spent case from the local gun's ejection port, behind the muzzle on the right side.
  const ejectLocal = (gun: GunKind): void => {
    const muzzle = (authoredViewModel.muzzle() ?? weaponVisuals.muzzle())?.applyMatrix4(camera.matrixWorld);
    const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0), up = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    const forward = new Vector3().setFromMatrixColumn(camera.matrixWorld, 2).negate();
    const port = (muzzle ?? camera.position.clone().addScaledVector(forward, 0.6).addScaledVector(up, -0.15)).addScaledVector(forward, gun === "rifle" ? -0.33 : -0.13).addScaledVector(right, 0.02).addScaledVector(up, 0.03);
    ejecta.ejectCase(gun, port, right, forward, eyeVelocity);
  };
  const effects = new WorldEffects(scene, data, refs, () => camera.position, groups);
  // What the coordinating peer asks of this world when it resolves shots and blasts.
  const combatWorld: CombatWorld = {
    clearShot: (ray) => physics.clearShot(ray),
    traceBullet: (ray) => physics.traceBullet(ray, (point) => entities.windowAt(point)?.id ?? null),
    entity: (id) => {
      const entity = entities.get(id);
      return entity && !entities.destroyed(id) ? { material: entity.material, maxHealth: entity.maxHealth, center: entity.center, explosive: entity.explosive } : null;
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
    // Other players shove props on the coordinating peer before the world steps.
    const present = new Set<string>();
    remotePlayers.each((peerId, feet, pose, dead) => {
      if (dead) return;
      present.add(peerId);
      physics.movePusher(peerId, feet.x, feet.z, feet.y, pose.crouching, 80 + (remoteMass.get(peerId) ?? 1));
    });
    for (const id of physics.pusherIds()) if (!present.has(id)) physics.removePusher(id);
    player.update(delta);
    camera.updateMatrixWorld();
    const eye = camera.position.clone();
    if (delta > 0) eyeVelocity.copy(eye).sub(lastEye).divideScalar(delta);
    if (eyeVelocity.length() > 15) eyeVelocity.set(0, 0, 0);
    lastEye.copy(eye);
    const axes = { right: new Vector3().setFromMatrixColumn(camera.matrixWorld, 0), up: new Vector3().setFromMatrixColumn(camera.matrixWorld, 1), forward: new Vector3().setFromMatrixColumn(camera.matrixWorld, 2).negate() };
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
    loot.update(Math.min(delta, 0.1));
    ejecta.update(delta);
    if (muzzleLight) { muzzleLight.intensity = muzzleGlow * 40; muzzleGlow *= Math.exp(-Math.min(delta, 0.1) * 40); }
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
    // The spring sway works in world terms: the eyes' acceleration along the camera's own axes.
    weaponVisuals.update(delta, player.motion(), pose.heading, pose.pitch, eye, axes);
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
    built.update(time / 1000);
    truck.update(Math.min(delta, 0.1));
    sun.target.position.set(camera.position.x, 0, camera.position.z);
    sun.position.set(camera.position.x + sunOffset.x, sunOffset.y, camera.position.z + sunOffset.z);
    sun.target.updateMatrixWorld();
    previousFrame = time;
    viewCamera.aspect = camera.aspect;
    viewCamera.fov = camera.fov;
    viewCamera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    viewLighting.update(Math.min(delta, 0.1), camera);
    pipeline.render();
    frames += 1;
    renderedFrames += 1;
    if (renderedFrames === 1) { DefaultLoadingManager.onProgress = () => undefined; events.onProgress?.(0.92, "Preparing shaders"); }
    if (!readySent && renderedFrames >= 2) {
      events.onStatus("ready", `${data.layout.name} loaded. Use arrow keys to move and drag on the map to look around.`);
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
        drawCalls: renderer.info.render.drawCalls,
        triangles: renderer.info.render.triangles,
        pixelRatio,
      });
      frames = 0;
      lastMetrics = time;
    }
  });

  return {
    arenaData() { return data; },
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
      loot.setTaken(taken);
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
          truck.restore(entity.id);
          if (entity.kind === "lamp") built.lamps.setBroken(entity.id, false);
          if (entity.kind === "door") physics.setMoverEnabled(entity.id, true);
          if (entity.kind === "pipe") built.pipes.restore(entity.id);
          // A stall back in place brings its lamp back, unless the lamp itself was shot.
          const stallLamp = entity.kind === "stall" ? `lamp:${entity.id}` : "";
          if (stallLamp && (health[stallLamp] ?? 1) > 0) { built.lamps.setBroken(stallLamp, false); physics.restoreEntity(stallLamp); }
          if (entity.kind === "prop") propViews.setVisible(entity.id, true);
        }
      }
      if (!Object.keys(health).length) entities.resetHealth();
      for (const entity of entities.applyHealth(health)) {
        const at = physics.propPose(entity.id)?.position ?? physics.moverCenter(entity.id);
        physics.removeEntity(entity.id);
        effects.destroy(at ? { ...entity, center: at } : entity);
        if (entity.kind === "prop") propViews.setVisible(entity.id, false);
        if (entity.kind === "tyre") truck.setFlat(entity.id, true);
        if (entity.kind === "lamp") built.lamps.setBroken(entity.id, true);
        if (entity.kind === "door") physics.setMoverEnabled(entity.id, false);
        if (entity.kind === "pipe") {
          built.pipes.burst(entity.id, healthSeen);
          if (healthSeen) gameAudio.steamBurst(entity.center);
        }
        // A stall's lamp goes down with it.
        if (entity.kind === "stall") { built.lamps.setBroken(`lamp:${entity.id}`, true); physics.removeEntity(`lamp:${entity.id}`); }
        // A cylinder bursts when its explosion arrives; this catches one that burst before
        // this peer joined.
        if (entity.kind === "tank") window.setTimeout(() => truck.burst(entity.id), 2200);
      }
      healthSeen = true;
    },
    playEvent(event, selfId) {
      soundStage.combat(event, selfId);
      const own = event.actor === selfId;
      if (event.kind === "shot") {
        if (event.weapon === "knife" && own && event.impact) {
          // The blade met something hard and turned.
          authoredViewModel.deflect();
          const strike = event.impacts?.[0];
          if (strike) gameAudio.blade(strike, !["wood", "timber", "cardboard", "plastic", "glass"].includes(strike.material));
        } else if (event.weapon === "knife" && event.impact) {
          const strike = event.impacts?.[0];
          if (strike) gameAudio.blade(strike, !["wood", "timber", "cardboard", "plastic", "glass"].includes(strike.material));
        }
        if (!own && event.weapon) {
          remotePlayers.attack(event.actor, event.weapon, event.stroke);
          if (event.weapon !== "knife") {
            const hands = remotePlayers.hands(event.actor);
            if (hands) {
              const yaw = hands.heading * Math.PI / 180;
              const right = new Vector3(-Math.cos(yaw), 0, Math.sin(yaw)), forward = new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
              ejecta.ejectCase(event.weapon, hands.position.clone().addScaledVector(right, 0.03), right, forward);
              flashAt(hands.position.clone().addScaledVector(forward, event.weapon === "rifle" ? 0.7 : 0.35), 1);
            }
          }
        }
      }
      if (event.kind === "reload" && event.dropped && event.weapon && event.weapon !== "knife") {
        const gun = event.weapon;
        if (own) {
          // The empty magazine falls from under the gun as the reload starts.
          const down = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1).negate(), forward = new Vector3().setFromMatrixColumn(camera.matrixWorld, 2).negate();
          ejecta.dropMagazine(gun, camera.position.clone().addScaledVector(forward, 0.45).addScaledVector(down, 0.35), eyeVelocity);
        } else {
          const hands = remotePlayers.hands(event.actor);
          if (hands) ejecta.dropMagazine(gun, hands.position.clone().add(new Vector3(0, -0.15, 0)));
        }
      }
      if ((event.kind === "hit" || event.kind === "death") && own && event.cause === "knife") authoredViewModel.bite();
      // A blade or a heavy round knocks the body back a little.
      if ((event.kind === "hit" || event.kind === "death") && event.target === selfId && event.from && (event.cause === "knife" || event.cause === "rifle")) {
        const dx = camera.position.x - event.from.x, dz = camera.position.z - event.from.z, length = Math.hypot(dx, dz) || 1;
        const strength = event.cause === "knife" ? (event.stroke === "stab" ? 1.8 : 1.1) : 0.6;
        player.shove(dx / length * strength, dz / length * strength);
      }
      // A blast in the open throws the player away from it; cover shelters them.
      if (event.kind === "vent" && event.entity && event.position) {
        truck.vent(event.entity, (event.fuseMs ?? 1600) / 1000);
        gameAudio.vent(event.position, (event.fuseMs ?? 1600) / 1000);
      }
      if (event.kind === "explode" && event.entity) truck.burst(event.entity);
      if (event.kind === "use" && event.entity) {
        const toggle = data.layout.toggles.find((item) => item.id === event.entity);
        if (toggle) gameAudio.hinge(toggle.at, event.open === true, event.entity.endsWith("hatch"));
        // A kicked door bangs open.
        if (toggle && event.weapon === "knife") gameAudio.kick(toggle.at);
      }
      if (event.kind === "explode" && event.position) {
        const at = event.position, chest = { x: camera.position.x, y: camera.position.y - 0.6, z: camera.position.z };
        const dx = chest.x - at.x, dy = chest.y - at.y, dz = chest.z - at.z, distance = Math.hypot(dx, dy, dz);
        const open = distance < 0.5 || physics.clearShot({ origin: { x: at.x, y: at.y + 0.2, z: at.z }, direction: { x: dx / distance, y: (dy - 0.2) / distance, z: dz / distance }, distance: Math.max(0, distance - 0.4) });
        if (distance < BLAST_RADIUS && open) {
          const strength = 7 * (1 - distance / BLAST_RADIUS) ** 1.5, flat = Math.hypot(dx, dz) || 1;
          player.shove(dx / flat * strength, dz / flat * strength, strength * 0.45);
        }
        flashAt(new Vector3(at.x, at.y + 0.4, at.z), 4);
      }
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
    resetWorld() { physics.resetProps(); ejecta.clear(); loot.clear(); },
    setOpen(open) {
      toggleState = { ...toggleDefaults, ...open };
      truck.setOpen(toggleState, toggleDefaults);
      built.doors.setOpen(toggleState);
    },
    nearestUse() {
      const eye = camera.position;
      let best: { id: string; label: string; open: boolean; distance: number } | null = null;
      for (const toggle of data.layout.toggles) {
        // A doorway whose leaves are all blown off has nothing left to open.
        const leaves = DOOR_LEAVES.filter((leaf) => leaf.door.id === toggle.id);
        if (leaves.length && leaves.every((leaf) => entities.destroyed(leaf.id))) continue;
        const distance = Math.hypot(eye.x - toggle.at.x, eye.y - toggle.at.y, eye.z - toggle.at.z);
        if (distance <= 2.2 && (!best || distance < best.distance)) best = { id: toggle.id, label: toggle.label, open: toggleState[toggle.id] ?? toggle.open, distance };
      }
      return best;
    },
    setLocalDead(dead) {
      if (dead && !deathView) deathView = { position: camera.position.clone(), quaternion: camera.quaternion.clone(), time: 0 };
      if (!dead) deathView = null;
    },
    playAttack(weapon, stroke) {
      weaponVisuals.attack();
      authoredViewModel.fire(weapon === "knife" ? stroke ?? "slash" : undefined);
      gameAudio.fire(weapon, stroke === "stab");
      if (weapon === "knife") {
        // The body turns into a slash and steps into a stab as the arm drives forward.
        if (stroke === "stab") window.setTimeout(() => {
          const yaw = player.pose().heading * Math.PI / 180;
          player.shove(Math.sin(yaw) * 2.8, Math.cos(yaw) * 2.8, 0, true);
          player.swingView(0.025);
        }, KNIFE.stab.contactMs - 90);
        else window.setTimeout(() => player.swingView(-0.05), 40);
        return;
      }
      const now = performance.now();
      localBloom = bloomAfterShot(weapon, localBloom, (now - lastLocalShot) / 1000);
      lastLocalShot = now;
      player.kickRecoil(weapon === "rifle" ? 0.7 : 1.2);
      ejectLocal(weapon);
      viewLighting.muzzleFlash(authoredViewModel.muzzle() ?? weaponVisuals.muzzle(), weapon === "rifle" ? 1.2 : 1);
      flashAt(camera.position.clone().add(new Vector3().setFromMatrixColumn(camera.matrixWorld, 2).multiplyScalar(-0.8)), 1);
    },
    setLoad(kilograms) { player.setLoad(kilograms); },
    takeShoves() { return physics.takeShoves(); },
    applyShoves(shoves) { physics.applyShoves(shoves); },
    setRemoteMass(peerId, kilograms) { remoteMass.set(peerId, kilograms); },
    setDrops(drops, fresh) {
      const falling = new Map<string, GrenadePath>();
      for (const drop of drops) if (fresh.has(drop.id)) falling.set(drop.id, physics.grenadePath(drop.from, drop.velocity, 1.6));
      loot.setDrops(drops, falling);
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
      built.dispose();
      truck.dispose();
      sky.dispose();
      pipeline.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
