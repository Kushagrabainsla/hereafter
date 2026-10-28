# Hereafter

*Fight where you stand.*

Hereafter is a planned browser-based multiplayer FPS in bounded real-world arenas. The first target is downtown San Jose, California for 2–8 players. The current build is a single-player first-person movement preview; it has no combat or multiplayer yet.

The [original handoff](docs/REAL_WORLD_FPS_AGENT_HANDOFF.md) describes the staged game plan. Its Google Photorealistic 3D Tiles approach has been replaced for this first arena with a static open-data build, eliminating per-player map API requests and the Google key. See the [architecture note](docs/architecture.md) and [data sources](docs/data-sources.md).

Open the [live arena](https://kushagrabainsla.github.io/hereafter/).

## Run locally

Install Node.js 22.12 or newer, then run:

```sh
npm ci
npm run dev
```

Open the URL printed by Vite. No API key or billing account is needed. The 3D arena asset is bundled with the site. The browser needs WebGPU or WebGL 2; Three.js uses WebGPU when available and falls back to WebGL 2.

You spawn at walking height on a clear street with visible first-person hands. Use the arrow keys or WASD to walk, hold Shift to run, press Space to jump, hold C or Ctrl to crouch, and press R to respawn. Click and drag on the map with a trackpad or mouse to look around. Double-click the map for mouse lock and press Esc to release it. The form adjusts the arena center and side length within the bundled San Jose extract; the URL keeps those settings for sharing.

Run `npm run build` for a local production build. Run `npm run build:pages` to build with the `/hereafter/` path prefix for GitHub Pages, then `npm run preview:pages` to inspect that build locally.

## Arena data

`public/arena/san-jose.json` contains building outlines and heights, road segments, park outlines, tree locations, and a small terrain height grid. The site does not call OpenStreetMap or USGS at runtime. To refresh the same San Jose extract, run `npm run build:arena` from the repository root. That build step makes one bounded OpenStreetMap data request and 25 USGS elevation point requests. The resulting file is about 220 KB.

Ground, grass, asphalt, pavement, facades, roofs, bark, and foliage use deterministic procedural textures generated in the browser. They are bundled as code and make no network requests. These details improve the stylized arena; the underlying map data remains the same.

The adapted OpenStreetMap data in this asset is offered under the [Open Database License (ODbL)](https://opendatacommons.org/licenses/odbl/1-0/). In-game attribution links to [OpenStreetMap contributors](https://www.openstreetmap.org/copyright). USGS 3DEP elevation data is public domain. This repository's software code does not yet have a selected license.

## Current limitations

- The arena is geographically based on real roads and building footprints, but uses stylized geometry. Some building heights are inferred where the data has no height tag.
- The terrain is interpolated from a 5 × 5 USGS height grid. Walking follows this coarse ground surface.
- Only the San Jose pilot extract is bundled. A new city needs a new data build and level design.
- Building footprints, tree trunks, and arena edges block walking. This is simple horizontal collision; stairs, detailed physics, shooting, rooms, and host migration belong to later phases.
- GitHub Pages has [site-size and bandwidth limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits); the current arena is small enough for the intended prototype.

## Project status

The Phase 1 arena and an initial part of the Phase 2 FPS sandbox are runnable. Combat and multiplayer remain to be built.
