# Maps

Hereafter has two maps. The Map button at the top right opens a picker with a card for each. Choosing another map reloads the page on it, through the `map` URL parameter, and leaves any room.

| Map | Size | Built from | URL |
|---|---|---|---|
| Night Market | 60 × 60 m | Hand-built layout in code | `?map=night-market` |
| San Jose | 140 × 140 m | OpenStreetMap and USGS elevation | default |

San Jose is the default, so existing links keep working. Its arena data and build are described in the [architecture note](architecture.md).

## Night Market

A back-alley market in San Jose's SoFA district at dusk, designed for tight fights. Two players sprinting from random spots meet in about 3.8 s, against about 9 s in the San Jose block.

It has three lanes running north to south:

- **The market alley** is 9 m wide and runs down the middle. Seven wooden stalls with striped awnings line it, with three table sets down the centre. String lights and paper lanterns hang overhead, and a food truck closes the north end with a 1.4 m gap on either side.
- **The restaurant** is the indoor lane on the west side. Two doors and two glass storefronts open onto the market alley. Inside, a pass counter splits the dining room from a kitchen walkway, where a carbine lies.
- **The service alley** is on the east side, behind the middle block. It holds dumpsters, back doors, wall lamps and the bar.

A cut-through in the middle block joins the two alleys, with a carbine on crates. Passages at both ends join them too.

There is high ground in two places:

- **The bar** has a stair along its back wall up to an upper room. The room opens onto a balcony over the service alley, which a ladder also reaches.
- **A fire escape** on the market alley's west side is reached by a ladder. Its platform at 4.6 m overlooks the stalls.

Spawns sit at the four ends of the alleys and in the end passages. The first two players start at opposite corners. A pistol lies a few steps from the south market spawn and from the north service spawn.

### What breaks

- **Stalls** are full-height wooden cover with 200 health. Pistol rounds stop in them. Carbine rounds pass through weakened, losing about 70 % of their damage. A stall breaks after 8 pistol hits, 12 carbine hits or a grenade landing close by, and leaves splinters and debris.
- **The glass storefronts** of the restaurant and the bar block players until shot. One round shatters them, and players can then jump or climb through the empty frame onto the low sill.
- **The upper-floor windows** break like San Jose's. There are 247 on alley-facing walls.
- **Props** are 25 crates, boxes, plastic crates, bins and drums. They break or get thrown about as in San Jose.

Walls are brick to bullets, dumpsters stop rounds, and the food truck is thin metal.

### Light

The market is lit at dusk under a low orange sun, with a dark blue sky and a light haze. Only six real point lights are used: two over the market alley, two in the service alley, one in the restaurant and one in the bar. Each extra light makes every lit material's shader slower to build and run. A test with 31 lights took more than nine seconds to build its shaders. The string lights, lanterns, signs and lit windows glow without lighting anything. Soft warm pools drawn on the ground under the strings and stalls stand in for the light they would cast.

## How a hand-built map works

`src/world/maps.ts` lists the maps, reads the `map` parameter and loads each map's data. `src/world/nightMarket.ts` defines the market as plain data and draws it.

The data every client must agree on is a `MapLayout` on the arena data:

- **`solids`** are boxes with a material. Walls, floors, counters, the stair ramp and railings are all solids. Railings use the `boundary` material, so they block players but not bullets.
- **`spawns`** are the starting points.
- **`pickups`** are the weapon spots.
- **`sky`** picks day or dusk light.

The rest of the game uses the layout where San Jose uses open data. The physics world adds every solid as a box collider. The collision checks used for spawns, props and melee test the upright solids. Spawns and pickups come straight from the layout, and footsteps are always on a hard surface.

The same module draws everything from that definition. Static geometry is merged per material, so the map draws in a few dozen calls. Windows are instanced. Stalls, glass storefronts, windows and props become world entities with fixed ids, built in the same order on every client, so their health travels in the coordinator's snapshots without extra messages. Ladders and the bar stair reuse the San Jose rooftop ladder and stair drawing.

Rooms are per map. A room code on the Night Market is a different room from the same code on San Jose, and packets carry a map key that peers check.

## Checks

A scripted headless Chrome session on an Apple M4 played the Night Market at 1440 × 813:

| Check | Result |
|---|---|
| Load, warm cache, dev build | 0.9 s to ready, most of it building shaders |
| Frame rate at the south spawn | 60 FPS, 411,000 triangles |
| Entities | 247 windows, 7 stalls, 3 glass storefronts and 25 props, plus 4 pickups |
| All 8 spawns | the player stands on the ground at each |
| Walking into the restaurant glass | stopped at the sill |
| One pistol round at the glass | shattered, and a running jump carried the player inside |
| Pistol rounds at a stall | broken after 8 hits |
| Bar stair, from the bottom | reached the upper room at 4.2 m |
| Fire escape ladder and balcony ladder | climbed onto both platforms |
| Two-tab room on the map | each player saw the other at their spawn, and a stall broken by one was broken for the other |
| San Jose after the change | same 4,666 entities, spawn and pickups, 60 FPS |

## Limits

- Doors are open doorways. Storefronts other than the restaurant's and the bar's are pictures on solid walls.
- Upper floors other than the bar's upper room cannot be entered, and their windows only break.
- The ground lighting under strings and stalls is painted on, so a player standing in it is not lit by it.
- Bullets do not pass through interior walls, which are brick like the outer ones.
- The layout is written in code. Adding a map today means a new module like `nightMarket.ts`, not a level editor.
