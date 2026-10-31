# The Night Market

The game's map is a back-alley market in San Jose's SoFA district at dusk, 60 × 60 m, designed for tight fights. Two players sprinting from random spots meet in about 3.8 s.

## Layout

It has three lanes running north to south:

- **The market alley** is 9 m wide and runs down the middle. Seven wooden stalls line it, selling noodles, fruit, grilled skewers, tea and trinkets under striped awnings, with three table sets down the centre. String lights and paper lanterns hang overhead, and a food truck closes the north end with a 1.4 m gap on either side.
- **The restaurant** is the indoor lane on the west side. Two pairs of glass doors and two glass storefronts open onto the market alley. Inside, a pass counter splits the dining room from a kitchen walkway, where a carbine lies.
- **The service alley** is on the east side, behind the middle block. It holds dumpsters, back doors, wall lamps, posters, a mural and the bar.

A cut-through in the middle block joins the two alleys, with a carbine on crates. Passages at both ends join them too, and the record shop runs through the block's south half: glass doors and a shop window on the market alley, a steel back door and a boarded-up window on the service alley.

There is high ground in two places:

- **The bar** has a stair along its back wall up to an upper room. The room opens onto a balcony over the service alley, which a ladder also reaches.
- **A fire escape** on the market alley's west side is reached by a ladder. Its platform at 4.6 m overlooks the stalls.

Spawns sit at the four ends of the alleys, in the gap beside the food truck and in the end passages. The first two players start at opposite corners with only a knife. A pistol lies a few steps from the south market spawn and from the north service spawn, and carbines lie in the cut-through and the restaurant kitchen.

Each gun holds one magazine, so the nine spare-magazine pickups decide how long a fight lasts. Each holds two magazines:

| Pickup | Magazines | Where |
|---|---|---|
| `mags-table-south` | pistol | on the south market table |
| `mags-dining` | pistol | on a restaurant dining table |
| `mags-bar` | pistol | on the bar counter |
| `mags-cut` | pistol | on the ground in the cut-through |
| `mags-table-north` | carbine | on the north market table |
| `mags-fire-escape` | carbine | on the fire escape platform |
| `mags-upstairs` | carbine | on the bar's upper floor |
| `mags-dumpster` | carbine | on a dumpster lid in the service alley |
| `mags-records` | pistol | on the record shop's counter |

Pickups have a height, so the fire escape's magazines can only be taken from the platform, not from the alley below.

## What breaks

- **Stalls** are full-height wooden cover with 200 health. Pistol rounds stop in them. Carbine rounds pass through weakened, losing about 70 % of their damage. At half health a stall's awning is shot to rags and goods tumble off its counter. It breaks after 8 pistol hits, 12 carbine hits or a grenade landing close by, and collapses into a pile about 0.7 m high: low cover that still stops pistol rounds and that players can climb onto.
- **The glass storefronts** of the restaurant and the bar block players until shot. One round shatters them, and players can then jump or climb through the empty frame onto the low sill.
- **The upper-floor windows** break when shot. There are 247 on alley-facing walls.
- **Props** are 27 crates, boxes, plastic crates, bins and drums. They break or get thrown about.
- **Fuel drums.** Two red drums stand by the restaurant's north door and the bar's south door. Two pistol rounds open one: it vents a jet of burning fuel for 1.6 s and then bursts like a grenade, credited to whoever shot it. A blast can throw a drum before it goes off.
- **Fire extinguishers** hang in the restaurant kitchen, the bar, the record shop and on three alley walls. One round bursts one into a pale cloud of powder that hides the spot for about 5 s.
- **Doors.** Rounds pass through a door and wear it down. A wooden leaf comes off its hinges after 4 pistol rounds, a steel back door after 5, and a grenade close by blows them off.
- **The record shop's boarded window** takes 5 pistol rounds or a grenade. It then leaves a 1.9 m opening onto a 0.6 m sill that players can climb through.
- **Steam pipes** on four walls burst with one round (see below).
- **Lamps and signs.** 103 lamps break with one round: each run of string lights, each paper lantern, the wall lamps, the restaurant's and the record shop's pendants, the stall bulbs, the bar's pool-table lamp, the blade signs and the neon and lightbox signs. A shot lamp sputters for a moment, then goes dark, and the real light it fed dims with it, so a lane can be darkened before pushing through it.
- **The breaker box** on the service alley's west wall takes three pistol rounds. Breaking it cuts the alley's circuit: its 10 wall lamps and the 15 runs of string lights over it go out together, and the box's green light dies.

Walls are brick to bullets, dumpsters stop rounds, and the food truck's skin is thin metal. See [physics notes](physics.md).

## The food truck

The truck closing the north end is a step van turned kitchen, modelled at real size in Blender by `scripts/truck/build.py` (`npm run build:truck`) and placed by `src/world/foodTruck.ts`. It has a cab with seats and a dashboard behind its glass, a grille, headlights and mirrors, a teal livery and lettering, a lit roof sign, a menu board, a roof fan and air conditioner, and two propane cylinders in a cage on its north side.

