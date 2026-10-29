# Hereafter

*Fight where you stand.*

Hereafter is a browser-based multiplayer FPS prototype in bounded real-world arenas. The first target is downtown San Jose, California for 2–8 players. The current build has first-person movement, peer-to-peer rooms, and a first combat loop on two maps: the open-data San Jose block and the Night Market, a tight back-alley map built by hand.

The [original handoff](docs/REAL_WORLD_FPS_AGENT_HANDOFF.md) describes the staged game plan. Its Google Photorealistic 3D Tiles approach has been replaced for this first arena with a static open-data build, eliminating per-player map API requests and the Google key. See the [architecture note](docs/architecture.md) and [data sources](docs/data-sources.md).

Open the [live arena](https://kushagrabainsla.github.io/hereafter/).

## Run locally

Install Node.js 22.12 or newer, then run:

```sh
npm ci
npm run dev
```

Open the URL printed by Vite. No API key or billing account is needed. The 3D arena asset is bundled with the site. The browser needs WebGPU or WebGL 2; Three.js uses WebGPU when available and falls back to WebGL 2. Rapier's WebAssembly module handles character movement and collision.

A loading screen shows progress while the arena, models and sounds download and the shaders compile. You spawn at walking height on a clear street in a 140 × 140 m playable block, with visible first-person hands and a field knife. Press H, or click the small control hint, to open the controls modal; movement pauses while it is open. Use the arrow keys or WASD to walk, hold Shift to run, press Space to jump, and hold C or Ctrl to crouch. Crouch while running to slide, and press Space facing concrete cover or another ledge up to 1.6 m high to climb onto it. Hold Q or E to lean around cover. Walk into a ladder to climb it, or take the steel stair, to reach the low roofs; falls from height hurt. Click and drag on the map with a trackpad or mouse to move the view; a short click attacks. Press F to attack from the keyboard. Double-click the map for FPS mouse look and press Esc to release it. The supported arena coordinates can still be supplied in a URL, but are not shown during play.

Pistols and carbines appear at marked spots on the street, shown as the same models you hold. Walk close and press E to collect one; collected weapons return after 30 seconds. Use 1, 2, or 3 to equip the knife, pistol, or carbine, and R to reload a gun. Switching lowers the current weapon and raises the next one over about half a second, and you cannot attack until the new weapon is up. Sprinting carries the weapon low across the body; firing drops the sprint and the shot follows as the weapon comes up. Shots spread more while walking, sliding or in the air and less when crouched, and the carbine blooms under sustained fire; the crosshair opens to show it. See [movement notes](docs/movement.md). The HUD shows health, ammo, kills, and deaths. Hits flash a marker around the crosshair: white for a hit, amber for a headshot, and red with an elimination banner for a kill. Damage taken shows a red arc pointing toward the attacker. Press G to throw one of your two fragmentation grenades; it bounces, rolls and bursts 2.6 s later. Rounds penetrate glass, crates, bins, cardboard and bodies by material, and windows, lamps, crates, boxes, planters and even concrete barriers break once damaged enough; bins, drums and crates get thrown around by blasts. Eliminated players fall as ragdolls. After elimination, wait three seconds and press Enter to respawn with the knife. See [physics notes](docs/physics.md).

The game has sound once you click or press a key. Gunshots, reloads, weapon handling and footsteps are recorded CC0 sounds; other players' shots and footsteps come from where they are, are dulled by distance and walls, and close rounds crack past you. Press M to mute or unmute. See [audio notes](docs/audio.md).

## Maps

Press the Map button at the top right to choose a map. **Night Market** is a 60 m back-alley market at dusk with three lanes: a stall-lined market alley, a restaurant you can run through, and a service alley behind. It has a bar with a stair to a balcony, a fire escape, wooden stalls that break apart, and shop glass you can shoot out and climb through. **San Jose** is the open-data downtown block. Open `?map=night-market` to go straight to the market. See [maps](docs/maps.md).

## Play together

Click **Play together**, create a room, and share the invite link. Another player can open that link to join automatically, or enter the room code manually. Both browsers render the same arena and show each other as animated soldiers with their movement, health, and weapon pickups. Room spawns are spaced apart. The current build has been verified with two browser tabs; the 2–8 player target still needs larger-session testing.

The site remains static on GitHub Pages. [Trystero](https://trystero.dev/) uses public Nostr relays to help browsers find each other, then carries gameplay data over WebRTC data channels. The public relays require no account or project server for this prototype. Some networks cannot establish a direct connection without a TURN relay; one is not configured yet. A room code is a shareable invite secret, not a user identity system. One peer checks attack range, cover, ammo, timing, and pickup distance, then shares health and inventory state. Movement is still client reported, so the prototype is unsuitable for competitive matches. See [multiplayer architecture](docs/multiplayer.md).

Run `npm run build` for a local production build. Run `npm run build:pages` to build with the `/hereafter/` path prefix for GitHub Pages, then `npm run preview:pages` to inspect that build locally.

## Arena data

`public/arena/san-jose.json` contains the full source extract. The default game loads `public/arena/san-jose-block.json`, a smaller build with the playable block and a 65 m visual buffer. The site does not call OpenStreetMap or USGS at runtime. To refresh both files, run `npm run build:arena` from the repository root. That build step makes one bounded OpenStreetMap data request and 25 USGS elevation point requests. Run `npm run build:block` to rebuild only the block from the existing full extract.

Ground, grass, asphalt, pavement, walls, roofs, bark, leaf silhouettes, the daylight sky, and detailed concrete cover use bundled CC0 art from [Poly Haven](https://polyhaven.com/license), with normal maps on key surfaces. Ground-floor storefronts use two generated photo textures. Building windows, doors, awnings, ledges, facade trim, streetlights, curbs, crosswalks, manholes, drains, planters, and hydrants are geometry. Trees have layered leaf cards with subtle wind motion.

The first-person arms and weapons are authored, rigged models: the gloved arms of a Microsoft Rocketbox avatar (MIT) holding a Poly Haven knife and pistol (CC0) and an OpenGameArt AKM (CC0), each with idle, walk, run and fire clips. They are built from the sources by `npm run build:viewmodels`, which needs Blender 4.4 or newer and downloads the sources on first use. Other players are the same soldier as a rigged third-person character with idle, walk, run, crouch and death clips from the Rocketbox animation library. If a model is missing or fails to load, the procedural gloved hands, weapon or mannequin take its place. See [data sources](docs/data-sources.md) for the asset records and [rendering notes](docs/rendering.md) for the pipeline. WebGPU and WebGL 2 both use dynamic shadows and the detailed materials. The browser makes no texture API requests; the underlying map data remains the same.

Buildings and roads are grouped into spatial cells for view culling. Render resolution adjusts after sustained slow or fast frame rates. The performance label's hover text shows draw calls, triangles, and resolution. Add `?renderer=webgl` to the URL to test WebGL 2. See [rendering notes](docs/rendering.md) for measurements and the next fidelity steps.

The adapted OpenStreetMap data in this asset is offered under the [Open Database License (ODbL)](https://opendatacommons.org/licenses/odbl/1-0/). In-game attribution links to [OpenStreetMap contributors](https://www.openstreetmap.org/copyright). USGS 3DEP elevation data is public domain. This repository's software code does not yet have a selected license.

## Current limitations

- The arena is geographically based on real roads and building footprints, but its buildings, windows, trees, and street furniture are still approximations. Some building heights are inferred where the data has no height tag.
- The terrain is interpolated from a 5 × 5 USGS height grid. Walking follows this coarse ground surface.
- Only the San Jose pilot extract is bundled. A new city needs a new data build and level design.
- Rapier runs a fixed 60 Hz capsule controller against terrain, building walls, roofs, trees, furniture, poles, concrete cover, props and arena boundaries. It supports wall sliding, ground snapping, low steps, jumping, crouching with a standing-clearance check, sliding, leaning, ladders, and mantling onto ledges up to 1.6 m. Only the low buildings inside the block can be climbed, by one stair and five ladders; there are no moving platforms.
- Gunfire traces every surface along the shot through the physics world and penetrates by material. Peer movement still originates on each player's device; distance and arena checks reject implausible pose packets, but a modified client can still cheat. Hits are lag-compensated by rewinding targets up to 350 ms to what the shooter saw. Robust authority handoff and larger-session testing remain future work.
- The view-model clips are generated in Blender from a small motion description (bob, carry, recoil, thrust) rather than captured or hand-keyed; there are no reload, crouch or aim clips yet, and switching reuses the procedural lower-and-raise motion. Other players hold their weapon at the side: there is no aim or fire clip for the character, and crouch-walking shows the crouch idle.
- Sound effects are recorded CC0 samples mixed in the browser. There is no ambient street sound, voice or music yet.
- Buildings have no interiors, ragdolls are not synchronised between players, and destroyed objects stay destroyed until the room resets. Players do not push props by walking into them.
- GitHub Pages has [site-size and bandwidth limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits); the current arena is small enough for the intended prototype.

## Project status

The Phase 1 arena, FPS movement, peer rooms, pickups, health, and basic combat are runnable. Fully trusted movement, robust host migration, audio, and larger-session testing remain to be built.
