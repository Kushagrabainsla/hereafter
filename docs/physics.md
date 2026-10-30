# World physics, damage and destruction

Every breakable or loose object in the market is a world entity with a stable id, a material and a durability, built the same way on every client from the map definition (`src/world/nightMarket.ts`, `src/world/entities.ts`). Walls, floors, counters and the other fixed solids are boxes with a material. The coordinating peer decides what a bullet or blast does; every peer draws the result.

## Materials and penetration

A round starts with penetration power: 1 for the pistol, 2 for the carbine. `src/world/physics.ts` traces every surface along the shot with Rapier, nearest first, and measures how thick each one is where the round crosses it. `src/game/matchState.ts` walks those surfaces and the players' hit boxes in order. Each surface costs its material's resistance times its thickness, and each body costs 1. Damage dealt beyond a surface or body is scaled by the power left. The rules live in `src/world/materials.ts`.

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

Wooden crates, oil drums, trash cans, cardboard boxes and plastic crates are CC0 Poly Haven models (see [data sources](data-sources.md)), placed at fixed spots along the alley walls, in the cut-through, in the bar's upper room and in the restaurant kitchen (`src/world/nightMarket.ts`). They are Rapier rigid bodies with real masses, from 1.6 kg for a plastic crate to 95 kg for a part-filled drum. The coordinating peer simulates them, pushes them with bullet impulses, knife strokes and blasts, and shares moving ones 15 times a second, with every displaced prop every two seconds. Other peers move kinematic copies to those transforms, so everyone sees the same layout.

Players shove props by walking into them, with the mass of their body and everything they carry. On the coordinating peer, Rapier's character controller applies those impulses itself, and every other player is a capsule moved along their reported path by a second character controller that does the same. It takes part in no contacts, so it pushes with a body's mass rather than the unstoppable force of a moving kinematic body. A player on another peer is stopped by the local copy of a prop before the coordinator can move it, so their controller records how much of each step the prop blocked and sends that as an impulse on a `prop-push-v1` action, up to the 800 N a body can lean with (`src/world/physics.ts`). Walking into the stacked plastic crates shoves the bottom one and topples the top one; sprinting into a cardboard box sends it 2 m; leaning on the 95 kg drum moves it about 1.5 m.

## Weight

Everything a player carries has its real mass (`MASS` in `src/game/combatRules.ts`): the knife 0.25 kg, a grenade 0.4 kg, the pistol 0.72 kg with a 70 g magazine and 12 g cartridges, and the carbine 3.1 kg with a 330 g steel magazine and 16.3 g cartridges. A loaded pistol and magazine weigh 0.94 kg; a full carbine magazine 0.82 kg. Beyond the basic kit of knife and grenades, each kilogram costs 1.2% of walking speed and 1.8% of sprinting speed, to at most a fifth. The same legs launch more mass, so a jump starts slower in proportion to the square root of the total mass, and the body's inertia grows with it, so starting, stopping and climbing take longer. A carbine with six spare magazines, a pistol with four and two grenades weigh 11.7 kg: walking drops to 87%, sprinting to 81% (6.6 m/s), the jump to 94%. Heavier landings also hurt more, in proportion to the mass coming down. The HUD shows the load and turns amber above 6 kg.

## The knife

The knife's two strokes are swept, not single rays (`resolveKnife` in `src/game/matchState.ts`). A slash fans nine rays 1.7 m long across a 70° arc, from upper right to lower left and 22° high to low, in the order the arm moves the blade. A stab sends three rays 2.05 m straight ahead, reaching further because the player lunges into it. The blade stops at the first thing it meets along that order. A body takes the cut by zone: a slash does 45 to the head, 30 to the torso and 22 to the legs; a stab 100, 55 and 35. From more than 60° behind the target's facing, a stab is fatal and a slash does a quarter more. Anything else turns the blade: glass breaks, wood and cardboard take damage, a loose prop is shoved, and the stroke ends there with the material's impact.

The client sends the stroke when the blade reaches its target, 0.13 s into a slash and 0.24 s into a stab, aimed wherever the player is looking by then, and the coordinator spaces strokes by each one's recovery: 0.52 s after a slash and 0.9 s after a stab. A stab pushes the player forward at 2.8 m/s, which their footing bleeds off within a few tenths of a second. The first-person stroke pauses for 75 ms when it bites into a body, and a blade turned by something hard jolts the hand back. A cut or a carbine round knocks the victim back a little, a stab most.

## Spent cases, empty magazines and dropped guns

Each shot throws a case from the ejection port to the right, up and a little back, on top of the shooter's own velocity: 9 × 19 mm brass for the pistol, lacquered steel 7.62 × 39 mm for the carbine, at real size. A reload that empties a magazine drops it from under the gun. These pieces are small rigid bodies integrated at 120 Hz against the physics world (`src/game/ejecta.ts`): they bounce off what they strike, keeping 36 to 42% of their speed along the surface normal for cases and 18% for a magazine, skid, tumble, ring or clatter as they land and come to rest on their side. They last about 40 s and are drawn only on the peer that sees them.

A fallen player's guns and magazines fall from their hands, pushed away from the killing blow: a gun with the rounds left in it, and the spare magazines for it. The coordinator traces their fall through the physics world to where they come to rest and shares the drop in its snapshot; every peer draws the same path tumbling into place. Taking a drop gives the gun if it is not already carried, or its magazine as a spare, plus the spares. Drops last a minute.

## Grenades

Press G to throw a fragmentation grenade where you look: 14 m/s plus a little lift, from the right hand. Each life starts with two. The flight is integrated at 120 Hz with gravity, bounces that keep 38% of the speed along the surface normal and 72% across it, and rolling to rest. The coordinating peer computes where it settles; every peer draws the same path and hears it clink. It bursts 2.6 s after the throw. Within 7 m, players take up to 130 damage, falling off with distance, scaled by how much of their chest and head the blast can reach past cover. Objects take up to 320 by material, and loose ones are thrown outward. A blast in the open also throws nearby players away from it and off their feet, up to 7 m/s close in and less the heavier they are; cover shelters them. The blast has a flash, fireball, embers, smoke, a scorch mark, a camera shake that falls off with distance, on WebGPU a light that floods the alley for a moment, and a synthesised explosion with a long echo.

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
| Pistol with no spare magazines, fired 14 times | 12 rounds fired, then refused; reload refused |
| Two spare magazines, reload empty, fire 5, reload | 12 rounds, then 13 (one chambered) with a 6-round magazine kept |
| Fire escape magazines from the alley below | refused |
| Sprint with 11.7 kg against 1.1 kg | 0.81 of the speed |
| Slash at a player 1.3 m ahead | head for 45; aimed at the chest, torso for 30 |
| Stab from the front, from behind | 55; fatal (100) |
| Slash 2.4 m away | miss |
| Slash at shop glass, at a brick wall | glass broken; stopped on brick |
| Two tabs, stab in the back of a player with a carbine | carbine dropped at the same spot on both, taken by the other player |
| Two tabs, the non-coordinator walks into the large crate | moved 1.5 m on both screens |

## Limits

- A player on another peer pushes props through the coordinator, so the prop moves about a tenth of a second after they lean on it.
- Spent cases and empty magazines are local, so each peer's lie in slightly different places.
- Ragdolls are not synchronised, so a body may come to rest in slightly different places on different screens.
- Upper-floor windows break, but only the bar's upper room can be entered; elsewhere the round stops in the wall behind.
- Destroyed objects stay destroyed until the room resets.
