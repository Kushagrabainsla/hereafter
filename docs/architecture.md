# Phase 1 architecture

The browser downloads a static TypeScript application and `public/arena/san-jose.json`. It makes no map-service requests while players explore the arena.

`src/world/arena.ts` defines the arena data format, center and bounds validation, coordinate conversion, and elevation interpolation. `src/world/mapViewer.ts` turns that data into ground, roads, parks, trees, buildings, and a visible arena boundary. It uses Three.js `WebGPURenderer`, which selects WebGPU when available and WebGL 2 otherwise. `src/world/cameraControls.ts` keeps camera movement inside the selected square. `src/main.ts` connects the renderer and controls to the page.

The renderer boundary is a `MapViewer` interface with `setArena` and `destroy`. The game layer can later use the same data to build simplified colliders and an authoritative simulation without treating the visual mesh as gameplay truth. Data generation remains separate in `scripts/build-arena.mjs`; players never query the source services.

The handoff's Google Photorealistic 3D Tiles path is no longer used in this phase. The free-data pilot establishes real-world layout and a working browser renderer. Photorealistic detail, arbitrary location selection, collision geometry, and multiplayer are separate future tasks.
