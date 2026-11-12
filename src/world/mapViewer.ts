import {
  ACESFilmicToneMapping, DirectionalLight, Group, HemisphereLight, Matrix4, Mesh, MeshBasicMaterial, Object3D, PCFShadowMap, PerspectiveCamera, PlaneGeometry, PointLight, Quaternion,
  RenderPipeline, Scene, Vector3, DefaultLoadingManager, WebGPURenderer, LineSegments, type BufferGeometry, type Node,
} from "three/webgpu";
import { float, getViewPosition, int, length, rtt, luminance, mix, mrt, normalize, normalView, output as sceneOutput, pass, renderOutput, screenUV, smoothstep, step as below, uniform, uv, vec3, vec4 } from "three/tsl";
import { radialBlur } from "three/addons/tsl/display/radialBlur.js";
import { aimShafts, ATMOSPHERE, atmosphere, sunward } from "./atmosphere";
import { ssr } from "three/addons/tsl/display/SSRNode.js";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { ao } from "three/addons/tsl/display/GTAONode.js";
import { film } from "three/addons/tsl/display/FilmNode.js";
import { smaa } from "three/addons/tsl/display/SMAANode.js";
import { FixedGridLighting } from "./fixedClusters";
import { QUALITY, type GraphicsQuality } from "./quality";
import { puddleNode, rainTime } from "./wetness";
import { Rain } from "./rain";
import { PlayerController, type PlayerPose } from "../game/playerController";
import { RemotePlayers } from "../game/remotePlayers";
import { AuthoredViewModel } from "../game/authoredViewModel";
import { PlayerModelLibrary } from "../game/playerModel";
import { ShotEffects } from "../game/shotEffects";
import { BLAST_RADIUS, type CombatEvent, type CombatWorld, type Drop, type Fire } from "../game/matchState";
import { ViewLighting } from "../game/viewLighting";
import { LootViews } from "../game/loot";
import { Ejecta } from "../game/ejecta";
import { WeaponVisuals } from "../game/weaponVisuals";
import { loadWeaponModels } from "../game/weaponModels";
import { gameAudio, type AmbientSource } from "../game/gameAudio";
import { CONDENSER_SPOTS } from "./facades";
import { SoundStage } from "../game/soundStage";
import { TOOL_MASS, armCarry, armSpread, armThrow, bloomAfterShot, CARRY_REACH, currentBloom, makeWeaponPickups, spreadDegrees, THROW_CHARGE_MS, throwSpeed, BODY_MASS, type GunKind, type WeaponKind } from "../game/combatRules";
import { type Arena, type ArenaData } from "./arena";
import { buildNightMarket, nightMarketData, MARKET_FILL, MARKET_SUN, STOVES } from "./nightMarket";
import { duskSky } from "./duskSky";
import { applyLightmap, loadLightmap } from "./lightmap";
import { FoodTruck, loadFoodTruck, swingPose, TRUCK_ENTITIES, TRUCK_SWINGS } from "./foodTruck";
import { DOOR_LEAVES } from "./doors";
import { kitObject, kitPieces, loadKits } from "./kit";
import { handsOutOfView, inCameraFrame, propHold, type HeldThing } from "../game/holding";
import { SMOKE } from "./steamPipes";
import { loadSurfaceTextures } from "./surfaceTextures";
import { PhysicsWorld, type GrenadePath, type ShotRay, type Strike, type StrikeTarget } from "./physics";
import { EntityRegistry } from "./entities";
import { WorldEffects, type FlameSpot } from "./worldEffects";
import { FUEL_DRUM, FURNITURE, loadPropModels, PROP_LABEL, PropViews } from "./props";
import { aroundBreach, BreachViews } from "./breaches";
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
  // Current hip-fire spread as a crosshair gap in CSS pixels.
  onAim?: (spreadPixels: number, aiming: boolean) => void;
  // Loading progress from 0 to 1, with the step under way when it changes.
  // Building the world, step by step: textures, buildings, props, renderer, physics, shaders.
  onStep?: (step: BuildStep) => void;
  // How far through its files the current step is, from 0 to 1.
  onStepProgress?: (step: BuildStep, fraction: number) => void;
  // A landing at this speed (m/s), fast enough that it may hurt.
  onHardLanding?: (speed: number) => void;
}

