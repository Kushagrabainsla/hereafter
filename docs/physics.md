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
| Thin metal | 1.4 | half | 0.8× | bins, oil drums, the food truck's skin and propane cylinders, the fire escape |
| Rubber | 4 | all | 0.7× | the food truck's tyres |
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
| Dining chair, folding table, dining table | 40, 70 and 120 | splinters and planks |
| Plastic stool | 20 | fragments |
| Market stall | 200 | its awning tears at 100; then splinters, planks and dust, and a low pile that stays as cover |
| Fuel drum | 16 | vents burning fuel for 1.6 s, then bursts with a grenade's blast |
| Fire extinguisher | 6 | a cloud of powder that hides the spot for about 5 s |
| Food truck glass | 1 | shards |
| Food truck tyre | 40 | a burst of rubber; the tyre goes flat and the truck sinks toward it |
| Propane cylinder | 16 | vents burning gas for 1.6 s, then bursts with a grenade's blast |
| Lamp, string-light run, lantern, sign | 1 | glass shards and sparks; it goes dark and the light it fed dims |
| Breaker box | 30 | sparks; every lamp on the service alley's circuit goes out |
| Wooden door leaf | 100 | splinters; the leaf and its collider are gone |
| Steel back door | 60 | sparks |
| Boarded window | 120 | splinters and planks; the window opens |
| Steam pipe | 10 | a burst of steam that hides the area around it for about 15 s |
| Bin, drum, air-conditioner, walls, counters, dumpsters, the truck itself | indestructible | |

A stall takes 8 pistol hits or 12 carbine hits, or one grenade landing close by. The health of anything damaged travels in the combat snapshot, so late joiners see the same broken market. A destroyed object's collider is removed, so it stops blocking movement, bullets and blasts. Bullet holes and impact particles follow the material: dust, sparks, splinters, shards or a puff. Holes are modelled craters with a scorched ring and a chipped rim tinted by the surface, and the particles are modelled chips, splinters, glass shards, leaves and spark streaks (`public/models/effects.glb`), one instanced mesh per shape holding only the pieces in flight.

## Loose props

Wooden crates, oil drums, trash cans, cardboard boxes and plastic crates are CC0 Poly Haven models (see [data sources](data-sources.md)), placed at fixed spots along the alley walls, in the cut-through, in the bar's upper room and in the restaurant kitchen. The furniture is loose too: dining chairs (5 kg), dining tables (18 kg), folding tables (9 kg), steel bar stools (9 kg) and plastic stools (1.2 kg), 54 pieces in the restaurant, the bar, the shops and the market alley. All 81 are Rapier rigid bodies with real masses, up to 95 kg for a part-filled drum (`src/world/nightMarket.ts`, `src/world/props.ts`).

**Each prop has one owner at a time** (`src/world/physics.ts`). A prop at rest has no owner and is held still on every peer, at no cost to anyone. The first peer to touch it owns it: its body becomes dynamic there and that peer simulates it, so the push responds at once with no wait on the network. A player's walk claims a prop through the character controller, which shoves it with the mass of the player's body and everything they carry. A shot, knife stroke or blast is resolved by the coordinating peer, which claims a free prop it hits; if someone else owns the prop, it forwards the impulse to the owner.

A moving prop takes over the free props it is about to touch, so a crate hits the next one with its full momentum and a stack comes down together. The owner shares each moving prop 15 times a second. Other peers glide their copy to each reported place over 80 ms, a packet behind, so it moves smoothly between packets. Once a prop has been nearly still for half a second (under 6 cm/s and 0.12 rad/s), the owner sends where it came to rest and lets it go. Every two seconds the coordinating peer also shares any resting prop that has changed since it last did, and all of them after a player joins.

Two peers can claim one prop in the same moment; the lower peer id keeps it and the other starts following. A player who walks into a prop another peer owns cannot move their copy, so their controller records how much of each step the prop blocked and sends that as an impulse to the owner on a `prop-push-v1` action, up to the 800 N a body can lean with, with their walking speed, which the owner will not let the push exceed: a body walking into a light stool moves it, it does not fire it across the room. If an owner goes silent for 1.5 s, the coordinating peer takes over its props so they finish falling.

