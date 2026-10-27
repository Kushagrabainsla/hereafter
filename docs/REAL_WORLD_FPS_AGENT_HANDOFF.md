# Hereafter

*Fight where you stand.*

## Real World Multiplayer FPS Agent Handoff

## Mission

Build a browser-based multiplayer first-person shooter that lets a small group of players choose a real-world area and play in it. The first usable target is a small San Jose, California arena played by 2-8 people. The client must run directly in a browser from GitHub Pages, and runtime gameplay should be distributed across participating devices rather than depend on a permanent central game server.

The first goal is a working vertical slice, not a complete city-scale game.

## Product definition

Players should be able to:

1. Open the GitHub Pages URL.
2. Load the game client automatically in a modern browser.
3. Select or join a bounded map area.
4. Create or join a room.
5. See the same real-world environment and other players.
6. Move, aim, shoot, take damage, respawn, and score.
7. Continue playing if the temporary coordinating peer leaves, through host migration.

Initial scope:

- 2-8 players
- One San Jose arena
- One team deathmatch mode
- Desktop browser controls first
- Internet required for GitHub Pages and map tile loading
- No user-installed executable
- No permanent dedicated game server
- No GTA-like city-scale detail in the first milestone

## Fixed architecture decisions

### Client

Use a static browser client:

- TypeScript
- WebGPU as the primary renderer
- WebGL fallback where practical
- Browser Cache Storage or IndexedDB for client assets
- GitHub Pages for static distribution

The browser automatically downloads and caches JavaScript, WebAssembly, shaders, textures, and audio. Players do not manually install the game.

### World layer

Use Google Photorealistic 3D Tiles for the first visual prototype, rendered through CesiumJS or an equivalent 3D Tiles renderer.

Important constraints:

- Tiles are streamed live from Google.
- They are not owned, extracted, or redistributed as permanent game assets.
- Required Google and data-provider attribution must remain visible.
- The developer needs a restricted Google Maps Platform API key and billing/quota controls.
- Players do not need Google accounts or individual API keys.
- Do not scrape, prefetch, or cache map content beyond what the applicable Google terms permit.
- Verify coverage for the exact selected location; San Jose is the initial pilot area.

Keep the world renderer replaceable so it can later support owned, open, or licensed map assets.

### Distributed networking

Use WebRTC data channels for peer-to-peer gameplay communication.

Runtime model:

- GitHub Pages distributes the client only.
- A room is formed through signaling or a LAN bootstrap path.
- Each peer renders locally.
- One elected peer temporarily coordinates authoritative match state.
- Host authority can migrate when the current authority disconnects.
- Optional relay support may be added later for networks where direct WebRTC connections fail.

A fully leaderless FPS is not the initial target. Temporary authority is necessary for practical movement, hit validation, and consistent physics.

### Authoritative gameplay

Clients send timestamped inputs, not trusted positions or damage results.

The authority is responsible for:

- Movement simulation
- Weapon traces or hit validation
- Damage and health
- Respawns
- Match timer
- Score
- Player membership
- Snapshot sequencing
- Host migration epoch

Clients are responsible for:

- Local input
- Client-side movement prediction
- Remote-player interpolation
- Rendering and audio
- UI and effects

Target tick rate: 20-30 Hz for the first prototype. Use compact snapshots and sequence numbers.

## Map and physics strategy

Do not use the entire photorealistic mesh as the gameplay physics mesh.

Use two layers:

1. Visual layer: streamed 3D Tiles for buildings, terrain, trees, and scenery.
2. Gameplay layer: simplified colliders for ground, roads, walls, combat buildings, and boundaries.

The first map should be a 300-500 meter bounded area. A map can be visually detailed while using low-complexity collision geometry.

Required gameplay capabilities:

- First-person camera
- Gravity
- Ground detection
- Jumping
- Collision with major structures
- Raycast-based shooting
- Wall obstruction
- Player hitboxes
- Respawn points
- Out-of-bounds handling

If the streamed 3D mesh cannot provide reliable collision, create gameplay colliders separately from open or owned geographic data and procedural geometry. Never block the whole project on perfect automatic collision extraction.

## Suggested project structure

    /src
      /client
        main.ts
        render/
        input/
        ui/
        audio/
      /world
        tiles/
        locationSelection/
        gameplayGeometry/
      /network
        signaling/
        webrtc/
        protocol/
        authority/
        migration/
      /game
        player/
        weapons/
        match/
        physics/
      /shared
        types/
        constants/
    /public
      assets/
      shaders/
    /server
      signaling/
    /docs
      architecture.md
      protocol.md

The signaling service may be a small separate JavaScript service. Do not put long-running server logic on GitHub Pages.

## Data protocol requirements

Define versioned messages before implementing multiplayer:

- "HELLO"
- "ROOM_CREATE"
- "ROOM_JOIN"
- "PEER_LIST"
- "INPUT"
- "SNAPSHOT"
- "DAMAGE_EVENT"
- "RESPAWN"
- "MATCH_STATE"
- "HEARTBEAT"
- "AUTHORITY_CLAIM"
- "AUTHORITY_COMMIT"
- "LEAVE"

