# Hereafter

*Fight where you stand.*

Hereafter is a browser-based multiplayer FPS prototype in bounded real-world arenas. The first target is downtown San Jose, California for 2–8 players. The current build has first-person movement, peer-to-peer rooms, and a first combat loop.

The [original handoff](docs/REAL_WORLD_FPS_AGENT_HANDOFF.md) describes the staged game plan. Its Google Photorealistic 3D Tiles approach has been replaced for this first arena with a static open-data build, eliminating per-player map API requests and the Google key. See the [architecture note](docs/architecture.md) and [data sources](docs/data-sources.md).

Open the [live arena](https://kushagrabainsla.github.io/hereafter/).

## Run locally

Install Node.js 22.12 or newer, then run:

```sh
npm ci
npm run dev
```

Open the URL printed by Vite. No API key or billing account is needed. The 3D arena asset is bundled with the site. The browser needs WebGPU or WebGL 2; Three.js uses WebGPU when available and falls back to WebGL 2. Rapier's WebAssembly module handles character movement and collision.

You spawn at walking height on a clear street in a 140 × 140 m playable block, with visible first-person hands and a field knife. Press H, or click the small control hint, to open the controls modal; movement pauses while it is open. Use the arrow keys or WASD to walk, hold Shift to run, press Space to jump, and hold C or Ctrl to crouch. Click and drag on the map with a trackpad or mouse to move the view; a short click attacks. Press F to attack from the keyboard. Double-click the map for FPS mouse look and press Esc to release it. The supported arena coordinates can still be supplied in a URL, but are not shown during play.

Pistols and carbines appear at marked spots on the street. Walk close and press E to collect one; collected weapons return after 30 seconds. Use 1, 2, or 3 to equip the knife, pistol, or carbine, and R to reload a gun. The HUD shows health, ammo, kills, and deaths. After elimination, wait three seconds and press Enter to respawn with the knife.

## Play together

Click **Play together**, create a room, and share the invite link. Another player can open that link to join automatically, or enter the room code manually. Both browsers render the same arena and show each other's movement, health, and weapon pickups. Room spawns are spaced apart. The current build has been verified with two browser tabs; the 2–8 player target still needs larger-session testing.

The site remains static on GitHub Pages. [Trystero](https://trystero.dev/) uses public Nostr relays to help browsers find each other, then carries gameplay data over WebRTC data channels. The public relays require no account or project server for this prototype. Some networks cannot establish a direct connection without a TURN relay; one is not configured yet. A room code is a shareable invite secret, not a user identity system. One peer checks attack range, cover, ammo, timing, and pickup distance, then shares health and inventory state. Movement is still client reported, so the prototype is unsuitable for competitive matches. See [multiplayer architecture](docs/multiplayer.md).

Run `npm run build` for a local production build. Run `npm run build:pages` to build with the `/hereafter/` path prefix for GitHub Pages, then `npm run preview:pages` to inspect that build locally.

## Arena data

`public/arena/san-jose.json` contains the full source extract. The default game loads `public/arena/san-jose-block.json`, a smaller build with the playable block and a 65 m visual buffer. The site does not call OpenStreetMap or USGS at runtime. To refresh both files, run `npm run build:arena` from the repository root. That build step makes one bounded OpenStreetMap data request and 25 USGS elevation point requests. Run `npm run build:block` to rebuild only the block from the existing full extract.

Ground, grass, asphalt, pavement, walls, roofs, bark, leaf silhouettes, the daylight sky, and detailed concrete cover use bundled CC0 art from [Poly Haven](https://polyhaven.com/license), with normal maps on key surfaces. Ground-floor storefronts use two generated photo textures. Building windows, doors, awnings, ledges, facade trim, streetlights, curbs, crosswalks, manholes, drains, planters, and hydrants are geometry. Trees have layered leaf cards with subtle wind motion, and the first-person gloved hands react to walking, turning, jumping, and landing. WebGPU and WebGL 2 both use dynamic shadows and the detailed materials. The browser makes no texture API requests; the underlying map data remains the same.

Buildings and roads are grouped into spatial cells for view culling. Render resolution adjusts after sustained slow or fast frame rates. The performance label's hover text shows draw calls, triangles, and resolution. Add `?renderer=webgl` to the URL to test WebGL 2. See [rendering notes](docs/rendering.md) for measurements and the next fidelity steps.

The adapted OpenStreetMap data in this asset is offered under the [Open Database License (ODbL)](https://opendatacommons.org/licenses/odbl/1-0/). In-game attribution links to [OpenStreetMap contributors](https://www.openstreetmap.org/copyright). USGS 3DEP elevation data is public domain. This repository's software code does not yet have a selected license.

## Current limitations

- The arena is geographically based on real roads and building footprints, but its buildings, windows, trees, and street furniture are still approximations. Some building heights are inferred where the data has no height tag.
- The terrain is interpolated from a 5 × 5 USGS height grid. Walking follows this coarse ground surface.
- Only the San Jose pilot extract is bundled. A new city needs a new data build and level design.
- Rapier runs a fixed 60 Hz capsule controller against terrain, building walls, trees, furniture, concrete cover, and arena boundaries. It supports wall sliding, ground snapping, low steps, jumping, and crouching with a standing-clearance check. The arena still has no authored stairs, moving platforms, or dynamic props.
- Gunfire uses a 3D physics ray to check static cover before applying a hit. Peer movement still originates on each player's device; distance and arena checks reject implausible pose packets, but a modified client can still cheat. Robust authority handoff and larger-session testing remain future work.
- GitHub Pages has [site-size and bandwidth limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits); the current arena is small enough for the intended prototype.

## Project status

The Phase 1 arena, FPS movement, peer rooms, pickups, health, and basic combat are runnable. Fully trusted movement, robust host migration, audio, and larger-session testing remain to be built.