Where two owners' props collide, each sees the other's as an immovable object, so that contact is less exact than one between props of the same owner. The player's body takes part in no contacts with props: they are moved only through the character controller, with the body's mass, not the unstoppable force of a kinematic body. A prop that reaches a body fast enough to hurt is handled apart, below.

A prop counts as still by how far it really moved in the last step, not by the velocity Rapier reports: a box set down flat can stay pinned by its contacts while reporting a small velocity indefinitely.

Walking into the stacked crates moved the bottom one and brought the top one down with it. In a scripted test, walking for 0.6 to 0.9 s moved a plastic stool 1.0 m, a dining chair 1.3 m, a folding table 1.1 m, a crate 1.4 m and a dining table 0.5 m. Leaning on a 95 kg drum for 2 s moved it 0.5 m, and sprinting into a cardboard box carried it 6 m. Each was let go within 2.5 s.

**What it costs.** On an Apple M4 under load, a physics step took 0.4 ms with all 81 props at rest and 1.0 ms on average with every one of them thrown into the air, against a frame of 16.7 ms, so the simulation itself is cheap. The network is the tighter limit: a moving prop is about 55 bytes in each of 15 packets a second, to every other player. At a MacBook Pro's Retina size, in three alternating rounds over eight spots, the mean frame rate was 42.4 FPS on the release before and 44.2 FPS with loose furniture, with the same draw calls and 0 to 3.9% more triangles. Props at rest are no longer sent to the graphics card every frame, which is what the time saved came from, or part of it; the machine was busy and the runs varied by a couple of FPS.

## Carrying and throwing

