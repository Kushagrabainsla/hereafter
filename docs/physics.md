# World physics, damage and destruction

Every breakable or loose object in the market is a world entity with a stable id, a material and a durability, built the same way on every client from the map definition (`src/world/nightMarket.ts`, `src/world/entities.ts`). Walls, floors, counters and the other fixed solids are boxes with a material. The coordinating peer decides what a bullet or blast does; every peer draws the result.

## Materials and penetration

A round starts with penetration power: 1 for the pistol, 2 for the carbine, none for the knife. `src/world/physics.ts` traces every surface along the shot with Rapier, nearest first, and measures how thick each one is where the round crosses it. `src/game/matchState.ts` walks those surfaces and the players' hit boxes in order. Each surface costs its material's resistance times its thickness, and each body costs 1. Damage dealt beyond a surface or body is scaled by the power left. The rules live in `src/world/materials.ts`.

| Material | Resistance per metre | Share of bullet damage taken | Share of blast damage taken | Found in |
|---|---|---|---|---|
| Glass | 0.05 | all | all | windows, shop glass |
| Wood (hollow) | 1.2 | all | 1.2× | stalls, crates, tables, counters |
| Cardboard | 0.25 | 1.5× | 2× | boxes |
| Plastic | 0.4 | all | 1.5× | plastic crates |
| Thin metal | 1.4 | half | 0.8× | bins, oil drums, the food truck, the fire escape |
| Concrete | 14 | 12% | 60% | floor slabs, the balcony |
| Solid metal | 30 | none | 15% | dumpsters, kitchen counters, air-conditioners |
| Brick and ground | stops rounds | none | none | every wall, the ground |

So a carbine round passes through a window, a crate, a bin, a stall seen from the front or one body and keeps going at reduced damage. A pistol round passes glass, cardboard and plastic but stops in a stall. Nothing passes a wall or a dumpster. A bullet striking a wall where a window is breaks the glass and stops in the wall behind it. The arena's invisible edge and the railings stop players but not rounds.

## Durability

| Entity | Durability | Breaks into |
|---|---|---|
| Window, shop glass | 1 | falling shards; broken shop glass leaves a frame you can climb through |
| Cardboard box | 25 | flying cardboard |
| Plastic crate | 45 | fragments |
| Small and large wooden crate | 70 and 140 | splinters and planks |
| Market stall | 200 | splinters, planks and dust |
| Bin, drum, air-conditioner, walls, counters, dumpsters, the truck | indestructible | |

A stall takes 8 pistol hits or 12 carbine hits, or one grenade landing close by. The health of anything damaged travels in the combat snapshot, so late joiners see the same broken market. A destroyed object's collider is removed, so it stops blocking movement, bullets and blasts. Bullet holes and impact particles follow the material: dust, sparks, splinters, shards or a puff.

## Loose props

Wooden crates, oil drums, trash cans, cardboard boxes and plastic crates are CC0 Poly Haven models (see [data sources](data-sources.md)), placed at fixed spots along the alley walls, in the cut-through, in the bar's upper room and in the restaurant kitchen (`src/world/nightMarket.ts`). They are Rapier rigid bodies with real masses, from 1.6 kg for a plastic crate to 95 kg for a part-filled drum. The coordinating peer simulates them, pushes them with bullet impulses and blasts, and shares moving ones 15 times a second, with every displaced prop every two seconds. Other peers move kinematic copies to those transforms, so everyone sees the same layout, and walking into a prop does not shove it.

## Grenades

Press G to throw a fragmentation grenade where you look: 14 m/s plus a little lift, from the right hand. Each life starts with two. The flight is integrated at 120 Hz with gravity, bounces that keep 38% of the speed along the surface normal and 72% across it, and rolling to rest. The coordinating peer computes where it settles; every peer draws the same path and hears it clink. It bursts 2.6 s after the throw. Within 7 m, players take up to 130 damage, falling off with distance, scaled by how much of their chest and head the blast can reach past cover. Objects take up to 320 by material, and loose ones are thrown outward. The blast has a flash, fireball, embers, smoke, a scorch mark, a camera shake that falls off with distance and a synthesised explosion with a long echo.

## Ragdolls

A player who dies falls as a ragdoll built from the character's current pose (`src/game/ragdoll.ts`). The pelvis, chest, head, upper arms, forearms, thighs and calves are capsules and spheres with realistic density. Hips, shoulders, spine and neck are free joints, while knees and elbows are hinges that bend only the natural way. The killing blow knocks the body away from the shooter, harder for the carbine, upward and outward for a grenade. Ragdolls collide with the world but never with players, bullets or grenades, and they are drawn independently on each peer. Your own elimination drops and rolls the first-person view.

## Ladders and the stair

Two steel ladders hang from platform edges: one up to the fire escape over the market alley at 4.6 m, one up to the bar balcony over the service alley at 4.2 m (`src/world/climbing.ts` draws them). Walk into a ladder while facing it to take hold. W and S climb at 2.6 m/s, Space lets go, and reaching the top climbs over the edge onto the platform. The weapon is put away while climbing. Inside the bar, a stair along the back wall rises over a hidden ramp to the upper room, which opens onto the balcony.

## Falling

Landing faster than 9 m/s, a drop of about 3 m, costs 9 health per extra metre per second; jumping from the fire escape costs about 20. The client reports the landing speed, and the coordinating peer checks it against the drop in that player's recent pose history, so a client cannot claim a fall it never made.

## Measurements

Headless Chrome runs drove the game through these paths; a real two-tab room covered the network:

| Check | Result |
|---|---|
| Walking into the restaurant's shop glass | stopped at the sill |
| One pistol round at the shop glass | shattered; a running jump carried the player inside |
| Pistol rounds at a stall | broken after 8 hits |
| Bar stair, from the bottom | reached the upper room at 4.2 m |
| Fire escape and balcony ladders | climbed onto both platforms |
| Carbine through two players in line | 45 to the first (head), 9 to the second; a pistol round stopped in the first |
| Fall claim with no drop in the history | rejected |
| Two tabs, a stall broken by one player | broken for the other after the same 8 hits |
| Two tabs, grenade from the non-coordinator | blast resolved by the coordinator; a drum moved and both tabs agree to the millimetre |

## Limits

- Props shoved by a blast settle independently of players; walking into one does not push it.
- Ragdolls are not synchronised, so a body may come to rest in slightly different places on different screens.
- Upper-floor windows break, but only the bar's upper room can be entered; elsewhere the round stops in the wall behind.
- Destroyed objects stay destroyed until the room resets.