Every gameplay message should include, as appropriate:

- Protocol version
- Room ID
- Match ID
- Sender peer ID
- Sequence number
- Client timestamp
- Authority epoch

Reject stale messages and messages from an old authority epoch.

## Host migration

Implement migration only after two-peer gameplay works.

Minimum behavior:

1. Every peer tracks the current authority and last heartbeat.
2. If heartbeats stop beyond a timeout, peers enter an election state.
3. A deterministic election rule chooses one peer.
4. The winner increments the authority epoch.
5. The winner publishes a new baseline snapshot.
6. Other peers accept the new authority only for the higher epoch.
7. The match continues from the latest consistent state.

Avoid complex distributed consensus in the first version. Deterministic peer election plus epoch numbers is sufficient for a personal project.

## Development phases

### Phase 1 Map viewer

Deliver a browser page that:

- Loads a selected San Jose area.
- Shows camera controls.
- Displays required attribution.
- Reports tile loading and frame rate.
- Handles loading failures gracefully.

Exit test: a user can inspect the selected area smoothly in a modern desktop browser.

### Phase 2 FPS sandbox

Add:

- First-person movement
- Camera look
- Collision proxy
- Shooting
- Health
- Respawn
- A simple HUD

Exit test: one player can complete a short combat loop in the selected area.

### Phase 3 LAN multiplayer

Add:

- Room creation
- Peer discovery/signaling
- WebRTC data channels
- Two-player movement synchronization
- Basic authority
- Snapshot interpolation

Exit test: two machines remain synchronized for 10 minutes on the same network.

### Phase 4 Distributed match

Add:

- 4-8 player support
- Input validation
- Host migration
- Reconnection handling
- Match start/end
- Team assignment

Exit test: the authority can leave and another peer continues the match.

### Phase 5 GitHub Pages delivery

Add:

- Production build
- HTTPS deployment
- Restricted Google API key
- Quotas and billing alerts
- Browser compatibility checks
- Error and loading screens

Exit test: a fresh browser can open the public URL, load the client, join a room, and play.

## Non-goals for the first version

Do not initially build:

- A whole-city playable map
- Fully automatic map generation for every global location
- Photorealistic interiors
- Destructible buildings
- Vehicles
- Voice chat
- Competitive anti-cheat
- Account system
- Persistent player progression
- Matchmaking at internet scale
- Fully leaderless simulation
- Offline Google map support

## Engineering rules

- Follow clean code principles: use clear names, small focused functions, explicit interfaces, and minimal hidden state.
- Keep the code modular. Separate rendering, world data, physics, gameplay rules, networking, UI, and configuration behind stable boundaries.
- Build in stages: first a basic proof of concept, then an MVP, then the full game.
- Preserve module boundaries across stages. Improve and replace implementations behind the same interfaces instead of rewriting the system for each stage.
- Each stage must remain runnable and verifiable before adding the next layer of complexity.
- Keep the first playable area small.
- Separate rendering, physics, gameplay state, and networking.
- Prefer deterministic, testable state transitions.
- Never trust client-reported positions, hits, damage, or scores.
- Add visible diagnostics: FPS, ping, peer count, authority ID, epoch, and tile status.
- Make browser failure states explicit rather than silently hanging.
- Do not commit API keys or credentials.
- Restrict API keys by domain, API, quota, and billing alerts.
- Validate every external data and licensing assumption before scaling.
- Build and test the single-player map viewer before multiplayer.

## Iterative delivery model

### Proof of concept

Prove the highest-risk technical assumptions with the smallest implementation: load a bounded San Jose area, render the world, move a camera, and verify that the selected browser and map pipeline work. The proof of concept may be visually rough, but it must establish the interfaces that later modules will use.

### Minimum viable product

Turn the proof of concept into a playable vertical slice: first-person movement, simplified collision, shooting, health, respawn, room creation, and two-player synchronization. Replace temporary implementations incrementally while keeping the same module contracts.

### Full game

Expand the MVP with better map handling, polished visuals, more players, host migration, multiple game modes, stronger diagnostics, and improved performance. Do not introduce a second architecture for the full game; mature the POC/MVP modules in place.

At every stage, document module interfaces, add focused tests for important state transitions, and keep a working build that another developer can run locally.

## Immediate first task

Create the Phase 1 map viewer only.

Acceptance criteria:

- A minimal TypeScript browser application starts locally.
- It renders a bounded San Jose area using Google Photorealistic 3D Tiles through CesiumJS or the selected equivalent.
- The camera can move and rotate.
- The selected map center and bounds are configurable.
- Attribution is visible.
- Loading, API failure, unsupported WebGL/WebGPU, and missing-key states are visible.
- A small diagnostics panel shows FPS, camera coordinates, and tile loading state.
- The implementation is structured so the FPS gameplay layer can be added without rewriting the world renderer.
- Add a short README with setup, API-key restrictions, local run commands, and known limitations.

Do not add weapons or multiplayer until this map viewer is working and verified.

