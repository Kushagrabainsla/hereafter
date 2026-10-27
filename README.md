# Hereafter

*Fight where you stand.*

Hereafter is a planned browser-based multiplayer first-person shooter set in bounded real-world areas. The first target is a small San Jose, California arena for 2–8 players.

The project is at the planning stage. The [project handoff](docs/REAL_WORLD_FPS_AGENT_HANDOFF.md) describes the architecture, phased milestones, and acceptance criteria. The first implementation milestone is a single-player map viewer; gameplay and multiplayer come later.

## Planned approach

- TypeScript browser client, distributed through GitHub Pages when ready.
- Google Photorealistic 3D Tiles for the first visual prototype, with visible attribution.
- Separate simplified gameplay geometry for physics and collision.
- WebRTC peer connections and a temporary authoritative peer for eventual multiplayer.

The repository does not yet contain a runnable game or a deployed site.

## Development

Start with the Phase 1 map viewer described in the handoff. Keep API keys and credentials out of Git; restrict any Google Maps Platform key by application, API, quota, and billing controls before using it.

## License

No license has been selected yet.
