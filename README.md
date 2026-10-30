# Hereafter

*Fight where you stand.*

Hereafter is a browser-based multiplayer FPS prototype for 2–8 players. It is set in the Night Market, a 60 m back-alley market in San Jose's SoFA district at dusk, built by hand for close fights. The current build has first-person movement, peer-to-peer rooms and a full combat loop.

The [original handoff](docs/REAL_WORLD_FPS_AGENT_HANDOFF.md) describes the first staged plan, built around real city data. The game has since moved to a hand-built map; see the [architecture note](docs/architecture.md).

Open the [live game](https://kushagrabainsla.github.io/hereafter/).

## Run locally

Install Node.js 22.12 or newer, then run:

```sh
npm ci
npm run dev
```

Open the URL printed by Vite. No API key or account is needed; everything the game uses is bundled with the site. The browser needs WebGPU or WebGL 2. Three.js uses WebGPU when available and falls back to WebGL 2. Rapier's WebAssembly module handles character movement and collision.

A loading screen shows progress while the map, models and sounds load and the shaders compile. You spawn at one end of an alley with visible first-person hands and a field knife. Press H, or click the control hint, to open the controls; movement pauses while it is open. Use the arrow keys or WASD to walk, hold Shift to run, press Space to jump, and hold C or Ctrl to crouch. Crouch while running to slide, and press Space facing a counter, a dumpster or another ledge up to 1.6 m high to climb onto it. Hold Q or E to lean around cover. Walk into a ladder to climb to the fire escape or the bar balcony, or take the stair inside the bar; falls from height hurt. Click and drag with a trackpad or mouse to look around; a short click attacks. Press F to attack from the keyboard. Double-click for FPS mouse look and press Esc to release it.

Pistols and carbines lie at marked spots, shown as the same models you hold. Walk close and press E to collect one; collected weapons return after 30 seconds. Use 1, 2, or 3 to equip the knife, pistol, or carbine, and R to reload a gun. Switching lowers the current weapon and raises the next one over about half a second, and you cannot attack until the new weapon is up. Sprinting carries the weapon low across the body; firing drops the sprint and the shot follows as the weapon comes up. Shots spread more while walking, sliding or in the air and less when crouched, and the carbine blooms under sustained fire; the crosshair opens to show it. See [movement notes](docs/movement.md). The HUD shows health, ammo, kills, and deaths. Hits flash a marker around the crosshair: white for a hit, amber for a headshot, and red with an elimination banner for a kill. Damage taken shows a red arc pointing toward the attacker. Press G to throw one of your two fragmentation grenades; it bounces, rolls and bursts 2.6 s later. Rounds penetrate glass, crates, bins, cardboard, stalls and bodies by material. Windows, shop glass, wooden stalls, crates and boxes break once damaged enough, and bins, drums and crates get thrown around by blasts. Eliminated players fall as ragdolls. After elimination, wait three seconds and press Enter to respawn with the knife. See [physics notes](docs/physics.md).

The game has sound once you click or press a key. Gunshots, reloads, weapon handling and footsteps are recorded CC0 sounds; other players' shots and footsteps come from where they are, are dulled by distance and walls, and close rounds crack past you. Press M to mute or unmute. See [audio notes](docs/audio.md).

## The Night Market

The map has three lanes. The market alley in the middle is lined with wooden stalls, lanterns and string lights. A restaurant on the west side is an indoor route beside it, and a service alley runs behind the middle block. A cut-through and passages at both ends join them. A bar on the east side has a stair to an upper room and a balcony, and a fire escape overlooks the stalls. See [the Night Market](docs/night-market.md) for the layout, what breaks and how it is built.

It is lit at dusk: a painted sky with the last orange glow, stars and lit clouds; real light from every lamp, bulb string, lantern and sign; neon that glows; wet paving that reflects the lights; and windows that show rooms behind them. See [rendering notes](docs/rendering.md).

## Play together

Click **Play together**, create a room, and share the invite link. Another player can open that link to join automatically, or enter the room code manually. Both browsers render the same market and show each other as animated soldiers with their movement, health, and weapon pickups. Room spawns are spread across the alley ends. The current build has been verified with two browser tabs; the 2–8 player target still needs larger-session testing.

The site remains static on GitHub Pages. [Trystero](https://trystero.dev/) uses public Nostr relays to help browsers find each other, then carries gameplay data over WebRTC data channels. The public relays require no account or project server for this prototype. Some networks cannot establish a direct connection without a TURN relay; one is not configured yet. A room code is a shareable invite secret, not a user identity system. One peer checks attack range, cover, ammo, timing, and pickup distance, then shares health and inventory state. Movement is still client reported, so the prototype is unsuitable for competitive matches. See [multiplayer architecture](docs/multiplayer.md).

Run `npm run build` for a local production build. Run `npm run build:pages` to build with the `/hereafter/` path prefix for GitHub Pages, then `npm run preview:pages` to inspect that build locally.

## Assets

Walls, paving and asphalt use bundled CC0 photo materials from [Poly Haven](https://polyhaven.com/license), with normal maps; shop interiors use two generated photo textures. The sky, signs, window interiors, posters, the mural, awnings and wood are drawn in code at load.

The first-person arms and weapons are authored, rigged models: the gloved arms of a Microsoft Rocketbox avatar (MIT) holding a Poly Haven knife and pistol (CC0) and an OpenGameArt AKM (CC0), each with idle, walk, run and fire clips. They are built from the sources by `npm run build:viewmodels`, which needs Blender 4.4 or newer and downloads the sources on first use. Other players are the same soldier as a rigged third-person character with idle, walk, run, crouch and death clips from the Rocketbox animation library. If a model is missing or fails to load, the procedural gloved hands, weapon or mannequin take its place. See [data sources](docs/data-sources.md) for the asset records.

Render resolution adjusts after sustained slow or fast frame rates. The performance label's hover text shows draw calls, triangles, and resolution. Add `?renderer=webgl` to the URL to test WebGL 2. This repository's software code does not yet have a selected license.

## Current limitations

- There is one map. Its layout is written in code, so a new map means a new module, not a level editor.
- Rapier runs a fixed 60 Hz capsule controller against the map's walls, floors, counters, stalls, props and the arena edge. It supports wall sliding, ground snapping, low steps, jumping, crouching with a standing-clearance check, sliding, leaning, ladders, stairs and mantling onto ledges up to 1.6 m; there are no moving platforms.
- Only the restaurant and the bar can be entered; other shopfronts are pictures behind glass, and doors are open doorways.
- Gunfire traces every surface along the shot through the physics world and penetrates by material. Peer movement still originates on each player's device; distance and arena checks reject implausible pose packets, but a modified client can still cheat. Hits are lag-compensated by rewinding targets up to 350 ms to what the shooter saw. Robust authority handoff and larger-session testing remain future work.
- The view-model clips are generated in Blender from a small motion description (bob, carry, recoil, thrust) rather than captured or hand-keyed; there are no reload, crouch or aim clips yet, and switching reuses the procedural lower-and-raise motion. Other players hold their weapon at the side: there is no aim or fire clip for the character, and crouch-walking shows the crouch idle.
- Sound effects are recorded CC0 samples mixed in the browser. There is no ambient market sound, voice or music yet.
- Ragdolls are not synchronised between players, and destroyed objects stay destroyed until the room resets. Players do not push props by walking into them.
- On WebGL 2, the market keeps six real lights and paints the rest of its light onto the ground.

## Project status

The map, FPS movement, peer rooms, pickups, health and combat are runnable. Fully trusted movement, robust host migration, ambient sound and larger-session testing remain to be built.
