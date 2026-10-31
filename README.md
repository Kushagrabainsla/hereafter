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

A loading screen shows progress while the map, models and sounds load and the shaders compile. You spawn at one end of an alley with visible first-person hands and a field knife. Press H, or click the control hint, to open the controls; movement pauses while it is open. Use the arrow keys or WASD to walk, hold Shift to run, press Space to jump, and hold C or Ctrl to crouch. Crouch while running to slide, and press Space facing a counter, a dumpster or another ledge up to 1.6 m high to climb onto it. Hold Q or E to lean around cover. Walk into a ladder to climb to the fire escape or the bar balcony, or take the stair inside the bar; falls from height hurt. Click and drag with a trackpad or mouse to look around; a short click attacks. Press F to attack from the keyboard. Double-click for FPS mouse look and press Esc to release it. Everything you carry has weight: the HUD shows the load, and guns and magazines slow your walk, sprint, jump, starting and stopping. Walking into crates, bins, boxes and drums shoves them by your mass, so a box flies while a full drum barely shifts.

Every life starts with the knife and two grenades. Pistols and carbines lie at marked spots, shown as the same models you hold, and each comes with the one magazine in it: 12 rounds or 30. Spare magazines lie in pairs on tables, counters, a dumpster, the fire escape and the bar's upper floor. Walk close and press E to take one; guns return after 30 seconds and magazines after 25. E also opens and closes the food truck's doors and serving hatch. Taking a second gun of a kind you carry strips its magazine. Use 1, 2, or 3 to equip the knife, pistol, or carbine, and R to swap in your fullest spare magazine. A magazine with rounds left goes back in the pouch and an empty one drops to the ground; a round already chambered stays there, so a pistol reloaded early holds 13. Once the spares run out, the gun is empty until you find more. The HUD shows the rounds in the gun and in reserve, with a bar for each spare magazine. A fallen player drops their guns and magazines, which tumble to the ground and can be taken for a minute.

The knife has two strokes. Click or press F to slash: the blade sweeps across from upper right to lower left and stops at the first thing it meets, catching a head for 45, a body for 30 or legs for 22. Right-click or press V to stab: the arm draws back, you lunge a step and drive the point straight in, for 55 to the body and 100 to the head. A stab in the back is fatal. The blade lands when the swing reaches the target, about 0.13 s into a slash and 0.24 s into a stab, bites briefly into a body, and glances off walls and metal with a ring. Switching lowers the current weapon and raises the next one over about half a second, and you cannot attack until the new weapon is up. Sprinting carries the weapon low across the body; firing drops the sprint and the shot follows as the weapon comes up. Shots spread more while walking, sliding or in the air and less when crouched, and the carbine blooms under sustained fire; the crosshair opens to show it. See [movement notes](docs/movement.md). The HUD shows health, ammo, kills, and deaths. Hits flash a marker around the crosshair: white for a hit, amber for a headshot, and red with an elimination banner for a kill. Damage taken shows a red arc pointing toward the attacker. Press G to throw one of your two fragmentation grenades; it bounces, rolls and bursts 2.6 s later, and a blast in the open throws nearby players off their feet. Rounds penetrate glass, crates, bins, cardboard, stalls and bodies by material. Windows, shop glass, wooden stalls, crates and boxes break once damaged enough, and bins, drums and crates get thrown around by blasts. Eliminated players fall as ragdolls. Spent cases spin out of the ejection port and clink across the paving. After elimination, wait three seconds and press Enter to respawn with the knife. See [physics notes](docs/physics.md).

The game has sound once you click or press a key. Gunshots, reloads, weapon handling and footsteps are recorded CC0 sounds; other players' shots and footsteps come from where they are, are dulled by distance and walls, and close rounds crack past you. Press M to mute or unmute. See [audio notes](docs/audio.md).

## The Night Market

The map has three lanes. The market alley in the middle is lined with wooden stalls, lanterns and string lights, and closed at its north end by a food truck you can climb into through its rear doors, serve from through its hatch, and wreck: its glass breaks, its tyres go flat and its propane cylinders vent and explode. Every lamp and sign can be shot out, and a breaker box blacks out the whole service alley. The restaurant, the bar and a record shop through the middle block have real doors that open with E, kick open under the knife and come off their hinges under fire; the record shop's boarded back window can be blown out, and steam pipes on the walls burst into cover when shot. A restaurant on the west side is an indoor route beside it, and a service alley runs behind the middle block. A cut-through and passages at both ends join them. A bar on the east side has a stair to an upper room and a balcony, and a fire escape overlooks the stalls. See [the Night Market](docs/night-market.md) for the layout, what breaks and how it is built.

