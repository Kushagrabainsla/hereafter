# Movement and accuracy

Walking, running, jumping and crouching run on the Rapier capsule controller in `src/game/playerController.ts` at a fixed 60 Hz. This note covers the slide, the mantle, firing out of a sprint, and the spread that movement adds to shots.

## Slide

Press C or Ctrl while running to slide. The slide keeps the direction you were running, adds 1.8 m/s on top of your speed (at most 10.5 m/s) and bleeds off 8.5 m/s every second. It ends when you let go of crouch, leave the ground, drop below 3.2 m/s, hit a wall or after 1.3 s. A full slide covers about 5 m in 0.8 s. Strafe keys steer it slightly, and the view stays free.

The camera drops to 0.98 m, tilts about 3°, and widens to an 82° field of view. The capsule uses the crouched shape, so the slide is also a crouch for hit detection. Jumping out of a slide stands you up and keeps the slide's speed: in the air, momentum faster than your input decays slowly instead of braking to walking speed. A new slide cannot start for 0.6 s after one ends.

## Mantle

Press Space facing a ledge between 0.45 m and 1.6 m high to climb onto it. This covers the 1.12 m concrete barriers, which the 0.97 m jump cannot reach, and the planters. Holding forward while jumping into a ledge catches it in mid-air too. `PhysicsWorld.findLedge` probes forward at knee and waist height for a face within reach, then casts down just past it to find the top. It accepts the ledge only if the standing capsule fits both on top and above where you stand, and nothing blocks the way over the edge. Buildings are too tall, and thin poles have no top within reach.

The climb rises beside the ledge first, then moves over its top, taking 0.3 s plus 0.18 s per metre of height, or about 0.5 s for a barrier. The weapon tucks away and you cannot attack until you are on top.

## Firing out of a sprint

Firing while running drops the sprint, and the shot leaves once the weapon is up: 60 ms for the knife, 140 ms for the pistol and 220 ms for the carbine. Each attack holds the sprint off for 0.35 s. A held trigger therefore walks, and a released one runs again on its own if Shift is still held. The weapon now comes out of the sprint carry about twice as fast as it drops into it.

## Spread

Shots leave inside a cone around the aim. The coordinating peer applies it when it resolves the shot, from the shooter's reported movement and its own record of their recent shots, using `spreadDegrees` in `src/game/combatRules.ts`. Directions are uniform over the cone's area.

| Edge of the cone, degrees | Pistol | Carbine |
|---|---|---|
| Standing | 0.30 | 0.40 |
| Crouched | 0.18 | 0.24 |
| Walking | 0.66 | 1.04 |
| Crouch-walking | 0.40 | 0.62 |
| Sliding | 0.90 | 1.20 |
| In the air | 1.50 | 2.00 |

Sustained fire blooms on top of that. Each shot adds 0.35° for the pistol and 0.2° for the carbine, up to 1.2° and 1.6°. After a 0.12 s rest, bloom recovers at 3.5° and 2.8° per second. The knife has no spread.

The crosshair's four ticks open to the same spread every frame, converted to pixels from the camera's field of view, with a 3 px minimum. Pose packets carry new `sliding` and `airborne` flags for this. Older peers omit them, and those flags then count as false.

## Leaning, hit reactions and climbing

Hold Q or E to lean left or right while standing or walking. The eyes move 0.32 m to the side and drop slightly, the view tilts 8°, and walking slows to 70%. A wall at the side limits how far the lean goes. Shots leave from the leaned eyes, and a leaning player's head and chest boxes move with them, so peeking exposes less of the body. Other players lean visibly: the body rolls a little and the upper body bends the rest of the way.

Taking a hit kicks the view up and to one side, more for heavier hits, and the kick moves where shots go until it settles in about a quarter of a second. For 0.55 s after a hit, movement slows by up to 45%. Other players flinch when hit.

Ladders, stairs and falling are described in the [physics notes](physics.md).

## Measurements

Headless Chrome checks drove the running game and stepped the controller directly where frame timing mattered:

| Check | Result |
|---|---|
| Slide | 5.06 m in 0.78 s of game time, peak 9.86 m/s, eye 0.98 m, 3.4° tilt |
| Slide during and after cooldown | no slide, then a slide |
| Slide jump | 7.9 m/s carried into the air |
| Mantle onto a 1.12 m barrier with Space | on top in 0.48 s |
| Jump and hold forward into the barrier | caught and climbed in 0.35 s |
| Pistol and carbine shot after firing from a sprint | 161 ms and 244 ms, sprint back about 0.35 s later |
| 200 leader-resolved carbine shots per movement state | widest deviation equal to the table, mean two thirds of it |
| Carbine bloom over 11 shots at 140 ms | mean deviation 0.27° rising to 1.26° |
| Crosshair gap, carbine | 3.7 px standing, 9.6 walking, 18.5 in the air, 3.0 crouched |
| Lean | full lean in about half a second, eyes moved 0.32 m; a shot 0.3 m beside an upright head misses it and hits the leaning head |

## Limits

- Slides ignore slopes; the arena's terrain is nearly flat.
- There is no aim-down-sights, so the standing spread is the tightest available.
- Spread depends on movement flags each client reports about itself, so a modified client can fire as if standing still, as it can already misreport its position.
- Other players' slides show as a crouch gliding along, since the third-person character has no slide clip.
