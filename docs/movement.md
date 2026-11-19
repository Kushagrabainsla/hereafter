# Movement and accuracy

Walking, running, jumping and crouching run on the Rapier capsule controller in `src/game/playerController.ts` at a fixed 60 Hz. This note covers the slide, the mantle, firing out of a sprint, carried weight, how the held weapon moves, and the spread that movement adds to shots.

## Speeds

A player with the basic kit walks at 4.5 m/s forward and to the side, and at 3.6 m/s backward (`BACKWARD_SPEED`, 0.8 of the walk). A sprint is 8.2 m/s and needs forward motion: Shift with the forward key, alone or with a side key. Shift with only the backward key or only a side key walks. Before, Shift gave the sprint speed in every direction, so a player could back away from a fight at full speed with the gun on the enemy. Measured in the running game (`b12.mjs`): forward 4.5, backward 3.6, sideways 4.5, Shift forward 8.2, Shift backward 3.6, Shift forward and sideways 8.2.

## Keys

The game reads each key by its place on the keyboard (`event.code`, in `src/keys.ts`), not by the letter printed on it. The controls sit under the same fingers on every layout: on an AZERTY keyboard, the key marked Z walks forward.

Ctrl is a crouch key, so every action key also works with Ctrl held: a crouched player can reload, throw a grenade, bandage, interact and switch weapons. In full screen, Chromium browsers pass the game's keys to the page (`navigator.keyboard.lock` in `src/mouseLock.ts`), so Ctrl with W does not close the tab. Escape is not locked: it leaves full screen and frees the mouse at once.

**Pause menu.** When the mouse comes free in play, the pause menu opens (`openPause` in `src/play.ts`). That happens on Escape, and also when another window takes the keyboard. With the mouse already free, Escape opens the menu. The menu has Resume, Settings, Controls, Invite and Leave match. Resume locks the mouse again; the click on the button is the gesture that the browser asks for. A second Escape only closes the menu, because the browser does not accept Escape as that gesture. Settings, Controls and Invite go back to the menu when they close. In a solo game the practice targets stand still while any dialog is open, but the clock of the world does not stop: a fire burns on and a wound bleeds on. In a room the match goes on, and the menu says so. Leave match leaves the room and continues solo. In a solo game that button goes to the setup screen, where graphics, time of day and mode are set.

**Input settings.** The Settings dialog has four input settings (`src/inputSettings.ts`). The game keeps them in the browser, and a change applies at once.

| Setting | Range | First value | What it does |
| --- | --- | --- | --- |
| Mouse speed | 0.2 to 3 | 1 | Multiplies the game's 0.18° of turn for each count of the mouse |
| Mouse speed while aiming | 0.3 to 1.5 | 1 | Multiplies the mouse speed when fully aimed. The zoom of the sights slows the view too, so 1 keeps the same hand movement for the same distance on the screen |
| Field of view | 60° to 100° | 75° | The view's height angle when you stand still. A sprint adds 5°, a slide adds 7° and a crouch takes off 3° |
| Invert up and down | on or off | off | Moving the mouse away looks down |

The hands and the gun keep their own field of view of 75°, so the gun has the same size at every setting. The mouse lock asks the browser for the mouse's own movement, without the pointer acceleration of the operating system (`unadjustedMovement` in `src/mouseLock.ts`). A browser or system that cannot give that gets the plain lock.

Measured in the running game (`i2.mjs`): a movement of 100 counts turns the view 18.0° at speed 1 and 36.0° at speed 2. Aimed with the pistol (zoom 1.25), it turns 14.4° at aim speed 1 and 7.2° at 0.5. At a field of view of 95°, the view has 95.0° and the hands 75.0°. The values are the same after a reload.

## Slide

Press C or Ctrl while running to slide. The slide keeps the direction you were running, adds 1.8 m/s on top of your speed (at most 10.5 m/s) and bleeds off 8.5 m/s every second. It ends when you let go of crouch, leave the ground, drop below 3.2 m/s, hit a wall or after 1.3 s. A full slide covers about 5 m in 0.8 s. Strafe keys steer it slightly, and the view stays free.

The camera drops to 0.98 m, tilts about 3°, and widens to an 82° field of view. The capsule uses the crouched shape, so the slide is also a crouch for hit detection. Jumping out of a slide stands you up and keeps the slide's speed: in the air, momentum faster than your input decays slowly instead of braking to walking speed. A new slide cannot start for 0.6 s after one ends.

## Mantle

