# Rendering plan and baseline

The pilot now uses one 140 m playable block. Its default asset contains 62 building footprints, 267 road segments, and 8 mapped trees, with a 65 m visual buffer. The source extract contains 291 buildings, 1,927 road segments, and 38 trees. The default JSON is 36,232 bytes versus 223,076 bytes for the full extract. A custom arena URL still loads the full extract.

Buildings and road surfaces are batched by spatial cell. This keeps material reuse while letting Three.js cull cells outside the camera view. Concrete cover uses one simplified detailed model and material set, instanced in small spatial cells at deterministic locations. The same locations are colliders for movement and height-aware combat line of sight. The first-person hands and held weapon now respond to gait, turning, jumps, landing, and recoil. The sun shadow camera covers the local block more tightly, and the renderer adjusts pixel ratio after sustained low or high frame rates.

On a local headless Chrome run on an Apple M4, the spawn view reported 60 FPS with WebGPU at 1440 × 813 CSS pixels and 2× render resolution (2880 × 1626), with 266 draw calls and about 253,000 rendered triangles. Forcing WebGL 2 with `?renderer=webgl` settled near 52 FPS at 1.75× render resolution in that environment. This is one spawn view and one machine, not a target-device guarantee. The browser performance label exposes live FPS; hover over it for draw calls, triangles, and resolution.

## Why this approach

Modern FPS weapon handling benefits from responsive camera and view-model motion: turn settling, stance transitions, sway, and near-wall behavior are described in [Call of Duty's movement notes](https://www.callofduty.com/blog/2026/08/call-of-duty-modern-warfare-4-next-highlights-multiplayer-gameplay-systems). This build adds turn settling and gait-driven weapon motion, while the hands and other players still need a licensed, rigged, authored character asset and blended clips. [Three.js AnimationMixer](https://threejs.org/manual/pages/animation-system.html) can blend idle, walk, run, crouch, aim, and attack clips once those assets are ready.

The next visual pass should author a small number of high-quality facade, sidewalk, tree, and prop assets with PBR materials. Shared assets should use [instancing](https://threejs.org/docs/pages/InstancedMesh.html), meshes should have near and far levels of detail, and textures should move to [KTX2/Basis compression](https://threejs.org/docs/pages/KTX2Loader.html) after inspecting GPU memory and visual quality. The current barrier model is CC0 [Poly Haven art](https://polyhaven.com/a/concrete_road_barrier_02); its license is recorded in [data sources](data-sources.md).

Each player already renders the same static arena files locally and sends pose and combat data over WebRTC; peers do not stream map geometry or animation bones. Shared URLs and browser caching serve the same asset bytes to different players, while each device still performs its own rendering. [Rapier 3D](https://rapier.rs/docs/user_guides/javascript/getting_started_js/) now runs character physics and scene queries in WebAssembly. Rendering remains on the GPU; a separate WASM mesh or texture pipeline would need a measured CPU bottleneck.

Before claiming 2–8 player performance or higher fidelity, test several real MacBooks and Windows GPUs in a live room, record frame-time percentiles and memory use, and inspect worst-case views with other players and weapon effects visible.

### Authored first-person assets

`AuthoredViewModel` accepts same-origin GLB files containing the arms and held weapon together, preserving rigging and PBR materials. Export from Blender with applied transforms, skinning, and baked animation. Author in camera-local coordinates (metres, +Y up, forward -Z); the GLB is attached directly to the camera without automatic rescaling. Use clips named `idle`, `walk`, `run`, and `fire`. Locomotion clips crossfade; fire plays once. Weapon-specific grip poses should be authored in each file. Include muzzle-flash geometry in the fire animation for custom models.

Place files under `public/models/`, then set `VITE_KNIFE_VIEWMODEL=models/knife.glb`, `VITE_PISTOL_VIEWMODEL=models/pistol.glb`, and/or `VITE_RIFLE_VIEWMODEL=models/rifle.glb` at build time. Each successful model replaces both procedural hands and its matching weapon; missing or failed assets retain the fallback. No authored hand assets are bundled yet. This importer does not convert Unity prefabs, controllers, or shaders; source meshes and animations must be exported to GLB, with a license allowing distribution in the public web game. Keep source/author/license records alongside any assets added.

References: [Blender glTF export](https://docs.blender.org/manual/en/dev/addons/scene_gltf2.html), [Three.js GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html).