**Lifting.** E lifts the loose prop in the crosshair, within 2.2 m of the eyes and up to 25 kg (`MAX_CARRY` in `src/game/combatRules.ts`). The nearest thing along the line of sight is what counts, so nothing can be lifted through a wall or from behind the thing in front of it. A useful pickup in reach comes first, and heavier props can only be pushed. Both hands are on it: the weapon goes away, and ladders, mantling and sliding are out of reach until the player lets go. Choosing a weapon lets go, and so does taking any damage. A carried prop weighs on the player like anything else (see [weight](#weight)), and also slows the walk by 2.2% per kilogram, by at most 55% in all; nothing of 10 kg or more can be carried at a sprint.

**Holding.** A carried prop stays a dynamic body and is steered, not placed (`steerHeld` in `src/world/physics.ts`). Each step its velocity is moved toward closing the gap to a point in front of the player and below the eyes, with at most 500 N of force, so a stool snaps into place and a loaded crate swings after the player. It collides with the world on the way, comes straight up for up to 0.3 s when lifted so it clears what stands in front of it, and is never asked to go below where it would stand on the floor. If something keeps it more than about a metre from the hands for 0.3 s, the player loses their grip. Players walk through what they carry, so standing on a box and lifting it does not lift the player, while bullets still strike it. It is simulated like any owned prop, and other players see it where the carrier has it. A flag in the position packet tells them the player's hands are full, so the character puts its weapon away and holds both hands out.

**Throwing.** A click throws, and holding draws it back over 0.7 s for more power. A throw is a fixed 340 J at full effort, shared between the object and 2 kg of moving arm, so the speed is √(2W / (m + 2)): about 15 m/s for a stool, 10 for a chair and 6 for a loaded crate. A full-effort throw measured 15.6 m/s for a stool, which flew 7.8 m, and 6.4 m/s for an 18 kg crate, which flew 5.7 m. It goes toward what the crosshair is on, lifted to make up for the fall on the way for up to 0.6 s of flight, on top of the player's own speed and with some tumble, and the thrower is pushed back by the momentum of what they threw.

**Being hit.** Players take part in no contacts, so the peer simulating a prop tests each prop moving above 3.5 m/s against every player's capsule where that peer sees them, after each step. A hit bounces the prop by the two masses and sends a `struck` intent, which the coordinator accepts if the prop is within 6 m of the victim. Damage is `0.14 × (energy × hardness − 15 J)`, with hardness 0.15 for cardboard, 0.35 for plastic, 0.9 for thin metal, 1 for wood and 1.3 for solid metal, and 1.6 times that to the head and 0.6 times to the legs, up to 100. A chair thrown from 3 m did 37 to the head, and a thrown crate 69. A plastic stool barely stings, and a crate falling from the upper floor onto a head kills. Whoever threw a prop gets the credit; a prop that merely fell or was flung by something else credits nobody. A prop that hit one player cannot hit them again for 0.6 s, and a player is clear of what they let go of for 0.5 s.

**Breaking and knocking.** A sharp change of speed is a knock, heard by everyone, louder the harder it was and deeper the heavier the prop. Above 6.3 m/s it may damage the prop, by how fast it stopped rather than by its weight, since heavy things are built to be: `(½Δv² − 20 J/kg) / toughness` of its full strength, with toughness 25 for cardboard, 70 for wood, 300 for plastic and 400 for thin metal. A chair thrown square at a wall lost 44% of its strength. Being pushed by a bullet, a blast or a player does not count as a knock.

## Wounds

Being hit leaves more than a lower health number (`wound` in `src/game/matchState.ts`). Wounds last until the player bandages them or dies, are kept per player in the coordinator's state, and reset with a new life.

**Legs.** A hit to the legs, a hard landing, or a flying prop that strikes the legs wounds the leg, from 0 to 1, a full wound being 40 damage. A wounded leg slows walking by up to 40% and sprinting by up to 50%, lowers the jump by up to 30%, and takes up to another 25% off the bad leg's half of each stride, which shows as a limp in the player's own view and in how other players see them walk. At 0.6 or worse the player cannot sprint. A pistol round to the leg (leg wound 0.43) took walking from 4.5 to 3.7 m/s and sprinting from 8.2 to 6.4 m/s; at 0.76, walking was 3.1 m/s and sprinting no faster.

**Arms.** `targetHit` counts a hit on the outer edge of the torso, more than 20 cm from the middle of the body, as a hit on the arm, for the same damage as the torso. A full wound is 50 damage. It widens the spread by up to 2.5 times, on the coordinator and on the crosshair, makes the weapon shake and wander, takes up to half as long again to reload, weakens a throw by up to 30% and halves what can be lifted. A pistol round to the arm (0.5) opened the crosshair from 3.0 to 4.9 px and took a pistol reload from 1.2 s to 1.5 s.

**Bleeding.** A blade, round or blast doing 15 damage or more opens a wound that loses a point of health every 1.2 s for 9 s, and further wounds add 9 s, up to 24 s. Falls and thrown objects bruise and do not bleed. Blood falls from a bleeding player where others can see it. A bleed is not a blow: it flashes nothing and credits nobody until the last point, which counts as a kill for whoever opened it.

**Bandages.** Each life has two. B ties one: 2.5 s with the hands busy, after which the bleeding stops and leg and arm wounds halve. A fresh wound while tying it undoes the attempt, without using the bandage. Food restores health but does not treat wounds. The HUD lists the player's wounds and bandages.

## Fire

Fire is worked out twice a second by the coordinator and kept in its state (`stepFires` in `src/game/matchState.ts`, numbers in `src/game/combatRules.ts`). Up to 24 things burn at once.

**What starts one.** A burst fuel drum or gas tank throws burning fuel over 2.2 m for 14 s, and whatever its blast tears apart is left as scraps alight for 9 s where it stood. A drum or tank venting flame heats what stands around it. A frag sets light only to cardboard, within about 3 m, as scraps.

**How it spreads.** Everything near a fire warms up, at 40 units a second against the fire and falling to nothing at 1.2 m plus both objects' sizes, unless a wall stands between them; heat fades when the fire is gone. Cardboard catches at 30, plastic at 70 and wood at 100. A fuel drum or gas tank that reaches 60 goes off, which can chain. Metal, glass and brick do not burn.

**How long it lasts.** A burning object wears down until it is gone, over `(10 s + 2 s/kg)` for wood, 0.8 of that for plastic and half for cardboard, between 8 and 60 s; a stall or door takes 60 s. A chair burned away in 21 s and set the rest of its table alight within 7 s. A burning prop that is moving carries its fire with it. It cannot be lifted, and something a player is carrying that catches fire is dropped.

**Hurting players.** Standing in flames costs 5 health every half second, whoever started the fire getting the credit if it kills. Blast damage is unchanged.

**What it leaves.** Loose props and stalls blacken as they burn, and stay blackened if the fire is put out, until the round ends. Each fire that goes leaves a scorch mark on what it burned over. Both use a per-copy colour and the bullet-hole decals, so they add no draw calls.

**Putting it out.** A burst extinguisher's powder smothers every flame within 4.5 m and cools what they had heated. Fires also burn out by themselves, and a new round puts everything out.

**What it costs.** Flames are one instanced mesh of up to 170 camera-facing cards. The burning thing nearest the player borrows the explosion's light rather than adding one, so no new light is ever paid for. At a MacBook Pro's Retina size, the same view measured 43.5 to 44.3 FPS with no fire and 43.5 to 44.5 FPS with 24 fires in view, with 6 to 12 more draw calls, on a machine varying by about a frame a second. The coordinator's update during a fire is two small changes a second.

## Bodies

**Bumps.** Loose props moving at 0.4 m/s or more now meet players' bodies instead of passing through them. The peer simulating a prop bounces it off the capsule of every player where that peer sees them, by the two masses, and each player's own peer shoves their body by its share of the momentum. A crate pushed into a player at about 3 m/s stopped there and moved them a few centimetres. Below 3.5 m/s nobody is hurt.

**Catching fire.** Anyone caught in flames goes on burning for 3 s after they get out, losing 3 health every half second, and sets light to what they brush against. Crouching smothers it twice as fast, and another player's extinguisher puts it out at once. Other players see flames on the burning character; the player sees "On fire" in the HUD and the usual damage flash.

**Hands.** While a player holds something in both hands, the first-person view shows empty arms in place of the weapon, using the carbine's arm pose, with the extinguisher in them when that is what they hold.

## Things to use

**Fire extinguishers.** E at one on a wall, while looking at it, takes it down. It needs both hands, and holds 10 s of powder. Holding the trigger sprays a burst every quarter of a second, in a cone out to 5.5 m; a wall stops it. A burning object goes out after three bursts that reach it and a pool of fuel after six. E puts it back on its wall, and a used one comes back after 45 s. Shooting one on the wall still bursts it, as before.

**Stoves.** E lights the gas rings on the restaurant's range and the dumpling and pho shops' cooking lines. A lit ring heats only what is put on it, so a cardboard box set on one caught in under half a second. Whoever lit the stove is credited with what follows.

**The breaker.** E at the box on the service alley's west wall switches off that alley's wall lamps and string lights, 25 lights in all, and switches them back on. Shot to pieces, it stays off.

**Fuel drums.** There are now six, not two: beside the restaurant's south door, at the corner of the middle block in the market alley, and in the service alley near the dumpling shop's and the bar's walls, as well as the original two.

## Breakable walls

Six sections of the 30 cm walls can be knocked through (`src/world/breaches.ts`): the restaurant's front, the bar's front, the pho house's front and back, the dumpling shop's back and the record shop's back. Each is about 2.4 m tall and 1.3 to 2.2 m wide. The market's other walls are the sides of solid buildings, with nothing behind them to break into.

A section shows what it has taken: thin cracks once a fifth of its strength has gone, and a web of them with patches knocked out of its face below 45%, modelled in `breach_cracks_a` and `breach_cracks_b`.

A section is a world entity of `masonry`, with 400 points of strength. A frag 1.15 m from one took 246, so two good frags or a frag and a fuel drum open it. Rounds stop in it and do an eighth of their damage, so a carbine would take about 180 rounds. Once it goes, the collider goes with it: players, rounds, blasts and heat all pass, and a new round rebuilds it.

The wall around a section is three colliders, either side and above, so nothing else about the wall's shape changes. The drawn wall stays the single baked mesh it always was, and the baked light stays valid. The hole is cut out of it in the shader, by world position along a ragged line, on each surface the section crosses. The broken brick round the hole and the rubble under it are modelled pieces (`breach_rim` and `breach_rubble` in `effects.glb`), stretched to each hole and drawn only once something has broken. In three alternating rounds at a MacBook Pro's Retina size, facing a section, the frame rate was 44.8 to 45.3 FPS with the cut-outs in the shaders and 43.6 to 46.0 FPS without, with the same draw calls and triangles.

## Weight

Everything a player carries has its real mass (`MASS` in `src/game/combatRules.ts`): the knife 0.25 kg, a grenade 0.4 kg, a smoke grenade 0.54 kg, the pistol 0.72 kg with a 70 g magazine and 12 g cartridges, and the carbine 3.1 kg with a 330 g steel magazine and 16.3 g cartridges. A loaded pistol and magazine weigh 0.94 kg; a full carbine magazine 0.82 kg. Beyond the basic kit of knife and four grenades (2.1 kg), each kilogram costs 1.2% of walking speed and 1.8% of sprinting speed, to at most a fifth. The same legs launch more mass, so a jump starts slower in proportion to the square root of the total mass, and the body's inertia grows with it, so starting, stopping and climbing take longer. A carbine with six spare magazines, a pistol with four and the four grenades weigh 12.8 kg: walking drops to 87%, sprinting to 81% (6.6 m/s), the jump to 94%. Heavier landings also hurt more, in proportion to the mass coming down. The HUD shows the load and turns amber above 7 kg.

## The knife

The knife's two strokes are swept, not single rays (`resolveKnife` in `src/game/matchState.ts`). A slash fans nine rays 1.7 m long across a 70° arc, from upper right to lower left and 22° high to low, in the order the arm moves the blade. A stab sends three rays 2.05 m straight ahead, reaching further because the player lunges into it. The blade stops at the first thing it meets along that order. A body takes the cut by zone: a slash does 45 to the head, 30 to the torso and 22 to the legs; a stab 100, 55 and 35. From more than 60° behind the target's facing, a stab is fatal and a slash does a quarter more. Anything else turns the blade: glass breaks, wood and cardboard take damage, a loose prop is shoved, and the stroke ends there with the material's impact.

The client sends the stroke when the blade reaches its target, 0.13 s into a slash and 0.24 s into a stab, aimed wherever the player is looking by then, and the coordinator spaces strokes by each one's recovery: 0.52 s after a slash and 0.9 s after a stab. A stab pushes the player forward at 2.8 m/s, which their footing bleeds off within a few tenths of a second. The first-person stroke pauses for 75 ms when it bites into a body, and a blade turned by something hard jolts the hand back. A cut or a carbine round knocks the victim back a little, a stab most.

## Spent cases, empty magazines and dropped guns

Each shot throws a case from the ejection port to the right, up and a little back, on top of the shooter's own velocity: 9 × 19 mm brass for the pistol, lacquered steel 7.62 × 39 mm for the carbine, at real size. A reload that empties a magazine drops it from under the gun. Cases and magazines are modelled in `public/models/items.glb` (the [asset pipeline](asset-pipeline.md)), each calibre's cases drawn as one instanced mesh holding only the cases about. These pieces are small rigid bodies integrated at 120 Hz against the physics world (`src/game/ejecta.ts`): they bounce off what they strike, keeping 36 to 42% of their speed along the surface normal for cases and 18% for a magazine, skid, tumble, ring or clatter as they land and come to rest on their side. They last about 40 s and are drawn only on the peer that sees them.

A fallen player's guns and magazines fall from their hands, pushed away from the killing blow: a gun with the rounds left in it, and the spare magazines for it. The coordinator traces their fall through the physics world to where they come to rest and shares the drop in its snapshot; every peer draws the same path tumbling into place. Taking a drop gives the gun if it is not already carried, or its magazine as a spare, plus the spares. Drops last a minute.

## Doors and hatches

The food truck's rear doors and serving hatch are colliders that swing on their hinges (`PhysicsWorld.addMover`), so a shut hatch stops players and catches rounds, and open doors stick out into the gap behind the truck. Pressing E within 2.3 m asks the coordinating peer to open or close the nearest one. Its state travels in the snapshot, every peer swings the panel over about half a second, and the collider follows. The character controller now walks up steps of up to 26 cm, which takes it up the truck's bumper and in at the doors.

## Grenades

Press G to throw a fragmentation grenade where you look: 14 m/s plus a little lift, from the right hand. Each life starts with two. The flight is integrated at 120 Hz with gravity, bounces that keep 38% of the speed along the surface normal and 72% across it, and rolling to rest. The coordinating peer computes where it settles; every peer draws the same path and hears it clink. It bursts 2.6 s after the throw. Within 7 m, players take up to 130 damage, falling off with distance, scaled by how much of their chest and head the blast can reach past cover. Objects take up to 320 by material, and loose ones are thrown outward. A blast in the open also throws nearby players away from it and off their feet, up to 7 m/s close in and less the heavier they are; cover shelters them. The blast has a flash, fireball, embers, smoke, a scorch mark, a camera shake that falls off with distance, on WebGPU a light that floods the alley for a moment, and a synthesised explosion with a long echo.

Press T to throw a smoke grenade, a canister with a white band. Each life starts with two. It flies and bounces like a fragmentation grenade and pops 1.8 s after the throw, once it has about come to rest. It harms nothing. Every peer then draws the same cloud from the pop event: grey soft-particle smoke pours out along the ground and up, a wall about 7 m across and 3 m high, for 13 s, then thins away over 5 s. The smoke hides players but stops no rounds, so a shot fired blind through it still lands. The canister lies where it stopped, hissing, until the smoke has gone.

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
| Sprint with 11.7 kg against 1.1 kg (before smoke grenades added 1.1 kg to both) | 0.81 of the speed |
| Slash at a player 1.3 m ahead | head for 45; aimed at the chest, torso for 30 |
| Stab from the front, from behind | 55; fatal (100) |
| Slash 2.4 m away | miss |
| Slash at shop glass, at a brick wall | glass broken; stopped on brick |
| Two tabs, stab in the back of a player with a carbine | carbine dropped at the same spot on both, taken by the other player |
| Two tabs, the non-coordinator walks into the large crate | moved 1.5 m on both screens |
| Walk into the truck's shut doors, open them, walk in | stopped at the bumper, then up the step and in to the floor at 0.46 m |
| One pistol round at the serving glass, two at a front tyre | glass broken; tyre flat |
| Three pistol rounds at a propane cylinder | vented, burst after 1.6 s, broke every truck window, flattened the other tyres, damaged a stall and set off the second cylinder |
| Two tabs, one opens the rear doors, the other drops the hatch | both see both, with the panels swung the same way |
| One pistol round each at three lanterns of one row | all three dark; the row's real light fell from full to off |
| Three pistol rounds at the breaker box | 25 service-alley lamps went out, on WebGPU and WebGL |
| E at the record shop's shut front door | opened; a ray through the doorway was clear |
| A knife slash into the bar's shut north door | kicked open |
| Pistol rounds at the restaurant's shut south door | one leaf off its hinges after 4; a ray through it was clear |
| Pistol rounds at the record shop's boarded window | gone after 5; a ray through the window was clear |
| One pistol round at the service alley's steam pipe | burst, and the cloud filled the alley around it |
| Pistol rounds at the fruit stall | awning torn after 4; collapsed after 8 into a pile that stopped a ray at 0.35 m and let one through at 1.6 m |
| Two pistol rounds at the fuel drum by the restaurant | vented, then burst: blew off both restaurant door leaves, broke its window, two crates and five lamps, and damaged the noodle stall |
| One pistol round at an extinguisher | burst into a cloud of powder |

## Limits

- A player on another peer pushes props through the coordinator, so the prop moves about a tenth of a second after they lean on it.
- Spent cases and empty magazines are local, so each peer's lie in slightly different places.
- Ragdolls are not synchronised, so a body may come to rest in slightly different places on different screens.
- Upper-floor windows break, but only the bar's upper room can be entered; elsewhere the round stops in the wall behind.
- Destroyed objects stay destroyed until the next round starts or the room resets.