It is lit at dusk: a painted sky with the last orange glow, stars and lit clouds; real light from every lamp, bulb string, lantern and sign; neon that glows; wet paving that reflects the lights; and windows that show rooms behind them. Light bouncing off walls and floors and the shade in corners, under awnings and in narrow alleys are baked offline with Blender's Cycles into a lightmap; contact shadows, anti-aliasing, a colour grade and fine film grain are added on screen. See [rendering notes](docs/rendering.md).

## Play together

Click **Play together**, create a room, and share the invite link. Another player can open that link to join automatically, or enter the room code manually. Both browsers render the same market and show each other as animated soldiers with their movement, health, and weapon pickups. Room spawns are spread across the alley ends. The current build has been verified with two browser tabs; the 2–8 player target still needs larger-session testing.

The site remains static on GitHub Pages. [Trystero](https://trystero.dev/) uses public Nostr relays to help browsers find each other, then carries gameplay data over WebRTC data channels. The public relays require no account or project server for this prototype. Some networks cannot establish a direct connection without a TURN relay; one is not configured yet. A room code is a shareable invite secret, not a user identity system. One peer checks attack range, cover, ammo, timing, and pickup distance, then shares health and inventory state. Movement is still client reported, so the prototype is unsuitable for competitive matches. See [multiplayer architecture](docs/multiplayer.md).

Run `npm run build` for a local production build. Run `npm run build:pages` to build with the `/hereafter/` path prefix for GitHub Pages, then `npm run preview:pages` to inspect that build locally.

## Assets

Walls, paving and asphalt use bundled CC0 photo materials from [Poly Haven](https://polyhaven.com/license), with normal maps; shop interiors use two generated photo textures. The sky, signs, window interiors, posters, the mural, awnings and wood are drawn in code at load.

The first-person arms and weapons are authored, rigged models: the gloved arms of a Microsoft Rocketbox avatar (MIT) holding a Poly Haven knife and pistol (CC0) and an OpenGameArt AKM (CC0), each with idle, walk, run and fire clips, and slash and stab for the knife. The arms are subdivided to smooth the source's blocky fingers. In the game, the skin and cloth are shaded separately: the gloves and sleeves get a soft fabric sheen, and backlit skin glows red at the edges. The hands are lit by the lamps around the player, with shadows across the fingers and a flash from each shot. The weapon hangs off the hands like a mass on a spring, and breathing deepens after a sprint. They are built from the sources by `npm run build:viewmodels`, which needs Blender 4.4 or newer and downloads the sources on first use. `npm run build:lightmaps` rebakes the market's light after a change to the map; it needs Chrome and Blender. Other players are the same soldier as a rigged third-person character with idle, walk, run, crouch and death clips from the Rocketbox animation library. If a model is missing or fails to load, the procedural gloved hands, weapon or mannequin take its place. See [data sources](docs/data-sources.md) for the asset records.

Render resolution adjusts after sustained slow or fast frame rates. The performance label's hover text shows draw calls, triangles, and resolution. Add `?renderer=webgl` to the URL to test WebGL 2. This repository's software code does not yet have a selected license.

## Current limitations

- There is one map. Its layout is written in code, so a new map means a new module, not a level editor.
- Rapier runs a fixed 60 Hz capsule controller against the map's walls, floors, counters, stalls, props and the arena edge. It supports wall sliding, ground snapping, low steps, jumping, crouching with a standing-clearance check, sliding, leaning, ladders, stairs and mantling onto ledges up to 1.6 m; there are no moving platforms.
- Only the restaurant and the bar can be entered; other shopfronts are pictures behind glass, and doors are open doorways.
- Gunfire traces every surface along the shot through the physics world and penetrates by material. Peer movement still originates on each player's device; distance and arena checks reject implausible pose packets, but a modified client can still cheat. Hits are lag-compensated by rewinding targets up to 350 ms to what the shooter saw. Robust authority handoff and larger-session testing remain future work.
- The view-model clips are generated in Blender from a small motion description (bob, carry, recoil, knife strokes) rather than captured or hand-keyed; there are no reload, crouch or aim clips yet, and switching reuses the procedural lower-and-raise motion. Other players hold their weapon at the side and swing it with a procedural arm motion when they attack; crouch-walking shows the crouch idle.
- The hands come from a game avatar with painted textures, so they look much better than before but not photographic.
- Sound effects are recorded CC0 samples mixed in the browser. There is no ambient market sound, voice or music yet.
- Ragdolls, spent cases and empty magazines are not synchronised between players, and destroyed objects stay destroyed until the room resets. A player who is not coordinating the room pushes props through the coordinator, so the push follows about a tenth of a second late.
- On WebGL 2, the market keeps six real lights and paints the rest of its light onto the ground.
- Baked light covers the static map only. A broken stall leaves its baked shade on the paving, and props, players and stalls get contact shadows from the screen-space pass but no baked bounce light.

## Project status

The map, FPS movement, peer rooms, pickups, health and combat are runnable. Fully trusted movement, robust host migration, ambient sound and larger-session testing remain to be built.