- **Get in.** Walk up the bumper step at the back, open the rear doors with E and walk in. Inside are a serving counter under the window, a cooking line with a griddle, fryer and bamboo steamers, a fridge, a hood and a stock rack, lit by the ceiling panels.
- **The serving hatch** starts propped up as an awning. Anyone near it, inside or out, can drop it shut with E, closing the window, or prop it open again.
- **Cover.** The skin is thin steel, so rounds go through it. The engine, the cooking line and the fridge stop them.
- **Glass.** The serving window, the windscreen and the two cab windows break with one round. The serving window's left half is slid open.
- **Tyres** go flat after about 40 damage: the tyre squashes and the truck sinks toward that corner.
- **Propane.** A cylinder takes about two rounds. It then vents a roaring jet of burning gas for 1.6 s and bursts like a grenade, credited to whoever shot it. The blast blows out glass, flattens tyres, damages stalls and sets off the other cylinder.

The doors and hatch are shared state, so every player sees them in the same place, and their colliders swing with them.

## Walls and doors

The walls are dressed from a kit of pieces modelled in Blender by `scripts/kit/build.py` (`npm run build:kit`, written to `public/models/market-kit.glb`) and placed by `src/world/facades.ts`. The kit holds:

- downpipes with hoppers and shoes from roof to ground;
- window air conditioners on about a quarter of the sills;
- split condensers on brackets, meter cabinets with conduit, and louvred vents;
- steel back doors under small canopies;
- fire escapes with landings, stairs and drop ladders up four facades.

All of it is drawn as instanced meshes, and none of it has colliders: it is flat against a wall or, like the fire escapes, starts 4.25 m up, beyond reach.

- **Doors** (`src/world/doors.ts`). The restaurant's two doorways have pairs of glass doors, the bar's have panelled doors with portholes, the balcony has French doors, and the record shop has glass doors at the front and a steel door at the back. Each opens inward. Press E at it, or attack a shut door with the knife to kick it open. Some start open and some shut. Each leaf's collider swings with it and carries its entity, so rounds that strike it wear it down.
- **Steam pipes** (`src/world/steamPipes.ts`). Lagged pipes with a valve and gauge run along the service alley, the laundry wall, the cut-through and the market alley's east wall. A round anywhere along one bursts it. A thick cloud then fills the space around it for about 11 s, hiding anyone inside, and thins over 4 s to a wisp that leaks until the room resets. The cloud blocks sight only. A player who joins after a pipe burst sees only the wisp.
- **Stalls** (`src/world/stalls.ts`) come from the same kit: a plank counter, posts, a back rack with two shelves, a chalk price board, a striped awning in the stall's colour and the goods of its trade. Each also has a torn awning and a collapsed pile, shown as it takes damage.
- **The record shop** cuts a new route through the middle block. Inside are record bins down the middle, shelves along both side walls and a counter with a turntable and a pair of spare pistol magazines. Two pendant lamps light it. The bins are waist-high cover, and the shop window, the doors and the boarded window all break.

## Look

The market is lit at dusk by a painted sky, a low orange sun on the upper floors and 90 real lights from its lamps, strings, lanterns and signs, with bloom on everything bright, wet paving and windows that show rooms. Bounce light and the shade in corners and alleys are baked into a lightmap from the same layout, so a change to the map needs `npm run build:lightmaps`. See [rendering notes](rendering.md).

## How it is built

`src/world/nightMarket.ts` defines the market as plain data and draws it. The data every client must agree on is a `MapLayout` on the map data:

- **`solids`** are boxes with a material. Walls, floors, counters, the stair ramp and railings are all solids. Railings use the `boundary` material, so they block players but not bullets.
- **`spawns`** are the starting points.
- **`pickups`** are the gun and magazine spots, each with the height of the surface it rests on.
- **`toggles`** are things players open and close, the food truck's doors and hatch and the market's seven doorways, with where a player reaches for each and how it starts.

The physics world adds every solid as a box collider. Spawns and pickups come straight from the layout, and footsteps are always on a hard surface.

The same module draws everything from that definition. Static geometry is merged per material, so the map draws in a few dozen calls. Windows are instanced. Stalls, glass storefronts, windows and props become world entities with fixed ids, built in the same order on every client, so their health travels in the coordinator's snapshots without extra messages.

## Checks

A scripted headless Chrome session on an Apple M4 played the market at 1440 × 813:

| Check | Result |
|---|---|
| Frame rate at the south spawn | 60 FPS, about 224,000 triangles |
| Entities | 247 windows, 7 stalls, 4 glass storefronts, 13 door leaves, 4 steam pipes, 6 extinguishers, 1 boarded window, 103 lamps and 27 props |
| All 8 spawns | the player stands on the ground at each |
| Walking into the restaurant glass | stopped at the sill |
| One pistol round at the glass | shattered, and a running jump carried the player inside |
| Pistol rounds at a stall | broken after 8 hits |
| Bar stair, from the bottom | reached the upper room at 4.2 m |
| Fire escape ladder and balcony ladder | climbed onto both platforms |
| Two-tab room | each player saw the other at their spawn, and a stall broken by one was broken for the other |

## Limits

- The steel back doors other than the record shop's are part of the wall and stay shut. Shopfronts other than the restaurant's, the bar's and the record shop's are pictures behind solid walls.
- The fire escapes other than the one on the market alley's west side cannot be reached and have no colliders, so rounds and grenades pass through them.
- A door swung shut onto a player can trap them against its frame.
- Upper floors other than the bar's upper room cannot be entered, and their windows only break.
- Bullets do not pass through interior walls, which are brick like the outer ones.
- A broken lamp's direct light goes, but the bounce light baked from it stays in the lightmap, so a darkened corner keeps a faint warm fill.
- The food truck's own lights cannot be shot out.
- The layout is written in code. Adding a map would mean a new module like `nightMarket.ts`, not a level editor.
