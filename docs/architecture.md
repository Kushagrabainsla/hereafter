# Architecture

The browser downloads a static TypeScript application with its textures, models and sounds. Nothing is fetched from a third party while playing, apart from the public relays that help room members find each other.

## The map

`src/world/nightMarket.ts` defines the Night Market as plain data: every solid box with the material it is made of and how it is drawn, the spawns, the weapon pickups, ladders, the bar stair, stalls, glass storefronts, facades and their windows, signs, lights and props. Every client builds the same data in the same order, so collider layouts, entity ids and prop ids agree without being sent. The shared part, a `MapLayout` of solids, spawns and pickups, travels on the map data that the rest of the game receives (`src/world/arena.ts`). The playable square is 60 m across and centred on the origin; the ground is flat.

The same module draws the market. Static geometry is merged per material so the map draws in a few dozen calls; windows, bulbs and lanterns are instanced; stalls and glass are separate objects so they can disappear when destroyed. `src/world/duskSky.ts` paints the sky. `src/world/climbing.ts` draws ladders and stairs.

## Rendering

`src/world/mapViewer.ts` creates the scene, the renderer and the frame loop. Three.js `WebGPURenderer` uses WebGPU when available and WebGL 2 otherwise. On WebGPU, clustered lighting lets every lamp and sign be a real light, and `src/game/viewLighting.ts` lights the first-person arms from the lamps around the player. Static surfaces also take light baked offline (`src/world/lightmap.ts`, built by `scripts/lightmaps/`). The world renders into a post-processing pipeline that adds ground-truth ambient occlusion and SMAA, then the multisampled first-person view, bloom, a grade, a vignette, tone mapping and film grain. Render resolution adapts to sustained frame rates. See [rendering notes](rendering.md).

## Movement and physics

`src/world/physics.ts` builds Rapier 3D colliders for the ground, the arena edge, every layout solid and every world entity, and simulates loose props. The player is a kinematic capsule updated at a fixed 60 Hz; Rapier's character controller handles sliding, grounding, low steps and crouch clearance. `src/game/playerController.ts` applies acceleration, gravity, jumps, running, crouching, sliding, mantling, leaning, ladders and camera look. `src/world/collision.ts` picks each room member's spawn. See [movement notes](movement.md) and [physics notes](physics.md).

## Combat and rooms

`src/game/matchState.ts` holds health, inventory, the rounds in each gun and spare magazine, pickups, dropped guns, grenades, entity health and respawns, and resolves shots and knife strokes through the physics world on the coordinating peer. `src/game/loot.ts` draws spare magazines and dropped guns, and `src/game/ejecta.ts` throws spent cases and empty magazines. `src/network/peerRoom.ts` carries poses, combat intents, snapshots and prop transforms between peers. `src/main.ts` connects the viewer, the match, the room and the HUD. See [multiplayer architecture](multiplayer.md).

The original plan in the [handoff](REAL_WORLD_FPS_AGENT_HANDOFF.md) built arenas from real city data (first Google 3D Tiles, then OpenStreetMap). The game has since replaced that with the hand-built market, which suits close fights better than real streets.