export interface MapViewer {
  arenaData: () => ArenaData;
  // Pausing stops the player; releaseMouse also frees a locked mouse, for a dialog.
  setPaused: (paused: boolean, releaseMouse: boolean) => void;
  lockPointer: () => void;
  playerPose: () => PlayerPose;
  clearShot: (ray: ShotRay) => boolean;
  traceShot: (ray: ShotRay) => number;
  showShot: (event: CombatEvent, local: boolean) => void;
  setSpawnSlot: (slot: number) => void;
  respawn: () => void;
  // Hold to aim down the sights of the gun in hand; false to stop.
  setAiming: (aiming: boolean) => void;
  setWeapon: (kind: WeaponKind) => void;
  setTakenPickups: (taken: string[]) => void;
  weaponReady: () => boolean;
  // The hands are busy for this long with food or a drink; the weapon dips out of the way.
  busyHands: (seconds: number) => void;
  startRush: (seconds: number) => void;
  holdSprint: (seconds: number) => void;
  combatWorld: () => CombatWorld;
  setEntityHealth: (health: Record<string, number>) => void;
  playEvent: (event: CombatEvent, selfId: string) => void;
  seenTimes: () => Record<string, number>;
  flinch: (damage: number) => void;
  remoteFlinch: (peerId: string, damage: number) => void;
  remotePosition: (peerId: string) => { x: number; y: number; z: number } | null;
  setLocalDead: (dead: boolean) => void;
  propTraffic: (leading: boolean) => { moving: PropState[]; settled: PropState[] };
  displacedProps: () => PropState[];
  applyPropStates: (states: PropState[], owner: string, rest: boolean, self: string) => void;
  resetWorld: () => void;
  quickThrow: () => void;
  playAttack: (weapon: WeaponKind) => void;
  // The mass of everything the player carries, in kilograms.
  setLoad: (kilograms: number) => void;
  // Dropped guns and magazines; ones named in fresh just fell and tumble into place.
  setDrops: (drops: Drop[], fresh: Set<string>) => void;
  // Which doors and hatches are open, from the shared state.
  setOpen: (open: Record<string, boolean>) => void;
  // The closest thing within reach that the player can open or close.
  nearestUse: () => { id: string; label: string; open: boolean; verb: string } | null;
  // Props another peer owns that this player pushed since the last call, by that peer.
  takeShoves: () => Map<string, PropPush[]>;
  applyShoves: (shoves: PropPush[]) => void;
  // What the player holds in both hands, and the loose prop they are looking at within reach,
  // heavy being too much to lift.
  holding: () => { id: string; mass: number } | null;
  liftable: () => { id: string; label: string; mass: number; heavy: boolean } | null;
  lift: (id: string) => boolean;
  putDown: () => void;
  // Holding the throw draws it back; letting go throws, harder the longer it was held.
  beginThrow: () => void;
  releaseThrow: () => void;
  cancelThrow: () => void;
  // What loose props this peer simulates have done since the last call.
  takeStrikes: () => Strike[];
  takeSmashes: () => [string, number][];
  takeKnocks: () => [string, number][];
  // Knocks of loose props, by id and how much their speed changed, to be heard.
  hearKnocks: (knocks: [string, number][]) => void;
  startReload: (weapon: WeaponKind, durationMs: number) => void;
  cancelReload: () => void;
  combatSound: (event: CombatEvent, selfId: string) => void;
  remoteReload: (peerId: string, weapon: WeaponKind) => void;
  setRemotePose: (peerId: string, pose: PlayerPose, sentAt?: number) => void;
  setRemoteHealth: (peerId: string, health: number) => void;
  // How bad this player's own wounds are, 0 to 1, and another player's leg.
  setFires: (fires: Fire[]) => void;
  setBurning: (peers: string[]) => void;
  // Whether the player holds an extinguisher, and whether another player does.
  setTool: (held: boolean) => void;
  setRemoteTool: (peerId: string, held: boolean) => void;
  setWounds: (leg: number, arm: number) => void;
  setRemoteLeg: (peerId: string, leg: number) => void;
  // Blood falling from another player who is bleeding.
  dripBlood: (peerId: string) => void;
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

// The tone mapping's exposure, which SMAA's edge detection also uses.
const EXPOSURE = 1.0;
// The first frames reveal the market in this many slices, building each slice's shaders.
const WARM_SLICES = 16;
// The sun's shadow map is redrawn once in this many frames.
const SHADOW_EVERY = 4;

export type BuildStep = "textures" | "buildings" | "props" | "renderer" | "physics" | "shaders";

export async function createMapViewer(container: HTMLElement, arena: Arena, events: MapViewerEvents, quality: GraphicsQuality = QUALITY.high): Promise<MapViewer> {
  // Each step is reported as it starts, with the files that finish during it (Three.js loaders
  // report them to the default manager), so the loading screen can show how far it is.
  let current: BuildStep = "textures";
  DefaultLoadingManager.onProgress = (_url, loaded, total) => { if (total > 0) events.onStepProgress?.(current, loaded / total); };
  const step = async (next: BuildStep): Promise<void> => {
    current = next;
    events.onStep?.(next);
    await paint();
  };
  const data = nightMarketData();
  events.onStatus("loading", `Loading the ${data.layout.name} and its materials…`);
  events.onStep?.("textures");
  const [textures, lightmap] = await Promise.all([loadSurfaceTextures(), loadLightmap("night-market")]);
  await step("buildings");
  const scene = new Scene();
  // The end of a wet afternoon: a low sun at the north end of the main alley shines down it
  // through the haze, backlighting the market, while the cross alleys lie in shadow, lit by the
  // grey sky and the market's lamps. The painted sky is also what surfaces reflect. The haze
  // itself is laid over the finished picture (atmosphere.ts), not drawn as fog.
  const sunOffset = new Vector3(...MARKET_SUN.offset);
  const sky = duskSky(sunOffset.clone().normalize());
  scene.background = sky;
  scene.environment = sky;
  scene.environmentIntensity = 0.55;
  ATMOSPHERE.toSun.value.copy(sunOffset).normalize();
  const fill = new HemisphereLight(MARKET_FILL.sky, MARKET_FILL.ground, MARKET_FILL.intensity);
  scene.add(fill);
  const sun = new DirectionalLight(MARKET_SUN.color, MARKET_SUN.intensity);
  sun.position.copy(sunOffset);
  sun.castShadow = quality.shadows;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -55;
  sun.shadow.camera.right = 55;
  sun.shadow.camera.top = 55;
  sun.shadow.camera.bottom = -55;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 700;
  sun.shadow.bias = -0.0002;
  sun.shadow.normalBias = 0.035;
  // The shadow map covers the whole map from a fixed place and is redrawn every fourth frame
  // (SHADOW_EVERY), so shoved props, swinging doors and players cast moving shadows. Redrawing it
  // every frame took about 150 objects through the renderer each frame, a fifth of its work.
  sun.shadow.autoUpdate = false;
  sun.shadow.needsUpdate = true;
  scene.add(sun, sun.target);
  // Every breakable or solid object is an entity with a stable id; refs record the instances
  // that draw each one, and groups the plain objects, so it can disappear when destroyed.
  const entities = new EntityRegistry();
  const [propModels, truckModel, kitModels] = await Promise.all([loadPropModels(), loadFoodTruck(), loadKits()]);
  const propViews = new PropViews(scene);
  const pieces = kitPieces(kitModels);
  const built = buildNightMarket(scene, textures, propModels, pieces);
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
  await step("props");
  await propViews.load(propModels);
  for (const { name } of [FUEL_DRUM, ...FURNITURE]) propViews.addModel(name, pieces.get(name)?.parts ?? []);
  for (const prop of props) { entities.add(prop); propViews.add(prop); }
  propViews.build(props);

  await step("renderer");
  const camera = new PerspectiveCamera(75, 1, 0.05, 2000);
  // Smoke, steam and powder draw in a scene of their own, laid over the world after its
  // ambient occlusion. Inside a cloud, a grey haze just in front of the eyes covers the world
  // (the hands and weapon draw in their own pass, over it).
  const cloudScene = new Scene();
  const haze = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ color: 0x8e908c, transparent: true, opacity: 0, depthTest: false, depthWrite: false }));
  haze.renderOrder = 20;
  haze.frustumCulled = false;
  haze.visible = false;
  cloudScene.add(haze);
  let hazeLevel = 0;
  // The page's own canvas, if it has one: the setup screen locks the mouse to it on Deploy,
  // before the world exists.
  const canvas = container.querySelector("canvas") ?? undefined;
  const renderer = new WebGPURenderer({ antialias: false, canvas, forceWebGL: new URLSearchParams(window.location.search).get("renderer") === "webgl" });
  // The world renders at most `budget` pixels, at up to twice the CSS resolution. A large
  // Retina screen or an external display would otherwise multiply the cost of every lit
  // pixel. Changing the drawing size rebuilds every shader (the clustered lights fit their
  // grid to it), which can stall the page for seconds, so the size is chosen when the window
  // settles and lowered at most twice during play, never raised again. It never goes below the
  // CSS resolution: under it every edge turns to visible blocks of pixels.
  let budget = 4.2e6;
  const floorRatio = Math.min(1, window.devicePixelRatio);
  const ratioFor = (width: number, height: number): number => Math.max(floorRatio, Math.min(window.devicePixelRatio, 2, Math.sqrt(budget / (width * height))));
  let pixelRatio = ratioFor(Math.max(1, container.clientWidth), Math.max(1, container.clientHeight));
  renderer.setPixelRatio(pixelRatio);
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = EXPOSURE;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.shadowMap.enabled = true;
  await renderer.init();
  // If the graphics device gives up, say so rather than leave the last frame frozen on screen.
  renderer.onDeviceLost = (info) => {
    console.error(`Graphics device lost: ${info.message}`);
    events.onStatus("error", "The graphics device stopped responding");
  };
  const isWebGPU = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend === true;
  // On WebGPU, clustered lighting lets every lamp, bulb string and sign be a real light at a
  // fixed shading cost; WebGL 2 and the low preset keep a handful of lights and painted pools of
  // light instead.
  const clustered = isWebGPU && quality.manyLights;
  // A fixed 40 × 24 grid of tiles and 16 depth slices (fixedClusters.ts), so resizing never
  // rebuilds shaders; ninety lights fit 48 to a cluster.
  if (clustered) renderer.lighting = new FixedGridLighting(1024, 64, 16, 48);
  built.light(clustered);
  if (renderer.domElement.parentElement !== container) container.appendChild(renderer.domElement);
  await step("physics");
  const physics = new PhysicsWorld(data, arena);
  for (const solid of data.layout.solids) for (const piece of aroundBreach(solid)) physics.addBox(piece.half, piece.center, piece.rotation ?? { x: 0, y: 0, z: 0, w: 1 }, piece.material);
  for (const entity of entities.all()) physics.addEntity(entity);
  for (const [id, swings] of Object.entries(TRUCK_SWINGS)) for (const swing of swings) physics.addMover(`${id}:${swing.node}`, swing.half, "metal-thin");
  // A broken stall leaves a low pile, solid only once the stall is down.
  for (const wreck of built.wrecks) {
    physics.addMover(wreck.id, wreck.half, "wood");
    physics.setMover(wreck.id, wreck.center, wreck.rotation);
    physics.setMoverEnabled(wreck.id, false);
  }
  physicsReady = physics;
  truck.setOpen(toggleState, toggleDefaults, true);
  // A pipe that burst before this peer's first health table only leaks.
  let healthSeen = false;
  // A fuel drum gone up: its body and collider go; the blast draws the rest.
  const burstProp = (id: string): void => {
    if (!entities.destroyed(id)) return;
    physics.removeEntity(id);
    propViews.setVisible(id, false);
  };
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
  // Reflections need each pixel's normal, so with them the world pass also writes a normal
  // buffer, which ambient occlusion then reads too. Without one, GTAO rebuilds normals from depth.
  if (quality.reflections) worldPass.setMRT(mrt({ output: sceneOutput, normal: normalView }));
  const normals = quality.reflections ? worldPass.getTextureNode("normal") : null;
  const world = worldPass.getTextureNode("output");
  let occlusion: Node<"float"> = float(1);
  if (quality.occlusion) {
    const occlusionPass = ao(worldPass.getTextureNode("depth"), (normals ?? null) as unknown as Node, camera);
    occlusionPass.resolutionScale = quality.occlusion.scale;
    occlusionPass.radius.value = 0.8;
    occlusionPass.samples.value = quality.occlusion.samples;
    occlusion = mix(float(1), occlusionPass.getTextureNode().r, 0.85);
  }
  // SMAA finds edges by differences in colour, and in linear light the night market is so dark
  // that a dim door frame against a dark wall differs by less than its threshold, so most edges
  // went unsmoothed. It sees the world at the game's exposure and gamma-encoded, as the eye
  // does, and the result is decoded back to linear light. (After tone mapping would be simpler,
  // but the passes it reads would then render inside SMAA's own pass and clear to black.)
  let occluded: Node<"vec3"> = world.rgb.mul(occlusion);
  // Puddles mirror the lamps, signs and lit windows. The reflection pass finds standing water
  // itself: it rebuilds each pixel's place in the world from its depth and looks the puddle mask
  // up there (wetness.ts), on the ground only. Everything that is not a puddle is skipped at
  // once, so rays are only traced where there is water.
  const reflectFrom = { inverseProjection: uniform(new Matrix4()), world: uniform(new Matrix4()) };
  const eyeHeight = uniform(0);
  if (normals) {
    const depth = worldPass.getTextureNode("depth");
    const at = reflectFrom.world.mul(vec4(getViewPosition(uv(), depth.sample(uv()).r, reflectFrom.inverseProjection), 1)).xyz;
    const water = puddleNode(at).mul(below(at.y, float(0.06))).mul(0.9);
    const mirror = ssr(world, depth, normals as unknown as Node<"vec3">, { metalnessNode: water, roughnessNode: float(0.32), camera });
    mirror.resolutionScale = 0.5;
    mirror.quality.value = 0.5;
    mirror.maxDistance.value = 30;
    mirror.thickness.value = 0.25;
    // The pass fades a reflection with distance and grazing angle; standing water mirrors the
    // lamps and sunlit walls more strongly than that leaves, so it is lifted. A rough 0.32 blurs it
    // through the pass's mip chain, which hides the half-resolution pixels.
    occluded = occluded.add(mirror.getTextureNode().rgb.mul(2));
  }
  const shaded = quality.smaa ? smaa(vec4(occluded.mul(EXPOSURE).max(0).pow(float(1 / 2.2)), 1)).getTextureNode().rgb.pow(float(2.2)).div(EXPOSURE) : occluded;
  built.pipes.setStage(cloudScene, worldPass.getTextureNode("depth"));
  // Rain round the player (rain.ts), in the clouds' scene too; how many drops depends on the preset.
  const rain = new Rain(cloudScene, quality.raindrops, worldPass.getTextureNode("depth"));
  const clouds = pass(cloudScene, camera).getTextureNode("output");
  const smoked = shaded.mul(float(1).sub(clouds.a)).add(clouds.rgb);
  // The haze, the light shafts and the sun (atmosphere.ts). Each pixel's distance and direction
  // come from its depth; the sky is where nothing was drawn. The shafts march the sun's shadow
  // are the open sky round the sun, smeared toward the sun's place on the screen, so the edges
  // of roofs, cables and signs cut beams through the haze when the player looks toward it.
  const sceneDepth = worldPass.getTextureNode("depth");
  const viewAt = getViewPosition(uv(), sceneDepth.sample(uv()).r, reflectFrom.inverseProjection);
  const lookDirection = normalize(reflectFrom.world.mul(vec4(viewAt, 0)).xyz);
  const isSky = below(float(0.999999), sceneDepth.sample(uv()).r);
  // Both the opening and its blur are drawn at a quarter of the resolution: the beams are soft anyway.
  const opening = rtt(vec4(vec3(isSky.mul(sunward(lookDirection))), 1), null, null, { resolutionScale: 0.25 });
  const shafts = (rtt(radialBlur(opening, { center: ATMOSPHERE.sunScreen, count: int(24), weight: float(0.85), decay: float(0.96), exposure: float(1.6) }), null, null, { resolutionScale: 0.25 }) as unknown as Node<"vec4">).r.mul(ATMOSPHERE.sunInView);
  const lit = atmosphere(smoked, length(viewAt), lookDirection, eyeHeight, isSky, shafts);
  const held = pass(viewScene, viewCamera, { samples: quality.viewSamples }).getTextureNode("output");
  const picture = lit.mul(float(1).sub(held.a)).add(held.rgb);
  // A tight glow, so lit windows and signs keep their frames readable, and a wide halo that only
  // the sun and the brightest haze round it reach, as light spreads in a real lens.
  const glow = quality.bloom ? picture.add(bloom(vec4(picture, 1), 0.45, 0.4, 0.9).rgb).add(bloom(vec4(picture, 1), 0.5, 1, 2.2).rgb) : picture;
  const brightness = luminance(glow);
  const grade = mix(vec3(0.94, 1.0, 1.07), vec3(1.06, 1.0, 0.93), smoothstep(0.02, 0.5, brightness));
  // Colour a little below full strength: with so many warm lamps, full colour turns every
  // surface the same orange.
  const graded = mix(vec3(brightness), glow, 0.82).mul(grade).max(0);
  const vignette = float(1).sub(smoothstep(0.32, 0.95, screenUV.sub(0.5).length()).mul(0.42));
  pipeline.outputColorTransform = false;
  const output = renderOutput(vec4(graded.mul(vignette), 1));
  pipeline.outputNode = quality.grain ? film(output, float(0.06)) : output;
  const pickupData = makeWeaponPickups(data);
  const weaponVisuals = new WeaponVisuals(scene, data, pickupData, pieces);
  const authoredViewModel = new AuthoredViewModel(viewCamera);
  // The hands are drawn over the world, so what they hold is copied into their layer, writing only
  // depth: the parts of a hand under or behind it are hidden as they would be, and the thing
  // itself still shows from the world beneath.
  const handCover = new Group();
  handCover.matrixAutoUpdate = false;
  handCover.visible = false;
  viewScene.add(handCover);
  const depthOnly = new MeshBasicMaterial({ colorWrite: false });
  let coverOf = "", coverDrop = 0;
  const coverHands = (thing: HeldThing | null): void => {
    handCover.visible = thing !== null;
    if (!thing) return;
    if (coverOf !== thing.id) {
      handCover.clear();
      const model = propViews.partsOf(thing.id);
      coverOf = thing.id;
      coverDrop = model?.drop ?? 0;
      for (const part of model?.parts ?? []) {
        const mesh = new Mesh(part.geometry, depthOnly);
        mesh.matrixAutoUpdate = false;
        mesh.matrix.copy(part.matrix);
        mesh.renderOrder = 40;
        mesh.frustumCulled = false;
        handCover.add(mesh);
      }
    }
    const body = new Matrix4().compose(new Vector3(thing.position.x, thing.position.y, thing.position.z), new Quaternion(thing.rotation.x, thing.rotation.y, thing.rotation.z, thing.rotation.w), new Vector3(1, 1, 1)).multiply(new Matrix4().makeTranslation(0, -coverDrop, 0));
    handCover.matrix.multiplyMatrices(viewCamera.matrixWorld, camera.matrixWorldInverse).multiply(body);
    handCover.matrixWorldNeedsUpdate = true;
  };
  authoredViewModel.setTool(kitObject(pieces.get("extinguisher_held")));
  remotePlayers.setToolModel(kitObject(pieces.get("extinguisher_held")));
  // Pickups and other players use the first-person weapon models once they load.
  void loadWeaponModels().then((models) => {
    weaponVisuals.useModels(models);
    remotePlayers.setWeaponModels(models);
  });
  const shotEffects = new ShotEffects(scene);
  const loot = new LootViews(scene, pickupData, pieces);
  void loadWeaponModels().then((models) => loot.setWeaponModels(models));
  const ejecta = new Ejecta(scene, (origin, direction, distance) => physics.sweep(origin, direction, distance), pieces);
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
    const muzzle = authoredViewModel.muzzleOnScreen(viewCamera.fov, camera.fov)?.applyMatrix4(camera.matrixWorld);
    const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0), up = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    const forward = new Vector3().setFromMatrixColumn(camera.matrixWorld, 2).negate();
    const port = (muzzle ?? camera.position.clone().addScaledVector(forward, 0.6).addScaledVector(up, -0.15)).addScaledVector(forward, gun === "rifle" ? -0.33 : -0.13).addScaledVector(right, 0.02).addScaledVector(up, 0.03);
    ejecta.ejectCase(gun, port, right, forward, eyeVelocity);
  };
  const effects = new WorldEffects(scene, data, refs, () => camera.position, groups, pieces);
  const breaches = new BreachViews(scene, built.surfaces, pieces);
  // What the coordinating peer asks of this world when it resolves shots and blasts.
  const combatWorld: CombatWorld = {
    clearShot: (ray) => physics.clearShot(ray),
    traceBullet: (ray) => physics.traceBullet(ray, (point) => entities.windowAt(point)?.id ?? null),
    entity: (id) => {
      const entity = entities.get(id);
      // Loose props report where they are now, so a moved drum bursts where it lies.
      const shape = entity?.shape, size = !shape ? 0.3 : shape.type === "box" ? Math.max(shape.half[0], shape.half[2]) : shape.radius;
      return entity && !entities.destroyed(id) ? { kind: entity.kind, material: entity.material, maxHealth: entity.maxHealth, center: entities.locate(entity), explosive: entity.explosive, mass: entity.mass, size } : null;
    },
    entitiesNear: (center, radius) => entities.near(center, radius),
    walled: (a, b) => physics.walled(a, b),
    grenadeRest: (origin, velocity, seconds) => physics.grenadePath(origin, velocity, seconds).points.at(-1)!,
    push: (id, point, impulse) => physics.push(id, point, impulse),
    // A hand on a doorway's handles: a door more than half open is swung shut, otherwise open.
    swingDoor: (doorway) => {
      const leaves = DOOR_LEAVES.filter((leaf) => leaf.door.id === doorway && !entities.destroyed(leaf.id));
      if (!leaves.length) return null;
      const open = leaves.reduce((sum, leaf) => sum + physics.doorOpenness(leaf.id), 0) / leaves.length < 0.5;
      for (const leaf of leaves) physics.swingDoor(leaf.id, open);
      return open;
    },
  };
  let lastLandings = 0;
  // When the player started drawing back a throw, and the weight now in their hands.
  let throwStart = 0, handsHold = 0, armWound = 0;
  let fires: Fire[] = [], toolHeld = false, burning: string[] = [];
  const burningPeople = (): FlameSpot[] => burning.flatMap((id) => { const at = remotePlayers.position(id); return at ? [{ x: at.x, y: at.y + 0.1, z: at.z, wide: 0.22, deep: 0.22, high: 1.7 }] : []; });
  const litStoves = (): FlameSpot[] => STOVES.filter((stove) => toggleState[stove.id]).map((stove) => ({ x: stove.at.x, y: stove.at.y, z: stove.at.z, wide: 0.2, deep: stove.long, high: 0.2, gas: true }));
  const offWall = new Set<string>();
  // How burned each thing looks; it goes on looking it after the fire is out, until the round ends.
  const charred = new Map<string, number>();
  const char = (id: string, amount: number): void => { charred.set(id, amount); propViews.setChar(id, amount); built.stalls.setChar(id, amount); };
  // What is burning, as flames to draw: a burning object from its feet, and a loose one where it now is.
  const flameSpots = (): FlameSpot[] => fires.map((fire) => {
    const entity = fire.entity ? entities.get(fire.entity) : undefined, shape = entity?.shape;
    if (!entity || !shape) return { x: fire.position.x, y: fire.position.y - (physics.sweep(fire.position, { x: 0, y: -1, z: 0 }, 3)?.distance ?? 0.4), z: fire.position.z, wide: fire.radius * 0.75, deep: fire.radius * 0.75, high: Math.min(1.6, fire.radius + 0.4) };
    const at = entities.locate(entity), [wide, high, deep] = shape.type === "box" ? shape.half : [shape.radius, shape.halfHeight, shape.radius];
    return { x: at.x, y: at.y - high, z: at.z, wide, deep, high: Math.min(3.2, high * 2 + 0.7) };
  });
  // The first-person view drops and rolls when eliminated, from the pose at that moment.
  let deathView: { position: Vector3; quaternion: Quaternion; time: number } | null = null;
  const rendererName = isWebGPU ? "WebGPU" : "WebGL 2";
  const applySize = (): void => {
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    pixelRatio = ratioFor(width, height);
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height);
  };
  // A window being dragged to a new size resizes once it stops, not on every step.
  let resizeTimer = 0;
  const resize = (): void => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(applySize, 300);
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  applySize();

  let frames = 0;
  let renderedFrames = 0;
  let previousFrame = 0;
  let lastMetrics = performance.now();
  let readySent = false;
  let slowSamples = 0;
  let downgrades = 0;
  let readyAt = 0;
  let localBloom = 0;
  let lastLocalShot = 0;
  let lastSpread = -1, lastAiming = false;
  // Whether the aim button is held, and how much each gun's sights magnify the view.
  let aimWanted = false;
  const AIM_ZOOM: Record<WeaponKind, number> = { pistol: 1.25, rifle: 1.5 };
  // The first frames build every shader the market needs, the longest step of all on most
  // machines; the loading screen says so before the page stalls on it.
  DefaultLoadingManager.onProgress = () => undefined;
  await step("shaders");
  // Drawn all at once the shader builds stall the page for seconds; so the market appears a
  // slice at a time over the first frames, each slice building its own shaders, and the
  // loading screen follows the slices.
  const warming: Object3D[] = [];
  scene.traverse((object) => { if (object.visible && (object as Mesh).isMesh) warming.push(object); });
  for (const object of warming) object.visible = false;
  let warmed = 0, warmedAt = 0;
  renderer.setAnimationLoop((time) => {
    if (warmed < warming.length) {
      const next = Math.min(warming.length, warmed + Math.ceil(warming.length / WARM_SLICES));
      for (; warmed < next; warmed += 1) warming[warmed].visible = true;
      events.onStepProgress?.("shaders", warmed / warming.length);
      if (warmed === warming.length) warmedAt = renderedFrames + 1;
    }
    const delta = previousFrame ? (time - previousFrame) / 1000 : 0;
    const steps = physics.steps;
    // A flying prop is tested against everyone where this player sees them.
    if (physics.simulating()) {
      const targets: StrikeTarget[] = [];
      remotePlayers.each((id, feet, pose, dead) => { if (!dead) targets.push({ id, east: feet.x, feet: feet.y, north: feet.z, crouching: pose.crouching }); });
      physics.setStrikeTargets(targets);
    }
    if (throwStart) physics.setDraw(Math.min(1, (performance.now() - throwStart) / THROW_CHARGE_MS));
    player.update(delta);
    camera.updateMatrixWorld();
    const eye = camera.position.clone();
    if (delta > 0) eyeVelocity.copy(eye).sub(lastEye).divideScalar(delta);
    if (eyeVelocity.length() > 15) eyeVelocity.set(0, 0, 0);
    lastEye.copy(eye);
    const axes = { right: new Vector3().setFromMatrixColumn(camera.matrixWorld, 0), up: new Vector3().setFromMatrixColumn(camera.matrixWorld, 1), forward: new Vector3().setFromMatrixColumn(camera.matrixWorld, 2).negate() };
    // Paused or eliminated players do not move the world, so step it for ragdolls and props.
    if (physics.steps === steps) physics.advance(delta);
    // Losing a grip happens in the physics: a wall in the way, someone else's claim, or the prop
    // being shot apart. Whatever the reason, the hands and the load follow it.
    const inHands = physics.heldProp()?.mass ?? (toolHeld ? TOOL_MASS : 0);
    if (inHands !== handsHold) {
      handsHold = inHands;
      player.setCarried(inHands);
      weaponVisuals.setHandsFull(inHands > 0);
      if (!inHands) throwStart = 0;
    }
    if (deathView) {
      deathView.time += delta;
      const fall = Math.min(1, deathView.time / 0.7), eased = 1 - (1 - fall) ** 3;
      camera.position.copy(deathView.position).add(new Vector3(0, -1.3 * eased, 0));
      camera.quaternion.copy(deathView.quaternion).multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 1.15 * eased));
    }
    remotePlayers.update(delta, camera);
    soundStage.update(camera, player.gait(), player.motion(), remotePlayers);
    const gait = player.gait();
    if (gait.landings !== lastLandings) {
      lastLandings = gait.landings;
      if (gait.landingSpeed > 9) events.onHardLanding?.(gait.landingSpeed);
    }
    shotEffects.update(delta);
    effects.setFlames([...(fires.length ? flameSpots() : []), ...burningPeople(), ...litStoves()]);
    effects.update(Math.min(delta, 0.1));
    loot.update(Math.min(delta, 0.1));
    ejecta.update(delta);
    if (muzzleLight) { muzzleLight.intensity = muzzleGlow * 40; muzzleGlow *= Math.exp(-Math.min(delta, 0.1) * 40); }
    for (const prop of props) {
      const pose = physics.propPose(prop.id);
      if (pose) propViews.place(prop.id, pose.position, pose.rotation);
    }
    for (const leaf of DOOR_LEAVES) {
      const pose = physics.propPose(leaf.id);
      if (pose) built.doors.place(leaf.id, pose.position, pose.rotation);
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
    // The sights come up only with a gun ready in hand, and drop for a reload or a switch.
    const dynamics = weaponVisuals.dynamics();
    player.setAiming(aimWanted && !dynamics.hands && dynamics.reload < 0.05 && dynamics.lower < 0.05, AIM_ZOOM[dynamics.active]);
    const inGrip = physics.heldThing();
    if (inGrip && handsOutOfView(inGrip.prop)) authoredViewModel.setHold("hidden");
    else if (inGrip) {
      camera.updateMatrixWorld();
      authoredViewModel.setHold(inCameraFrame(propHold(inGrip, axes.right.clone().setY(0).normalize(), axes.forward.clone().setY(0).normalize()), camera));
    } else authoredViewModel.setHold(null);
    coverHands(inGrip && !handsOutOfView(inGrip.prop) ? inGrip : null);
    authoredViewModel.update(delta, player.motion(), dynamics);
    // The crosshair opens with the same spread the leader applies to this player's shots.
    const motion = player.motion(), active = weaponVisuals.dynamics().active;
    const spread = spreadDegrees(active, motion, currentBloom(active, localBloom, (performance.now() - lastLocalShot) / 1000)) * armSpread(armWound);
    const spreadPixels = Math.tan(spread * Math.PI / 180) * (container.clientHeight / 2) / Math.tan(camera.fov * Math.PI / 360);
    if (Math.abs(spreadPixels - lastSpread) > 0.25 || motion.aiming !== lastAiming) {
      lastSpread = spreadPixels;
      lastAiming = motion.aiming;
      events.onAim?.(spreadPixels, motion.aiming);
    }
    built.update(time / 1000);
    rainTime.value = time / 1000;
    rain.follow(camera.position);
    reflectFrom.inverseProjection.value.copy(camera.projectionMatrixInverse);
    reflectFrom.world.value.copy(camera.matrixWorld);
    eyeHeight.value = camera.position.y;
    aimShafts(camera);
    hazeLevel += (built.pipes.fogAt(camera.position) - hazeLevel) * Math.min(1, delta * 6);
    haze.visible = hazeLevel > 0.01;
    if (haze.visible) {
      (haze.material as MeshBasicMaterial).opacity = hazeLevel;
      haze.quaternion.copy(camera.quaternion);
      haze.position.copy(camera.position).add(new Vector3(0, 0, -0.2).applyQuaternion(camera.quaternion));
      haze.scale.set(0.2 * Math.tan(camera.fov * Math.PI / 360) * 2 * camera.aspect * 1.2, 0.2 * Math.tan(camera.fov * Math.PI / 360) * 2 * 1.2, 1);
    }
    truck.update(Math.min(delta, 0.1));
    previousFrame = time;
    viewCamera.aspect = camera.aspect;
    // The weapon in hand is drawn without the sights' magnification.
    viewCamera.fov = authoredViewModel.viewFov(player.handFov());
    viewCamera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    viewLighting.update(Math.min(delta, 0.1), camera);
    if (sun.castShadow && renderedFrames % SHADOW_EVERY === 0) sun.shadow.needsUpdate = true;
    pipeline.render();
    frames += 1;
    renderedFrames += 1;
    if (!readySent && warmed === warming.length && renderedFrames >= warmedAt + 2) {
      events.onStatus("ready", `${data.layout.name} loaded. Use arrow keys to move and drag on the map to look around.`);
      readySent = true;
      readyAt = time;
    }
    if (time - lastMetrics >= 500) {
      const fps = Math.round(frames * 1000 / (time - lastMetrics));
      // Four seconds under 40 FPS, once the first frames' shader builds are past: render a
      // little over half the pixels, in one step.
      slowSamples = !document.hidden && readyAt && time - readyAt > 6000 && fps < 40 ? slowSamples + 1 : 0;
      if (slowSamples >= 8 && downgrades < 2 && pixelRatio > floorRatio) {
        budget *= 0.55;
        downgrades += 1;
        slowSamples = 0;
        applySize();
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

  // The market's own sounds: the condensers' fans and music from a speaker high in the bar's
  // back corner.
  gameAudio.setAmbience([
    ...CONDENSER_SPOTS.map((at, index): AmbientSource => ({ id: `condenser-${index}`, kind: "condenser", at })),
    { id: "bar-music", kind: "music", at: { x: 22.8, y: 2.6, z: 8.5 } },
  ]);

  return {
    arenaData() { return data; },
    setPaused(paused, releaseMouse) {
      player.setPaused(paused, releaseMouse);
    },
    lockPointer() { player.lockPointer(); },
    playerPose() {
      return player.pose();
    },
    traceShot(ray) { return physics.traceShot(ray); },
    showShot(event, local) { shotEffects.show(event, local ? authoredViewModel.muzzleOnScreen(viewCamera.fov, camera.fov)?.applyMatrix4(camera.matrixWorld) : remotePlayers.muzzle(event.actor) ?? undefined); },
    clearShot(ray) {
      return physics.clearShot(ray);
    },
    setSpawnSlot(slot) {
      player.setSpawnSlot(slot);
    },
    respawn() {
      player.reset(arena);
    },
    setAiming(aiming) { aimWanted = aiming; },
    setWeapon(kind) {
      weaponVisuals.setActive(kind);
    },
    setTakenPickups(taken) {
      weaponVisuals.setTaken(taken);
      loot.setTaken(taken);
      // An extinguisher taken off its wall is gone from it until it comes back.
      for (const { id, item } of makeWeaponPickups(data)) {
        const gone = taken.includes(id);
        if (item !== "extinguisher" || gone === offWall.has(id) || entities.destroyed(id)) continue;
        if (gone) offWall.add(id); else offWall.delete(id);
        effects.setHidden(id, gone);
        if (gone) physics.removeEntity(id); else physics.restoreEntity(id);
      }
    },
    busyHands(seconds) { weaponVisuals.dip(seconds); },
    startRush(seconds) { player.startRush(seconds); },
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
          if (entity.kind === "pipe" || entity.kind === "extinguisher") built.pipes.restore(entity.id);
          if (entity.kind === "stall") physics.setMoverEnabled(`${entity.id}:wreck`, false);
          // A stall back in place brings its lamp back, unless the lamp itself was shot.
          const stallLamp = entity.kind === "stall" ? `lamp:${entity.id}` : "";
          if (stallLamp && (health[stallLamp] ?? 1) > 0) { built.lamps.setBroken(stallLamp, false); physics.restoreEntity(stallLamp); }
          if (entity.kind === "prop") propViews.setVisible(entity.id, true);
          if (entity.kind === "wall") breaches.setOpen(entity.id, false);
        }
      }
      if (!Object.keys(health).length) { entities.resetHealth(); for (const id of [...charred.keys()]) { char(id, 0); charred.delete(id); } }
      for (const entity of entities.applyHealth(health)) {
        // A shot fuel drum stays put and whole while it vents, until its burst arrives; one
        // that burst before this peer joined is simply gone.
        if (entity.kind === "prop" && entity.explosive) {
          if (healthSeen) { window.setTimeout(() => burstProp(entity.id), 2200); continue; }
          burstProp(entity.id);
          continue;
        }
        const at = physics.propPose(entity.id)?.position ?? physics.moverCenter(entity.id);
        physics.removeEntity(entity.id);
        effects.destroy(at ? { ...entity, center: at } : entity);
        if (entity.kind === "prop") propViews.setVisible(entity.id, false);
        if (entity.kind === "wall") breaches.setOpen(entity.id, true);
        if (entity.kind === "tyre") truck.setFlat(entity.id, true);
        if (entity.kind === "lamp") built.lamps.setBroken(entity.id, true);
        if (entity.kind === "pipe") {
          built.pipes.burst(entity.id, healthSeen);
          if (healthSeen) gameAudio.steamBurst(entity.center);
        }
        if (entity.kind === "extinguisher") {
          built.pipes.burst(entity.id, healthSeen);
          if (healthSeen) gameAudio.extinguisher(entity.center);
        }
        if (entity.kind === "stall") physics.setMoverEnabled(`${entity.id}:wreck`, true);
        // A stall's lamp goes down with it.
        if (entity.kind === "stall") { built.lamps.setBroken(`lamp:${entity.id}`, true); physics.removeEntity(`lamp:${entity.id}`); }
        // A cylinder bursts when its explosion arrives; this catches one that burst before
        // this peer joined.
        if (entity.kind === "tank") window.setTimeout(() => truck.burst(entity.id), 2200);
      }
      // What is burning blackens as it goes.
      for (const fire of fires) {
        const entity = fire.entity ? entities.get(fire.entity) : undefined;
        if (!entity || entities.destroyed(entity.id)) continue;
        const amount = Math.min(1, 0.3 + (1 - entities.healthOf(entity.id) / entity.maxHealth) * 1.5);
        if (amount > (charred.get(entity.id) ?? 0) + 0.02) char(entity.id, amount);
      }
      // Walls crack before they give way.
      for (const entity of entities.all()) {
        if (entity.kind !== "wall" || entities.destroyed(entity.id)) continue;
        if (breaches.setHealth(entity.id, entities.healthOf(entity.id) / entity.maxHealth) && healthSeen) { effects.knock(entity.center); gameAudio.impact("masonry", entity.center); }
      }
      // Stalls show their damage: an awning shot to rags at half health, then the pile.
      for (const entity of entities.all()) {
        if (entity.kind !== "stall") continue;
        const stage = built.stalls.setHealth(entity.id, entities.healthOf(entity.id) / entity.maxHealth);
        if (stage === 1 && healthSeen) { effects.knock(entity.center); gameAudio.tear(entity.center); }
      }
      healthSeen = true;
    },
    playEvent(event, selfId) {
      soundStage.combat(event, selfId);
      const own = event.actor === selfId;
      if (event.kind === "shot") {
        if (!own && event.weapon) {
          remotePlayers.attack(event.actor);
          const hands = remotePlayers.hands(event.actor);
          if (hands) {
            const yaw = hands.heading * Math.PI / 180;
            const right = new Vector3(-Math.cos(yaw), 0, Math.sin(yaw)), forward = new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
            ejecta.ejectCase(event.weapon, hands.position.clone().addScaledVector(right, 0.03), right, forward);
            flashAt(remotePlayers.muzzle(event.actor) ?? hands.position.clone().addScaledVector(forward, event.weapon === "rifle" ? 0.7 : 0.35), 1);
          }
        }
      }
      if (event.kind === "reload" && event.dropped && event.weapon) {
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
      // A heavy round knocks the body back a little.
      if ((event.kind === "hit" || event.kind === "death") && event.target === selfId && event.from && event.cause === "rifle") {
        const dx = camera.position.x - event.from.x, dz = camera.position.z - event.from.z, length = Math.hypot(dx, dz) || 1;
        player.shove(dx / length * 0.6, dz / length * 0.6);
      }
      // A heavy thing thrown at a player staggers them.
      if ((event.kind === "hit" || event.kind === "death") && event.target === selfId && event.cause === "struck" && event.velocity) player.shove(event.velocity.x, event.velocity.z);
      // A blast in the open throws the player away from it; cover shelters them.
      if (event.kind === "vent" && event.entity && event.position) {
        if (event.entity.startsWith("truck:")) truck.vent(event.entity, (event.fuseMs ?? 1600) / 1000);
        else { const id = event.entity; effects.vent(() => physics.propPose(id)?.position ?? null, (event.fuseMs ?? 1600) / 1000); }
        gameAudio.vent(event.position, (event.fuseMs ?? 1600) / 1000);
      }
      if (event.kind === "spray" && event.position && event.velocity) { effects.spray(event.position, event.velocity); gameAudio.spray(event.position); }
      if (event.kind === "explode" && event.entity) {
        if (event.entity.startsWith("truck:")) truck.burst(event.entity);
        else burstProp(event.entity);
      }
      if (event.kind === "use" && event.entity) {
        const toggle = data.layout.toggles.find((item) => item.id === event.entity);
        if (toggle?.verbs) gameAudio.switchClick(toggle.at);
        else if (toggle) gameAudio.hinge(toggle.at, event.open === true, event.entity.endsWith("hatch"));
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
        effects.throwGrenade(event.grenade, physics.grenadePath(event.position, event.velocity, (event.fuseMs ?? 2600) / 1000), event.smoke === true);
      }
      // A smoke grenade pops where it came to rest and pours smoke from there.
      if (event.kind === "smoke" && event.position) built.pipes.pour(`smoke:${event.id}`, event.position, SMOKE);
      if (event.kind === "explode" && event.position) {
        if (event.grenade !== undefined) effects.removeGrenade(event.grenade);
        effects.explosion(event.position);
      }
      if ((event.kind === "hit" || event.kind === "death") && event.target && event.target !== selfId && event.cause !== "fall" && (event.cause !== "fire" || event.kind === "death")) {
        const at = remotePlayers.position(event.target);
        if (at) {
          effects.impact({ x: at.x, y: at.y + (event.zone === "head" ? 1.65 : 1.15), z: at.z }, { x: 0, y: 0.4, z: 0 }, "flesh");
          // The killing blow knocks the ragdoll away from where it came from.
          if (event.kind === "death") {
            const from = event.from ?? { x: at.x, y: at.y + 1, z: at.z - 1 };
            const dx = at.x - from.x, dz = at.z - from.z, length = Math.hypot(dx, dz) || 1;
            const blast = event.cause === "grenade" ? 140 * Math.max(0.2, 1 - Math.hypot(dx, dz) / 7) : 0;
            const strength = blast || { pistol: 20, rifle: 28, bleed: 1, fire: 1 }[event.cause as "pistol" | "rifle" | "bleed" | "fire"] || 15;
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
    propTraffic(leading) { return physics.propTraffic(leading); },
    displacedProps() { return physics.displacedProps(); },
    applyPropStates(states, owner, rest, self) { physics.applyPropStates(states, owner, rest, self); },
    resetWorld() { physics.resetProps(); ejecta.clear(); loot.clear(); },
    setOpen(open) {
      toggleState = { ...toggleDefaults, ...open };
      truck.setOpen(toggleState, toggleDefaults);
      built.lamps.setSwitched("lamp:breaker", toggleState["switch:breaker"] ?? true);
    },
    nearestUse() {
      const eye = camera.position;
      let best: { id: string; label: string; open: boolean; verb: string; distance: number } | null = null;
      for (const toggle of data.layout.toggles) {
        // A doorway whose leaves are all blown off has nothing left to open.
        const leaves = DOOR_LEAVES.filter((leaf) => leaf.door.id === toggle.id);
        const standing = leaves.filter((leaf) => !entities.destroyed(leaf.id));
        if (leaves.length && !standing.length) continue;
        if (toggle.entity && entities.destroyed(toggle.entity)) continue;
        const distance = Math.hypot(eye.x - toggle.at.x, eye.y - toggle.at.y, eye.z - toggle.at.z);
        // A door is as open as its leaves are, wherever they were pushed.
        const open = standing.length ? standing.reduce((sum, leaf) => sum + physics.doorOpenness(leaf.id), 0) / standing.length >= 0.5 : toggleState[toggle.id] ?? toggle.open;
        if (distance <= 2.2 && (!best || distance < best.distance)) { best = { id: toggle.id, label: toggle.label, open, verb: toggle.verbs ? toggle.verbs[open ? 1 : 0] : open ? "close" : "open", distance }; }
      }
      return best;
    },
    setLocalDead(dead) {
      if (dead && !deathView) deathView = { position: camera.position.clone(), quaternion: camera.quaternion.clone(), time: 0 };
      if (!dead) deathView = null;
    },
    playAttack(weapon) {
      authoredViewModel.fire();
      gameAudio.fire(weapon);
      const now = performance.now();
      localBloom = bloomAfterShot(weapon, localBloom, (now - lastLocalShot) / 1000);
      lastLocalShot = now;
      player.kickRecoil(weapon === "rifle" ? 0.7 : 1.2);
      ejectLocal(weapon);
      viewLighting.muzzleFlash(authoredViewModel.muzzle(), weapon === "rifle" ? 1.2 : 1);
      flashAt(camera.position.clone().add(new Vector3().setFromMatrixColumn(camera.matrixWorld, 2).multiplyScalar(-0.8)), 1);
    },
    setLoad(kilograms) { player.setLoad(kilograms); },
    holding() { return physics.heldProp(); },
    liftable() {
      const motion = player.motion(), id = motion.climbing || motion.mantling ? null : physics.propInView(CARRY_REACH);
      const entity = id ? entities.get(id) : undefined;
      return id && entity?.mass ? { id, label: PROP_LABEL[entity.prop ?? ""] ?? "it", mass: entity.mass, heavy: entity.mass > armCarry(armWound) } : null;
    },
    lift(id) {
      const lifted = physics.lift(id);
      if (lifted) gameAudio.pickup();
      return lifted;
    },
    putDown() { physics.letGo(); },
    beginThrow() { if (physics.heldProp() && !throwStart) throwStart = performance.now(); },
    releaseThrow() {
      if (!throwStart) return;
      const charge = (performance.now() - throwStart) / THROW_CHARGE_MS, mass = physics.heldProp()?.mass ?? 0;
      throwStart = 0;
      if (!mass) return;
      const speed = throwSpeed(mass, charge) * armThrow(armWound), direction = physics.throwHeld(speed);
      if (!direction) return;
      // Whatever goes forward pushes the thrower back.
      const recoil = mass * speed / (BODY_MASS + mass);
      player.shove(-direction.x * recoil, -direction.z * recoil, 0, true);
      player.holdSprint(0.5);
      gameAudio.throwGrenade();
    },
    cancelThrow() { throwStart = 0; physics.setDraw(0); },
    takeStrikes() { return physics.takeStrikes(); },
    takeSmashes() { return physics.takeSmashes(); },
    takeKnocks() { return physics.takeKnocks(); },
    hearKnocks(knocks) {
      for (const [id, speed] of knocks) {
        const entity = entities.get(id), at = physics.propPose(id)?.position;
        if (entity?.mass && at) gameAudio.propKnock(entity.material, at, speed, entity.mass);
      }
    },
    takeShoves() { return physics.takeShoves(); },
    applyShoves(shoves) { physics.applyShoves(shoves); },
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
    setFires(list) {
      // Each fire that has gone leaves its mark, on whatever it was burning over.
      const keyOf = (fire: Fire): string => fire.entity ?? `${fire.position.x},${fire.position.z}`, still = new Set(list.map(keyOf));
      for (const fire of fires) {
        if (still.has(keyOf(fire))) continue;
        const down = physics.sweep(fire.position, { x: 0, y: -1, z: 0 }, 4)?.distance ?? fire.position.y;
        effects.scorch({ x: fire.position.x, y: fire.position.y - down, z: fire.position.z }, fire.radius * 2.4);
      }
      fires = list;
    },
    setBurning(peers) { burning = peers; },
    setTool(held) { toolHeld = held; authoredViewModel.showTool(held); },
    setRemoteTool(peerId, held) { remotePlayers.setTool(peerId, held); },
    setWounds(leg, arm) {
      armWound = arm;
      player.setLegWound(leg);
      weaponVisuals.setArmWound(arm);
    },
    setRemoteLeg(peerId, leg) { remotePlayers.setLegWound(peerId, leg); },
    dripBlood(peerId) {
      const at = remotePlayers.position(peerId);
      if (at) effects.impact({ x: at.x, y: at.y + 0.9, z: at.z }, { x: 0, y: 0.4, z: 0 }, "flesh");
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
      gameAudio.setAmbience([]);
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
