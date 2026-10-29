# World physics, damage and destruction

Every solid object in the street is a world entity with a stable id, a material and a durability, built the same way on every client from the bundled arena data (`src/world/entities.ts`). The coordinating peer decides what a bullet or blast does to them; every peer draws the result.

## Materials and penetration

A round starts with penetration power: 1 for the pistol, 2 for the carbine, none for the knife. `src/world/physics.ts` traces every surface along the shot with Rapier, nearest first, and measures how thick each one is where the round crosses it. `src/game/matchState.ts` walks those surfaces and the players' hit boxes in order. Each surface costs its material's resistance times its thickness, and each body costs 1. Damage dealt beyond a surface or body is scaled by the power left. The rules live in `src/world/materials.ts`.

| Material | Resistance per metre | Share of bullet damage taken | Share of blast damage taken | Found in |
|---|---|---|---|---|
| Glass | 0.05 | all | all | windows, lamp heads |
| Wood (hollow) | 1.2 | all | 1.2× | crates |
| Cardboard | 0.25 | 1.5× | 2× | boxes |
| Plastic | 0.4 | all | 1.5× | plastic crates |
| Thin metal | 1.4 | half | 0.8× | bins, oil drums |
| Concrete | 14 | 12% | 60% | barriers, planters, roofs |
| Timber | 6 | none | none | tree trunks |
| Solid metal | 30 | none | 15% | hydrants, poles, air-conditioners, stairs |
| Brick and ground | stops rounds | none | none | building walls, terrain |

So a carbine round passes through a window, a crate, a bin or one body and keeps going at reduced damage. A pistol round passes glass, cardboard and plastic. Neither passes concrete, brick, a tree or solid metal. A bullet striking a wall where a window is breaks the glass and stops in the wall behind it. The arena's invisible boundary walls and stair railings stop players but not rounds.

## Durability

| Entity | Durability | Breaks into |
|---|---|---|
| Window, lamp head | 1 | falling shards; a broken lamp goes dark |
| Cardboard box | 25 | flying cardboard |
| Plastic crate | 45 | fragments |
| Small and large wooden crate | 70 and 140 | splinters and planks |
| Concrete planter | 240 | rubble, soil and leaves |
| Concrete barrier segment | 420 per half | rubble and a dust cloud |
| Hydrant, pole, tree, bin, drum, air-conditioner | indestructible | |

A carbine round takes 2.2 from a barrier segment, so small arms chip cover for a long time. A grenade at a metre takes about 160. The health of anything damaged travels in the combat snapshot, so late joiners see the same broken street. A destroyed object's collider is removed, so it stops blocking movement, bullets and blasts. Bullet holes and impact particles follow the material: dust, sparks, splinters, shards or a puff.

## Loose props

Wooden crates, oil drums, trash cans, cardboard boxes, plastic crates and rooftop air-conditioners are CC0 Poly Haven models (see [data sources](data-sources.md)), placed deterministically on the pavements inside the block, clear of spawns, pickups, cover and each other (`src/world/props.ts`). They are Rapier rigid bodies with real masses, from 1.6 kg for a plastic crate to 95 kg for a part-filled drum. The coordinating peer simulates them, pushes them with bullet impulses and blasts, and shares moving ones 15 times a second, with every displaced prop every two seconds. Other peers move kinematic copies to those transforms, so everyone sees the same layout, and walking into a prop does not shove it.

## Grenades

Press G to throw a fragmentation grenade where you look: 14 m/s plus a little lift, from the right hand. Each life starts with two. The flight is integrated at 120 Hz with gravity, bounces that keep 38% of the speed along the surface normal and 72% across it, and rolling to rest. The coordinating peer computes where it settles; every peer draws the same path and hears it clink. It bursts 2.6 s after the throw. Within 7 m, players take up to 130 damage, falling off with distance, scaled by how much of their chest and head the blast can reach past cover. Objects take up to 320 by material, and loose ones are thrown outward. The blast has a flash, fireball, embers, smoke, a scorch mark, a camera shake that falls off with distance and a synthesised explosion with a long street echo.

## Ragdolls

A player who dies falls as a ragdoll built from the character's current pose (`src/game/ragdoll.ts`). The pelvis, chest, head, upper arms, forearms, thighs and calves are capsules and spheres with realistic density. Hips, shoulders, spine and neck are free joints, while knees and elbows are hinges that bend only the natural way. The killing blow knocks the body away from the shooter, harder for the carbine, upward and outward for a grenade. Ragdolls collide with the world but never with players, bullets or grenades, and they are drawn independently on each peer. Your own elimination drops and rolls the first-person view.

## Roofs, ladders and stairs

Every building has a solid roof at its drawn height. The low buildings inside the block are reachable (`src/world/rooftops.ts`). One has an external steel stair with a landing and railing, rising at about 32° over a hidden ramp. The others have steel ladders on the wall with the most open ground in front of them. Walk into a ladder while facing the wall to take hold of it. W and S climb at 2.6 m/s, Space lets go, and reaching the top climbs onto the roof. The weapon is put away while climbing. Reachable roofs carry two air-conditioning units as cover.

## Falling

Landing faster than 9 m/s, a drop of about 3 m, costs 9 health per extra metre per second: about 30 from 5.5 m, 41 from 6.6 m and 58 from 8.5 m. The client reports the landing speed, and the coordinating peer checks it against the drop in that player's recent pose history, so a client cannot claim a fall it never made.

## Measurements

Headless Chrome runs drove the game through these paths; a real two-tab room covered the network:

| Check | Result |
|---|---|
| Carbine at a window | glass entered and exited, window broken, round stopped in the brick |
| Carbine at a large crate | through the wood into the ground, crate 140 → 122 |
| Carbine at cardboard | destroyed by one round, collider and model gone |
| Carbine through two players in line | 45 to the first (head), 9 to the second; a pistol round stopped in the first |
| Grenade 1 m from a barrier segment | 420 → 259 |
| Grenade beside a 14 kg trash can | thrown 6.5 m |
| Ladder | climbed onto a 3.2 m roof |
| Stair | climbed from below and from the side onto a 7.8 m roof |
| Walking off a 3.2 m roof | landed at 9.1 m/s, 1 damage |
| Fall claim with no drop in the history | rejected |
| Two tabs, knife kill | both agree on health, kills and deaths; the victim ragdolls on the attacker's screen |
| Two tabs, grenade from the non-coordinator | blast resolved by the coordinator; a drum moved 0.57 m and both tabs agree to the millimetre |

Rendering cost at spawn on the same machine, measured the same way: 513 draw calls and about 940,000 triangles at 60 FPS, against 455 and about 505,000 for the previous release. Each prop model is one instanced mesh per part, the props were simplified to 1,200 to 3,700 triangles each, and cardboard and plastic crates cast no shadows.

## Limits

- Props shoved by a blast settle independently of players; walking into one does not push it.
- Ragdolls are not synchronised, so a body may come to rest in slightly different places on different screens.
- Window glass breaks but buildings have no interiors; the round stops in the wall behind.
- Destroyed objects stay destroyed until the room resets.