Press Space facing a ledge between 0.45 m and 1.6 m high to climb onto it. This covers the dumpsters (1.3 m) and the restaurant and bar counters (1.05 and 1.1 m), which the 0.97 m jump cannot reach. Holding forward while jumping into a ledge catches it in mid-air too. `PhysicsWorld.findLedge` probes forward at knee and waist height for a face within reach, then casts down just past it to find the top. It accepts the ledge only if the standing capsule fits both on top and above where you stand, and nothing blocks the way over the edge. Walls and stalls are too tall to climb.

The climb rises beside the ledge first, then moves over its top, taking 0.3 s plus 0.18 s per metre of height, or about 0.5 s for a counter. The weapon tucks away and you cannot attack until you are on top.

## Firing out of a sprint

Firing while running drops the sprint, and the shot leaves once the weapon is up: 140 ms for the pistol and 220 ms for the carbine. Each attack holds the sprint off for 0.35 s. A held trigger therefore walks, and a released one runs again on its own if Shift is still held. The weapon now comes out of the sprint carry about twice as fast as it drops into it.

## Carried weight

Guns, magazines and grenades weigh what they really do, and the load slows walking, sprinting, jumping, starting and stopping, ladder climbs and mantles; see [physics notes](physics.md#weight) for the figures. Hard work builds exertion: sprinting, climbing, jumping and mantling raise it, faster under a heavy load, and walking or standing lets it ease. Exertion shows in the hands as heavier breathing.

Outside forces add velocity on top of walking, which the feet bleed off at 8 per second on the ground and slowly in the air: a carbine round knocking you back and a nearby grenade throwing you off your feet. Heavier players are moved less.

## How the held weapon moves

The weapon hangs off the hands like a mass on a spring (`WeaponVisuals` in `src/game/weaponVisuals.ts`). Each frame the spring is driven by the eyes' acceleration along the camera's own axes and by how the view turns. Turning drags the weapon behind the turn, sudden starts and stops add a swing, starting to run leaves it behind and stopping throws it forward, a jump or a landing dips it, and strafing rolls it a little. Heavier weapons swing slower and further: natural frequencies are 2.1 Hz for the pistol and 1.5 Hz for the carbine, at half critical damping. Breathing raises and tips the weapon about 14 times a minute at rest, deepening and quickening to about 40 a minute after a hard sprint, over a faint tremor of the hands.

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

Sustained fire blooms on top of that. Each shot adds 0.35° for the pistol and 0.2° for the carbine, up to 1.2° and 1.6°. After a 0.12 s rest, bloom recovers at 3.5° and 2.8° per second.

Aiming down the sights, by holding the right button, sends a round where the sights point: the cone keeps only 0.15 of the stance's spread and none of the bloom (`AIM_SPREAD`). What makes aimed fire hard is the recoil, which a player can learn to hold, not chance. Before, aiming only halved the whole cone, bloom included, so an aimed carbine burst still scattered at random. Measured in the running game with the view held still and the recoil taken out (`b7.mjs`): aimed, the pistol's rounds land 1 cm apart at 30 m (6 cm before) and the carbine's 2 cm apart (32 cm before); from the hip, 12 cm and 62 cm, as before. The sights come up in 0.17 s for the pistol and 0.24 s for the carbine (`aimSeconds` in `gunFeel.ts`), eased at both ends, magnifying the view 1.25 times for the pistol and 1.5 times for the carbine, with the look slowed in proportion and the weapon in hand drawn without the magnification. The tight cone, the smaller recoil and the `aiming` flag start when the sights are 90% of the way up. The gun moves so its sights sit on the centre of the view, its sway drops to a quarter and the walk's swing stops. The player walks at 55% of their pace and cannot sprint, and the sights drop for a reload or a weapon switch. Pose packets carry an `aiming` flag, protocol 17, which the coordinator applies to the cone. The crosshair hides while aiming.

The crosshair's four ticks open to the same spread every frame, converted to pixels from the camera's field of view, with a 3 px minimum. Pose packets carry new `sliding` and `airborne` flags for this. Older peers omit them, and those flags then count as false.

## Gun feel

Every number that shapes how the guns handle is in one table, `GUN_FEEL` in `src/game/gunFeel.ts`. Change a number there to change the feel; each number has a comment that says what it does.

**Automatic fire keeps an even beat.** With the trigger held, the carbine fires every 135 ms. A timer looks every 8 ms if the next shot is due (`FIRE_BEAT` in `src/play.ts`). Each shot counts from the moment it was due, not from the moment the timer fired it. Before, a 16 ms timer fired each shot late and the next shot counted from that late moment, so the time between shots was 135 to 166 ms, about 145 ms on average: the carbine fired 7% slower than its own rate, and unevenly. The match accepts a shot that comes up to 25 ms early (`FIRE_TOLERANCE_MS`) and counts it from the moment it was due, so a burst is never faster than the weapon. Measured in the running game (`b10.mjs`), over 25 shots after the first: 135.0 ms on average, 125 to 145 ms, and the match accepted every shot.

**Recoil.** A shot kicks the view up and to a side. The kick is an offset on top of the aim, so it can return: before, each shot moved the aim itself up by 1.2° (pistol) or 0.7° (carbine) for good. Each shot adds one row of the weapon's `pattern`, in degrees up and right, plus a small random part. The carbine climbs hard for four shots, then wanders right and back left; a long burst goes round the last ten rows again. The view chases the kick quickly (`attack`), starts to return `rest` seconds after the last shot, and comes back at the rate `recovery`. The climb stops at `maxPitch`. Aiming down the sights leaves 70% to 75% of the kick, and crouching 80%. Shots leave along the kicked view.

A mouse move against the recoil is taken out of the recoil first. A player who holds the sights on target through a burst therefore keeps the view where it is when the burst ends; the view is not thrown downward as the recoil returns.

| Measured in play, view pitch every frame | Before | Now |
|---|---|---|
| Carbine, 12 rounds, hands off the mouse | climbs 7.7° in 11 rounds, never returns | climbs 6.3°, returns to 0.00° |
| Carbine, most turn to a side in that burst | 0.0° | 0.7° |
| Pistol, 6 shots 0.4 s apart | climbs 6.0°, never returns | 1.5° for each shot, returns to 0.00° |
| Carbine, 12 rounds, view pulled down 4° a second | (no test) | ends 0.6° under the start, then does not move |

**Kick.** The gun also moves in the hands for each shot (`kick` in the table, `GunKick` in `gunFeel.ts`). A critically damped spring throws it back toward the eye and up, tips the muzzle up, and turns and rolls it to a random side. It peaks `peakMs` after the shot and is home after about six times that. Each shot differs from the last by up to `vary`. Shots that come faster than the spring settles stack, so automatic fire rides back and shudders. Aiming down the sights leaves the share `aimed` of the kick. Before, a clip with linear keys at 24 frames a second played for each shot: it was the same every time, it restarted with a snap in automatic fire, and it played at full strength while aiming.

| Measured in play, the muzzle in the camera's frame | Before | Now |
|---|---|---|
| Pistol, hip fire: travel of the muzzle | 45 mm, the same for each shot | 44 to 56 mm, about 22% between shots |
| Time from the shot to the peak | about 65 ms | about 40 ms (one frame at the test's 30 frames a second) |
| Time until the gun is home | about 250 ms | about 160 ms |
| Pistol, aiming: share of the hip-fire travel | 116% | 28% |

**Flash and smoke.** The muzzle flash (`flash` in the table) shows for `ms` milliseconds, and always for one whole frame. Each shot draws it at a new size between the two numbers of `size`, stretched along the barrel by up to `stretch`, and at a random roll about the barrel. Before, the fire clip showed one shape at one size for about 95 ms. Each shot also leaves a puff of smoke at the muzzle that drifts forward and up, grows to `smokeSize` metres and thins out in `smokeSeconds`. It starts at the density `smokeOpacity`, and is thinner while the player aims, so it does not hide the target.

| Measured in play, the flash every frame | Before | Now |
|---|---|---|
| Time the flash shows | 88 to 101 ms | one frame: 15 to 36 ms at the test's frame rate |
| Size of the flash over five shots | 1, 1, 1, 1, 1 | 0.80 to 1.33 |
| Roll about the barrel over five shots | the same | different for each shot |

**Camera shake.** One value, the trauma (0 to 1), drives every shake of the camera (`SHAKE` in `gunFeel.ts`, `ViewShake`). A shot adds a little (`shake` in the weapon's row), a hit adds by its damage, a hard landing adds by its speed, and a blast adds up to 1 at its centre, falling to nothing at 24 m. The shake is the square of the trauma, so small knocks barely show and big ones are strong. The trauma drains at a steady rate. The motion is smooth noise on pitch, yaw and roll (three sine waves that never line up), not a new random jolt each frame. It turns the picture only: shots leave along the aim. Before, only blasts moved the camera, by a new random offset and roll each frame.

**Landing dip.** When the player lands, the eyes drop and come back up (`LANDING` in `gunFeel.ts`): 2.2 cm for each m/s of landing speed above 2.5 m/s, at most 16 cm, lowest about 70 ms after the landing.

| Measured in play, the camera every frame | Before | Now |
|---|---|---|
| Blast 6 m away: most turn of the view | 0° pitch, 0° yaw, 0.29° roll | 0.72° pitch, 0.41° yaw, 0.87° roll |
| Blast: jolt index (size of the frame-to-frame changes of direction against the size of the motion; random jolts give about 2.4 or more) | 3.21 | 0.34 to 0.43 |
| One pistol shot: roll of the view | 0° | 0.09° for about 90 ms |
| Landing from a jump on the spot: dip of the eyes | 0 cm | 5.3 cm, lowest 42 ms after the landing, back after 330 ms |
| Landing from a 2.5 m drop | 0 cm | 12.3 cm, lowest 58 ms after the landing, back after 350 ms |

**Sights.** The zoom of the sights follows the aim (0 to 1) directly, and only the view's own field of view eases (wider in a sprint, narrower in a crouch; `AIM` in `gunFeel.ts`). The gun is drawn through a lens that depends on the aim alone. Before, the zoomed view eased on its own, behind the aim, and the gun's lens was worked out from both: on the way up, the gun shrank and then grew again, and the view went on zooming after the sights had arrived. The crosshair fades out as the sights come up, and the gun's own iron sights are the aim, as in other shooters. They used to be hard to see: the pistol was held at arm's length, its front sight 53 cm from the eye, so the sights were small and dark against the street at dusk. Aiming now brings the pistol 15 cm and the carbine 6 cm closer to the eye (`back` in `SIGHTS`, `authoredViewModel.ts`), so the rear notch and front post fill the middle of the view. The sights were also a little off the point where the rounds go: the pistol's front sight stood 14 px high and 4 px right on a 1600 × 900 view, the carbine's 5 px high and 8 px right. `SIGHTS` now has a side offset as well as a height, fitted by projecting the front sight onto the screen while aiming and averaging 12 samples (`sightprobe.mjs` in the test kit). Both front sights now sit within 3 px of the centre on average; the steadied sway still moves them about 10 px either way.

| Measured in play, every frame, carbine | Before | Now |
|---|---|---|
| Time for the sights to come up | 356 ms | 241 ms (pistol: 150 ms) |
| Field of view the gun is drawn with, without the aim's own part: most it is off | 17.5° | 0.0° |
| Gun size on screen on the way up | overshoots by 15.5% and comes back | changes one way only, no overshoot |
| World zoom: time it goes on after the sights are up | 234 ms | 0 ms |
| Crosshair opacity with the sights up | 1 | 0 |
| "Aiming" (steadier aim) starts when the sights are | past 50% | past 90% |

## Leaning, hit reactions and climbing

Hold Q or E to lean left or right while standing or walking. The lean starts after the key is held for 150 ms (`LEAN_HOLD` in `playerController.ts`), because E is also the interact key: a tap of E to take a pickup or open a door does not tilt the view. A press of E that interacts with something does not lean at all, however long the key stays down. The eyes move 0.32 m to the side and drop slightly, the view tilts 8°, and walking slows to 70%. A wall at the side limits how far the lean goes. Shots leave from the leaned eyes, and a leaning player's head and chest boxes move with them, so peeking exposes less of the body. Other players lean visibly: the body rolls a little and the upper body bends the rest of the way.

Taking a hit kicks the view up and to one side, more for heavier hits, and the kick moves where shots go until it settles in about a quarter of a second. For 0.55 s after a hit, movement slows by up to 45%. Other players flinch when hit.

Ladders, stairs and falling are described in the [physics notes](physics.md).

## Measurements

Headless Chrome checks drove the running game and stepped the controller directly where frame timing mattered:

| Check | Result |
|---|---|
| Slide | 5.06 m in 0.78 s of game time, peak 9.86 m/s, eye 0.98 m, 3.4° tilt |
| Slide during and after cooldown | no slide, then a slide |
| Slide jump | 7.9 m/s carried into the air |
| Mantle onto a 1.12 m ledge with Space | on top in 0.48 s |
| Jump and hold forward into the ledge | caught and climbed in 0.35 s |
| Pistol and carbine shot after firing from a sprint | 161 ms and 244 ms, sprint back about 0.35 s later |
| 200 leader-resolved carbine shots per movement state | widest deviation equal to the table, mean two thirds of it |
| Carbine bloom over 11 shots at 140 ms | mean deviation 0.27° rising to 1.26° |
| Crosshair gap, carbine | 3.7 px standing, 9.6 walking, 18.5 in the air, 3.0 crouched |
| Lean | full lean in about half a second, eyes moved 0.32 m; a shot 0.3 m beside an upright head misses it and hits the leaning head |
| Sprint loads | 1.1 kg: full speed; 2.4 kg (pistol, two magazines): 97.5%; 11.7 kg: 81% (measured before smoke grenades, which add 1.1 kg to every load) |

## Limits

- Slides ignore slopes; the market is flat.
- Spread depends on movement and aiming flags each client reports about itself, so a modified client can fire as if standing still and aiming, as it can already misreport its position.
- Other players' slides show as a crouch gliding along, since the third-person character has no slide clip.
