# Phase 1 architecture

The browser downloads a static TypeScript application and `public/arena/san-jose.json`. It makes no map-service requests while players explore the arena.

`src/world/arena.ts` defines the arena data format, center and bounds validation, coordinate conversion, and elevation interpolation. `src/world/mapViewer.ts` turns that data into ground, roads, parks, trees, buildings, and a visible arena boundary. `src/world/surfaceTextures.ts` generates repeating surface patterns locally. The renderer uses Three.js `WebGPURenderer`, which selects WebGPU when available and WebGL 2 otherwise. `src/world/collision.ts` derives simple building, tree, and arena colliders from the same data and finds a clear street spawn. `src/game/playerController.ts` handles first-person walking, running, jumping, crouching, and trackpad or mouse look. `src/game/playerHands.ts` renders animated hands attached to the camera. `src/main.ts` connects the renderer and controls to the page.

The renderer boundary is a `MapViewer` interface with `setArena` and `destroy`. The separate collision layer is an initial gameplay approximation based on map footprints; a later authoritative simulation can use it without treating the visual mesh as gameplay truth. Data generation remains separate in `scripts/build-arena.mjs`; players never query the source services.

The handoff's Google Photorealistic 3D Tiles path is no longer used in this phase. The free-data pilot establishes real-world layout and a working browser renderer. Photorealistic detail, arbitrary location selection, detailed physics, and multiplayer are separate future tasks.
