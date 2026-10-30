# The Night Market

The game's map is a back-alley market in San Jose's SoFA district at dusk, 60 × 60 m, designed for tight fights. Two players sprinting from random spots meet in about 3.8 s.

## Layout

It has three lanes running north to south:

- **The market alley** is 9 m wide and runs down the middle. Seven wooden stalls with striped awnings line it, with three table sets down the centre. String lights and paper lanterns hang overhead, and a food truck closes the north end with a 1.4 m gap on either side.
- **The restaurant** is the indoor lane on the west side. Two doors and two glass storefronts open onto the market alley. Inside, a pass counter splits the dining room from a kitchen walkway, where a carbine lies.
- **The service alley** is on the east side, behind the middle block. It holds dumpsters, back doors, wall lamps, posters, a mural and the bar.

A cut-through in the middle block joins the two alleys, with a carbine on crates. Passages at both ends join them too.

There is high ground in two places:

- **The bar** has a stair along its back wall up to an upper room. The room opens onto a balcony over the service alley, which a ladder also reaches.
- **A fire escape** on the market alley's west side is reached by a ladder. Its platform at 4.6 m overlooks the stalls.

Spawns sit at the four ends of the alleys, in the gap beside the food truck and in the end passages. The first two players start at opposite corners. A pistol lies a few steps from the south market spawn and from the north service spawn.

## What breaks

- **Stalls** are full-height wooden cover with 200 health. Pistol rounds stop in them. Carbine rounds pass through weakened, losing about 70 % of their damage. A stall breaks after 8 pistol hits, 12 carbine hits or a grenade landing close by, and leaves splinters and debris.
- **The glass storefronts** of the restaurant and the bar block players until shot. One round shatters them, and players can then jump or climb through the empty frame onto the low sill.
- **The upper-floor windows** break when shot. There are 247 on alley-facing walls.
- **Props** are 25 crates, boxes, plastic crates, bins and drums. They break or get thrown about.

Walls are brick to bullets, dumpsters stop rounds, and the food truck is thin metal. See [physics notes](physics.md).

## Look

The market is lit at dusk by a painted sky, a low orange sun on the upper floors and 87 real lights from its lamps, strings, lanterns and signs, with bloom on everything bright, wet paving and windows that show rooms. See [rendering notes](rendering.md).

## How it is built

`src/world/nightMarket.ts` defines the market as plain data and draws it. The data every client must agree on is a `MapLayout` on the map data:

- **`solids`** are boxes with a material. Walls, floors, counters, the stair ramp and railings are all solids. Railings use the `boundary` material, so they block players but not bullets.
- **`spawns`** are the starting points.
- **`pickups`** are the weapon spots.

The physics world adds every solid as a box collider. Spawns and pickups come straight from the layout, and footsteps are always on a hard surface.

The same module draws everything from that definition. Static geometry is merged per material, so the map draws in a few dozen calls. Windows are instanced. Stalls, glass storefronts, windows and props become world entities with fixed ids, built in the same order on every client, so their health travels in the coordinator's snapshots without extra messages.

## Checks

A scripted headless Chrome session on an Apple M4 played the market at 1440 × 813:

| Check | Result |
|---|---|
| Frame rate at the south spawn | 60 FPS, about 224,000 triangles |
| Entities | 247 windows, 7 stalls, 3 glass storefronts and 25 props, plus 4 pickups |
| All 8 spawns | the player stands on the ground at each |
| Walking into the restaurant glass | stopped at the sill |
| One pistol round at the glass | shattered, and a running jump carried the player inside |
| Pistol rounds at a stall | broken after 8 hits |
| Bar stair, from the bottom | reached the upper room at 4.2 m |
| Fire escape ladder and balcony ladder | climbed onto both platforms |
| Two-tab room | each player saw the other at their spawn, and a stall broken by one was broken for the other |

## Limits

- Doors are open doorways. Shopfronts other than the restaurant's and the bar's are pictures behind solid walls.
- Upper floors other than the bar's upper room cannot be entered, and their windows only break.
- Bullets do not pass through interior walls, which are brick like the outer ones.
- The layout is written in code. Adding a map would mean a new module like `nightMarket.ts`, not a level editor.
