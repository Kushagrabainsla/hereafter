# Audio and hit feedback

The game plays recorded CC0 sound for guns, reloads, handling, footsteps and impacts, and synthesises the HUD confirmation sounds. Sources and licences are in [data sources](data-sources.md); `npm run build:audio` rebuilds `public/audio/` from them.

## What you hear

- **Your weapon.** Close recordings of a Walther PPQ 9 mm and an AK-47, with a random take, a few percent of pitch variation and a low thump underneath. They play the moment you fire, without waiting for the shot to be validated. The knife swing is a swept noise whoosh that crosses from right to left.
- **Handling.** Switching plays a holster rustle, then a knife draw or a grab and ready click, timed to the 560 ms lower-and-raise. Reloads play a magazine change and slide or charging-handle recording cut to the 1.2 s and 1.7 s reload times. While it plays, the weapon cants and kicks as the magazine seats and the action closes. Picking up a weapon plays a grab and a magazine seat, and an empty gun clicks.
- **Movement.** Footsteps follow the head bob, one per low point, alternating slightly left and right. Every surface in the market, paving, asphalt and floors alike, sounds like concrete. Jumps and landings scale with fall speed.
- **Other players.** Their shots, footsteps, landings, reloads and pickups come from where they are. A shot within 14 m uses the close recording; further away it uses a mid-distance recording with its own street echo. A round that passes within 3 m of your head adds a supersonic crack and whiz from where it passed. Bullets striking cover within 45 m make a stone impact, and hits on other players thud at the target.
- **Bullets striking things.** Concrete and ground crack and chip, metal rings, wood thunks, glass ticks and cardboard or plastic thump, each positioned where the round struck. Glass shatters, crates splinter and concrete crumbles when they break.
- **Grenades.** A pin click and swing when thrown, clinks as it bounces, and a synthesised explosion: a sharp crack, a roaring low-passed body and a sub-bass drop with a long street echo. Distant blasts lose the crack and keep the rumble.
- **Movement extras.** Boots on steel rungs when climbing a ladder.
- **Being hit.** A body blow and low thump with a brief muffling of the whole mix; elimination keeps the mix muffled until you respawn.
- **Confirmation.** A short high tick for a hit, a metallic ring added for a headshot, and a heavier thunk with a bright ring for an elimination.

Press M to mute or unmute; the choice is remembered in the browser.

## How it is mixed

`src/game/gameAudio.ts` owns one Web Audio graph. Samples are fetched and decoded on an offline context while the map loads, and the playing context is created on the first click, tap or key press, because browsers block audio before a gesture. Each sample starts at its first loud sample, which skips MP3 encoder padding.

World sounds pass through a low-pass filter used for the hit and elimination muffling, then a fast limiter on the top 8 dB, then the master gain. Web Audio compressors add make-up gain derived from their curve, so a gentler bus compressor would have lifted footsteps and handling noise towards gunshot level. Confirmation sounds join after the limiter so a loud shot cannot push them down. Gunshots and other players' sounds also feed a convolution reverb built in code: early reflections at 19 to 151 ms for building facades and a darkening tail of about one second.

Positioned sounds are folded to mono, then pass an HRTF panner with inverse distance roll-off and a low-pass filter whose cutoff falls with distance to imitate air absorption. A ray from the listener to the source through the Rapier physics world adds a 1.1 kHz low-pass and a 5 dB cut when buildings or cover are in the way. At most 40 positioned sounds play at once; footsteps and impacts give way to gunfire first. `src/game/soundStage.ts` keeps the listener on the camera, times footsteps and picks surfaces, and places combat events.

## Visual feedback

The hit marker is four strokes around the crosshair: white for a hit, amber for a headshot, and larger and red for an elimination, with the damage dealt underneath. An elimination also shows a banner with headshot, weapon and distance, and bumps the kill count. Damage taken shows a red arc around the crosshair pointing at the attacker, computed from the shot's origin and the camera's screen-right vector, alongside the existing red vignette.

## Measurements

A scripted headless Chrome session played through the real game while recording the master bus. It walked to the first pickup, fired, reloaded and sprinted, then switched weapons, dry-fired and swung the knife. A test opponent then walked across, reloaded, fired near misses and hit the player before being shot and killed with a headshot. Peaks from that recording:

| Sound | Peak |
|---|---|
| Own pistol shot, own rifle burst | −3 dBFS |
| Loudest moment (pistol headshot with elimination confirmation) | −1.5 dBFS |
| Hit tick or headshot ring on its own | −9 dBFS |
| Own reload, magazine and slide | −10 to −14 dBFS |
| Own sprint footsteps | −16 dBFS |
| Own walking footsteps | −20 dBFS |
| Other player walking about 9 m away | −24 dBFS |

A pistol shot placed 10 m to the screen-right measured 4.6 dB louder in the right channel, and one to the left 4.7 dB louder in the left. Headless checks measure levels, timing and direction, not taste; the mix should still be judged by ear on headphones and laptop speakers.

## Limits

- Snapshots carry only the latest combat event, so when shots arrive faster than snapshots, some of another player's shots can go unheard, as their tracers can go unseen.
- Sound does not travel with a delay over distance, and there is no ambient market sound, voice or music.
- Other players' weapon switches are silent, and remote reloads start when the leader's snapshot arrives.
- The reload motion is procedural; the view models still have no authored reload clip.
