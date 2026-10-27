# Hereafter

*Fight where you stand.*

Hereafter is a planned browser-based multiplayer first-person shooter set in bounded real-world areas. The first target is a small San Jose, California arena for 2–8 players.

The [project handoff](docs/REAL_WORLD_FPS_AGENT_HANDOFF.md) describes the architecture, phased milestones, and acceptance criteria. Phase 1 is underway: this repository contains a single-player map viewer. Gameplay and multiplayer come later.

## Planned approach

- TypeScript browser client, distributed through GitHub Pages when ready.
- Google Photorealistic 3D Tiles for the first visual prototype, with visible attribution.
- Separate simplified gameplay geometry for physics and collision.
- WebRTC peer connections and a temporary authoritative peer for eventual multiplayer.

The repository does not yet contain gameplay or a deployed site.

## Run the map viewer

1. Install Node.js 22.12 or newer and run `npm install`.
2. In Google Cloud, enable billing and the Map Tiles API, then create a dedicated key for this local prototype.
3. Copy `.env.example` to `.env` and set `VITE_GOOGLE_MAPS_API_KEY`.
4. Run `npm run dev` and open the local URL printed by Vite.

The key is embedded in browser requests, so it is **not a secret** once the app runs. Restrict it to the Map Tiles API, set low quota limits and billing alerts, and use it only for local testing. `.env` is ignored by Git; do not commit API keys or credentials. Google's current [key guidance](https://developers.google.com/maps/faq#which_keys_or_credentials_should_i_use_for_different_maps_products) lists Map Tiles API with an IP address restriction, which a public browser client cannot apply to each player's device. Do not publish a live key in the GitHub Pages build until the map access design is resolved.

Use the form to change the center and 300–500 m arena side length. The URL stores those coordinates for sharing. The camera stays inside the selected square. Click the map to capture the mouse; use WASD to move, Q/E for height, Shift to move faster, and Esc to release the mouse. The diagnostics show frame rate, camera position, and pending tile requests.

Run `npm run build` to check the local production build. `npm run build:pages` uses the `/hereafter/` asset prefix required by this repository's GitHub Pages URL. Neither command deploys the site.

## Current limitations

- A valid Google key and billing are required to view live tiles. The default San Jose location has not yet been verified against live Google coverage because no key is configured here.
- CesiumJS renders this first viewer with WebGL. The handoff's WebGPU goal is a later renderer decision; WebGPU alone cannot run this Cesium viewer.
- Camera movement is bounded, but the tileset is streamed from Google's global root. The visible imagery can extend beyond the arena square. The camera has no building collision yet.
- Only Cesium's own JavaScript, shaders, and worker assets are bundled. Google map content is streamed live and is not saved as a project asset or cached by custom application code.
- Cesium's on-screen credit display is kept visible for Google and data-provider attribution.
- The direct browser Map Tiles request is a local prototype path. A public GitHub Pages release needs a reviewed access design, such as a restricted tile gateway or a different licensed world source, because the planned website restriction is not supported by Google's current Map Tiles key guidance.

Implementation references: [Google's Cesium renderer guide](https://developers.google.com/maps/documentation/tile/use-renderer), [Map Tiles policies](https://developers.google.com/maps/documentation/tile/policies), [API key security](https://developers.google.com/maps/api-security-best-practices), and [Cesium's Vite example](https://github.com/CesiumGS/cesium-vite-example).

## License

No license has been selected yet.
