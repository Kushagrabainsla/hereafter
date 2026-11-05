<div align="center">

# Hereafter

**Fight where you stand.**

A multiplayer first-person shooter that runs in your browser.<br>
Close fights in a hand-built back-alley night market, played peer to peer from a link.<br>
Nothing to install, no account, no game server.

[![Play now](https://img.shields.io/badge/Play_now-in_your_browser-e8a33d?style=for-the-badge)](https://kushagrabainsla.github.io/hereafter/)

[![Deploy](https://github.com/Kushagrabainsla/hereafter/actions/workflows/deploy-pages.yml/badge.svg)](https://github.com/Kushagrabainsla/hereafter/actions/workflows/deploy-pages.yml)
![Players](https://img.shields.io/badge/players-2–8-5b8def)
![Three.js](https://img.shields.io/badge/Three.js-r186-000000?logo=threedotjs)
![WebGPU](https://img.shields.io/badge/WebGPU-WebGL_2_fallback-6e44ff)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6?logo=typescript&logoColor=white)

<img src="docs/images/night-market.jpg" alt="The market alley at dusk: string lights and lanterns over wooden stalls, a food truck at the far end, a carbine in hand" width="100%">

</div>

## About

Hereafter is set in the **Night Market**, a 60 m back-alley market in San Jose's SoFA district at dusk, built by hand for close fights. Everyone starts with a knife and a couple of grenades. Pistols, carbines and spare magazines lie around the market, and every magazine counts. Rounds punch through stalls, glass and crates. Doors come off their hinges, lights get shot out, and fuel drums explode.

It is a working prototype: the map, movement, combat, destruction, sound, rounds and peer-to-peer rooms are all playable.

<table>
  <tr>
    <td><img src="docs/images/two-players.jpg" alt="Another player, a soldier with a carbine, standing between the stalls in a two-player room"></td>
    <td><img src="docs/images/grenade.jpg" alt="A grenade bursting in the middle of the market alley"></td>
  </tr>
  <tr>
    <td align="center"><sub>Another player across the stalls</sub></td>
    <td align="center"><sub>A grenade bursting in the alley</sub></td>
  </tr>
  <tr>
    <td><img src="docs/images/food-truck.jpg" alt="The Bao and Buns food truck closing the north end of the market, under the SoFA Night Market banner"></td>
    <td><img src="docs/images/service-alley.jpg" alt="The service alley behind the market, with dumpsters and the bar's neon sign"></td>
  </tr>
  <tr>
    <td align="center"><sub>The food truck at the north end</sub></td>
    <td align="center"><sub>The service alley and the bar</sub></td>
  </tr>
</table>

## Features

**Combat**
- A field knife with two strokes. A slash sweeps across and stops at the first thing it meets. A stab lunges in for 100 to the head, and a stab in the back is fatal.
- 9 mm pistols (12 rounds) and carbines (30 rounds), found on the map. Each comes with only the magazine in it.
- Real magazines. A reload swaps in your fullest spare: a part-used one goes back in the pouch, an empty one drops to the ground. When the spares run out, the gun is empty.
- Frag grenades that bounce, roll and throw players off their feet, and smoke grenades that pour out a 7 m grey wall.
- Head, body and leg hit zones. Spread grows while moving, jumping or firing long bursts, and the crosshair shows it.
- Aim down the sights with right-click: the view zooms in, the gun steadies and spread halves, but you walk at half pace.
- Rounds penetrate by material: glass, crates, bins, cardboard, wooden stalls and bodies.

**Movement**
- Run, crouch, slide, and lean around cover.
- Climb onto counters, dumpsters and ledges up to 1.6 m. Ladders lead to the fire escape and the bar's balcony.
- Everything you carry has weight, and guns and magazines slow you down. Falls from height hurt.

**A market that breaks**
- Stalls tear, then collapse into low cover you can climb.
- Windows shatter. Doors open, kick in, or come off their hinges.
- Every lamp and sign can be shot out. One breaker box blacks out the whole service alley.
- Steam pipes burst into cover. Fuel drums vent and explode. The food truck's propane cylinders go up.

**Matches**
- Five-minute rounds, or first to 15 kills. The winner is shown on the scoreboard, and the next round starts 12 seconds later with the market rebuilt.
- A scoreboard on <kbd>Tab</kbd> with kills, deaths and ping, a round clock, and a kill feed naming who got whom.
- Set up each match on the opening screen: single player or a room, the map, your callsign, your voice (Hindi, English or grunts only), 18+ lines and meme sounds. Your choices are saved in your browser and can be changed during play.

**Multiplayer**
- Share a link and play together, 2 to 8 players, browser to browser over WebRTC, with no game server.
- The map downloads while you set up the match; a player opening the link connects while their world is still building.
- If the host's tab crashes, play carries on after about 2 seconds. If the host switches tabs, the role moves to another player straight away.

**Look and sound**
- Rendered with Three.js on WebGPU, falling back to WebGL 2. On WebGPU every lamp, bulb string and sign is a real light.
- Light bouncing off walls and floors is baked offline in Blender's Cycles. Wet paving reflects the lamps.
- Recorded gunshots, reloads and footsteps, placed in 3D: dulled by distance and walls, with close rounds cracking past you.
- A market that sounds alive: traffic beyond the walls, humming neon and air conditioners, and music thumping from the bar.
- Players have voices: grunts, cries and sprint breathing, and calls, taunts and banter in **Hindi or English**, with an opt-in 18+ tier of gaalis and swearing. English lines are placeholders and Hindi lines are silent until recorded; see the [recording sheet](docs/voice-lines.md).
- Meme sounds on top: a vine boom on a headshot, an air horn on a double kill, a metal pipe on a hard landing, crickets after a round with no kills, and famous meme lines in Hindi and English once their clips are added ([list](docs/voice-lines.md#memes)).

## How to play

Open the [live game](https://kushagrabainsla.github.io/hereafter/) in a desktop browser with WebGPU or WebGL 2, and click to start the sound. You spawn at one end of an alley with a knife. Find a gun, find magazines, and stay alive.

| Action | Keys |
|---|---|
| Move | <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> or arrow keys |
| Run | hold <kbd>Shift</kbd> |
| Jump, or climb a ledge you face | <kbd>Space</kbd> |
| Crouch (while running: slide) | hold <kbd>C</kbd> or <kbd>Ctrl</kbd> |
| Lean | hold <kbd>Q</kbd> or <kbd>E</kbd> |
| Look | move the mouse: it locks when you press Deploy. <kbd>Esc</kbd> frees it, a click locks it again; unlocked, drag to look |
| Attack, or slash with the knife | click or <kbd>F</kbd> |
| Stab with the knife | right-click or <kbd>V</kbd> |
| Aim down the sights, with a gun | hold right-click |
| Knife, pistol, carbine | <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> |
| Reload | <kbd>R</kbd> |
| Pick up, open doors and hatches | <kbd>E</kbd> |
| Frag grenade, smoke grenade | <kbd>G</kbd>, <kbd>T</kbd> |
| Respawn, three seconds after you fall | <kbd>Enter</kbd> |
| Scoreboard | hold <kbd>Tab</kbd> |
| Mute | <kbd>M</kbd> |
| Show the controls | <kbd>H</kbd> |

## Play with friends

1. On the setup screen choose **Multiplayer**, keep **Create room** and press **Deploy**.
2. Press **Room** at the top right, copy the invite link and send it to your friends.
3. Their setup screen opens on your room; they press **Deploy**. Or they type in the room code and choose **Join**.

Once two players are in, a ten-second countdown starts the first round. Change your name, voice and sound choices under **Room** at any time.

Rooms are found through public Nostr relays and played over direct WebRTC connections between browsers; the game itself is static files on GitHub Pages. One player's browser checks combat for the room (range, cover, ammo, timing), and that role moves to another player if they leave, crash or switch tabs. Some networks block direct connections and would need a TURN relay, which isn't set up yet. See [multiplayer](docs/multiplayer.md) for how it works and [network benchmarks](docs/network-benchmarks.md) for the measurements behind it.

## Run it yourself

You need [Node.js](https://nodejs.org/) 22.12 or newer and a browser with WebGPU or WebGL 2.

```sh
git clone https://github.com/Kushagrabainsla/hereafter.git
cd hereafter
npm ci
npm run dev
```

Open the URL Vite prints. No API key or account is needed: every asset the game uses is in the repository.

| Command | What it does |
|---|---|
| `npm run dev` | Development server with hot reload |
| `npm run build` | Type-check and build into `dist/` |
| `npm run build:pages` | Build for GitHub Pages, under `/hereafter/` |
| `npm run preview:pages` | Serve the Pages build locally |
| `npm run build:assets` | Rebuild the modelled lamps, signs, furniture, street dressing, items, building dressing and effects, checked and compressed (needs Blender 4.4+) |
| `npm run build:textures` | Rebake the wood floor and kitchen tile textures in Blender |
| `npm run build:viewmodels` | Rebuild the first-person arms and weapons (needs Blender 4.4+) |
| `npm run build:lightmaps` | Rebake the market's light after a map change (needs Chrome and Blender) |
| `npm run build:audio` | Download and rebuild the sound effects |
| `npm run build:voices` | Rebuild the players' voices and memes from any recorded lines and added clips |
| `npm run build:memes` | Download and rebuild the meme sound effects (after `build:audio`, which fetches one of them) |

Add `?renderer=webgl` to the URL to force WebGL 2. Pushes to `main` deploy to GitHub Pages through [`deploy-pages.yml`](.github/workflows/deploy-pages.yml).

## Built with

- [Three.js](https://threejs.org/) r186, WebGPU renderer with node materials, falling back to WebGL 2
- [Rapier](https://rapier.rs/) physics in WebAssembly, for the 60 Hz character controller, collisions, shots and ragdolls
- [Trystero](https://github.com/dmotz/trystero), for peer-to-peer rooms over WebRTC, found through Nostr relays
- [Vite](https://vite.dev/) and TypeScript
- [Blender](https://www.blender.org/), for the view models, the food truck, the wall kit, the lamps, signs, furniture, street dressing, items, building dressing and effects, and the baked floor and tile textures (through the [asset pipeline](docs/asset-pipeline.md)) and the baked lightmaps

```
src/
  main.ts          HUD, input, rooms, and the game loop that ties it together
  game/            player movement, combat rules, match state, weapons, sound, other players
  network/         peer room: positions, the host's updates, choosing and replacing the host
  world/           the Night Market's layout, buildings, stalls, lights, physics and renderer
scripts/           Blender and audio build scripts for the bundled assets
public/            models, textures, lightmaps and sounds shipped with the game
docs/              design and engineering notes
```

## Documentation

| Note | What's in it |
|---|---|
| [The Night Market](docs/night-market.md) | The map: lanes, spawns, pickups, what breaks and how |
| [Movement](docs/movement.md) | Character controller, climbing, leaning, weight, spread |
| [Physics](docs/physics.md) | Penetration, destruction, grenades, ragdolls |
| [Rendering](docs/rendering.md) | Lighting, lightmaps, post-processing, performance |
| [Audio](docs/audio.md) | The mix, positional sound and occlusion |
| [Multiplayer](docs/multiplayer.md) | Rooms, the host, the protocol and its limits |
| [Network benchmarks](docs/network-benchmarks.md) | Measured traffic, delays and recovery, step by step |
| [Architecture](docs/architecture.md) | How the pieces fit |
| [Asset pipeline](docs/asset-pipeline.md) | How every model is built in Blender, checked and placed, and the phases still to come |
| [Asset sources](docs/data-sources.md) | Every model, texture and sound, with its license |
| [Voice lines](docs/voice-lines.md) | Every line players say, and how to record them |

## Known limitations

- One map. Its layout is written in code, not built in an editor. Everything you see is modelled in Blender except the walls and ground, which are flat surfaces with photographed textures and baked light, and the soft particles (smoke, steam, fire, haze) and tracers (see the [asset pipeline](docs/asset-pipeline.md)).
- Movement comes from each player's own browser. Distance and bounds checks reject impossible moves, but a modified client could still cheat, so this isn't ready for competitive play.
- Only the restaurant, the bar and the record shop can be entered.
- No voice chat yet.
- Ragdolls, spent cases and dropped magazines aren't synced between players. Destroyed objects stay destroyed until the next round.
- The view-model animations are generated from a simple motion description. There are no reload, crouch or aim-down-sights clips yet.
- The first load builds every shader before the first frame, which can hold the page still for a while on slower machines.

## Credits

- Textures, props, the knife and the pistol: [Poly Haven](https://polyhaven.com/) (CC0)
- Arms and the third-person soldier: [Microsoft Rocketbox](https://github.com/microsoft/Microsoft-Rocketbox) (MIT)
- Carbine: [AKM](https://opengameart.org/content/akm) by LonesomeDucky, OpenGameArt (CC0)
- Sounds, all CC0: [The Free Firearm Sound Library](https://opengameart.org/content/the-free-firearm-sound-library), reload packs on OpenGameArt, and [Kenney](https://kenney.nl/)'s Impact Sounds and RPG Audio

- Voices: grunts and cries by HaelDB on OpenGameArt (CC0); placeholder English lines from [Piper](https://github.com/OHF-Voice/piper1-gpl) with its public-domain "norman" voice
- Meme sound effects, all CC0: [BigSoundBank](https://bigsoundbank.com/), OpenGameArt, Kenney, and instruments from [VS Chamber Orchestra Community Edition](https://github.com/sgossner/VSCO-2-CE)
- Fonts: [Barlow and Barlow Condensed](https://github.com/jpt/barlow) by Jeremy Tribby and [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono), both under the SIL Open Font License

Full records, with authors and links, are in [asset sources](docs/data-sources.md).

## License

The code doesn't have a license yet. The bundled assets keep their own licenses, listed in [asset sources](docs/data-sources.md).
