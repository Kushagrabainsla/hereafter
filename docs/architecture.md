# Phase 1 architecture and open decision

The current browser viewer uses `src/world/mapViewer.ts` as the world-renderer boundary. It owns Cesium initialization, Google tile streaming, attribution, loading events, and frame diagnostics. `src/world/cameraControls.ts` owns bounded camera movement. `src/world/arena.ts` owns center and size validation. `src/main.ts` connects those modules to the page.

The map viewer has no gameplay physics or multiplayer state. A future gameplay geometry layer should provide its own colliders rather than treating the streamed photorealistic mesh as authoritative collision data.

## Map key decision before public deployment

The handoff assumes a Google Map Tiles API key can be restricted to the GitHub Pages domain. Google's current [API/SDK credential table](https://developers.google.com/maps/faq#which_keys_or_credentials_should_i_use_for_different_maps_products) instead lists the Map Tiles API with an IP address restriction, and its [security guidance](https://developers.google.com/maps/api-security-best-practices) groups Map Tiles with web services. A key embedded in a static page is visible to every visitor and cannot use a fixed source IP for requests from their devices.

The direct Cesium request is therefore for local validation only, using a dedicated API-restricted key with low quota and billing alerts. Before enabling a public GitHub Pages client, test whether Google's current account and API terms permit a suitable restricted access path. If they do not, use a small tile gateway with appropriate controls or replace the world source with owned/open/licensed data. This does not require a permanent gameplay server, but it changes the map delivery architecture.

## Renderer status

CesiumJS currently supplies the Google 3D Tiles renderer through WebGL. The planned WebGPU renderer is not part of Phase 1. Keep the `MapViewer` boundary when evaluating a WebGPU-capable renderer later.
