# Audio and hit feedback

The game plays recorded CC0 sound for guns, reloads, handling, footsteps and impacts, and synthesises the HUD confirmation sounds. Sources and licences are in [data sources](data-sources.md); `npm run build:audio` rebuilds `public/audio/` from them.

## What you hear

- **Your weapon.** Close recordings of a Walther PPQ 9 mm and an AK-47, with a random take, a few percent of pitch variation and a low thump underneath. They play the moment you fire, without waiting for the shot to be validated.
- **Handling.** Switching plays a holster rustle, then a grab and ready click, timed to the 560 ms lower-and-raise. Reloads play a magazine change and slide or charging-handle recording cut to the 1.2 s and 1.7 s reload times. While it plays, the weapon cants and kicks as the magazine seats and the action closes. Picking up a weapon or magazines plays a grab and a magazine seat, and an empty gun clicks.
- **Movement.** Footsteps follow the head bob, one per low point, alternating slightly left and right. Every surface in the market, paving, asphalt and floors alike, sounds like concrete. Jumps and landings scale with fall speed.
- **Other players.** Their shots, footsteps, landings, reloads and pickups come from where they are. A shot within 14 m uses the close recording; further away it uses a mid-distance recording with its own street echo. A round that passes within 3 m of your head adds a supersonic crack and whiz from where it passed. Bullets striking cover within 45 m make a stone impact, and hits on other players thud at the target.
- **Bullets striking things.** Concrete and ground crack and chip, metal rings, wood thunks, glass ticks and cardboard or plastic thump, each positioned where the round struck. Glass shatters, crates splinter and concrete crumbles when they break.
- **Grenades.** A pin click and swing when thrown, clinks as it bounces, and a synthesised explosion: a sharp crack, a roaring low-passed body and a sub-bass drop with a long street echo. Distant blasts lose the crack and keep the rumble.
- **Movement extras.** Boots on steel rungs when climbing a ladder.
- **Lamps.** A shot bulb, lantern or neon tube pops with a bright tinkle; a breaker box or lightbox sign shorts out with a crackle and a buzz.
- **Doors and steam.** A door latches and swings, and knocks when it shuts. A burst steam pipe bangs and roars for about 11 s, then eases off. A shot extinguisher clanks and blasts powder for a few seconds. A smoke grenade pops with a dull thump and hisses for as long as its smoke pours out. A stall's awning rips as it is shot to rags, and a fuel drum roars like a propane cylinder before it bursts.
- **The food truck.** Its doors and hatch latch and swing, and knock when they shut. A tyre bursts with a bang and the hiss of escaping air. A shot propane cylinder roars louder until it bursts.
- **Brass.** Spent cases ring as they land: a bright ring for 9 mm brass, a duller one for the carbine's lacquered steel, made of four inharmonic partials with a short decay. An empty magazine dropped in a reload clatters. Both are positioned where they land and dulled behind cover.
- **The market.** The city goes on beyond the walls: a low rumble that slowly breathes, a car passing a street away every 5 to 15 s, and now and then a siren far off. Nearby, each air conditioner's fan whirs and beats with its blades. The blade signs' neon hum and the fans' 50 Hz motor hum were taken out: a steady 120 Hz buzz, 31 dB above everything else at the spawn, that sounded like a fault. Music plays from a speaker high in the bar's back corner: a four-bar loop of kick, clap, hats, a bass line and soft chords, made in code at 92 beats a minute, heard through the walls and windows as a dull thump and clearly inside. Each source sounds only while the listener is in range (14 m for fans, 42 m for the music), and like other positioned sounds it goes dull and quieter behind walls. The check stops a metre short of each source, which sits in its own collider or against a wall.
- **Voices.** Players grunt on some jumps, on every climb and on hard landings, and cry out when hit and when they die. The synthesised breathing after a sprint was taken out: it went on hissing for up to 10 s after the player stopped. They also speak, in Hindi or English as each chooses on the setup screen or in the room dialog, or not at all when they turn voice lines off: a call as they throw a grenade or smoke, reload or run dry, a shout when a frag lands within 6 m or a round passes within 1.5 m, a taunt after a kill (its own for a headshot, a double kill within 4 s or revenge), a line when hit or down to the last quarter of their health, last words, a word on respawning, and lines as a round starts and ends. Each moment has several lines, picked by a hash of the combat event, so every player hears the same player say the same line; chances keep the chatter down (a kill taunt 60% of the time, a reload call 35%) and a player waits 2.5 s after a line before the next. Lines come in three tiers: clean, spicy and 18+; a listener who has not turned on 18+ lines hears a clean line in place of an 18+ one. A player's own voice plays close and unplaced, others' from where they stand, dulled behind walls. The wordless sounds are recordings; the English lines are text-to-speech placeholders and the Hindi lines silent until recorded ([recording sheet](voice-lines.md)). Only the clips a player can hear are downloaded: their own language's, and another player's as they join, with 18+ lines only for a listener who hears them.
- **Memes.** On top of all this, meme sound effects and lines ([list](voice-lines.md#memes), `src/game/memes.ts`): a vine boom or a bonk on a headshot, an air horn on a double kill, a boing on a jump, a metal pipe on a hard landing, a dramatic sting at low health, a record scratch on respawning, a sad trombone for the losers of a round, crickets after a round with no kills, and a fart for crouching up and down over someone who has just died. Meme lines in Hindi or English, in the speaker's language, wait for their clips and play after the speaker's own line. Each moment has its own chance (a sprint or jump about one in six, a headshot or double kill nine in ten) and a player sets off at most one meme every 30 s. Combat memes are picked by a hash of the event like the lines; memes for a player's own movement (a jump, a 4 s sprint, a hard landing) are rolled by their peer and sent to the room. A listener can turn memes off on the setup screen or in the room dialog; 18+ memes follow the 18+ choice.
- **Rounds.** A bell rings twice as a round starts and once, lower and longer, as it ends.
- **Being hit.** A body blow and low thump with a brief muffling of the whole mix; elimination keeps the mix muffled until you respawn.
- **Confirmation.** A short high tick for a hit, a metallic ring added for a headshot, and a heavier thunk with a bright ring for an elimination.

Press M to mute or unmute; the choice is remembered in the browser.

## How it is mixed

`src/game/gameAudio.ts` owns one Web Audio graph. Samples are fetched and decoded on an offline context while the map loads, and the playing context is created on the first click, tap or key press, because browsers block audio before a gesture. Each sample starts at its first loud sample, which skips MP3 encoder padding.

World sounds pass through a low-pass filter used for the hit and elimination muffling, then a fast limiter on the top 8 dB, then the master gain. Web Audio compressors add make-up gain derived from their curve, so a gentler bus compressor would have lifted footsteps and handling noise towards gunshot level. Confirmation sounds join after the limiter so a loud shot cannot push them down. Gunshots and other players' sounds also feed a convolution reverb built in code: early reflections at 19 to 151 ms for building facades and a darkening tail of about one second.

Positioned sounds are folded to mono, then pass an HRTF panner with inverse distance roll-off and a low-pass filter whose cutoff falls with distance to imitate air absorption. A ray from the listener to the source through the Rapier physics world adds a 1.1 kHz low-pass and a 5 dB cut when buildings or cover are in the way. At most 40 positioned sounds play at once; footsteps and impacts give way to gunfire first. `src/game/soundStage.ts` keeps the listener on the camera, times footsteps and picks surfaces, and places combat events.

## Visual feedback

The hit marker is four strokes around the crosshair: white for a hit, amber for a headshot, and larger and red for an elimination, with the damage dealt underneath. An elimination also shows a banner with the player's name, headshot, weapon and distance, and bumps the kill count; every elimination in the room goes in the kill feed at the top right. Damage taken shows a red arc around the crosshair pointing at the attacker, computed from the shot's origin and the camera's screen-right vector, alongside the existing red vignette.

## Measurements

A scripted headless Chrome session played through the real game while recording the master bus. It walked to the first pickup, fired, reloaded and sprinted, then switched weapons and dry-fired. A test opponent then walked across, reloaded, fired near misses and hit the player before being shot and killed with a headshot. Peaks from that recording:

| Sound | Peak |
|---|---|
| Own pistol shot, own rifle burst | −3 dBFS |
| Loudest moment (pistol headshot with elimination confirmation) | −1.5 dBFS |
| Hit tick or headshot ring on its own | −9 dBFS |
| Own reload, magazine and slide | −10 to −14 dBFS |
| Own sprint footsteps | −16 dBFS |
| Own walking footsteps | −20 dBFS |
| Other player walking about 9 m away | −24 dBFS |

The ambience was recorded the same way, five seconds standing at each spot, with nothing else making a sound:

| Where | Peak | RMS |
|---|---|---|
| West alley, away from everything | −23 dBFS | −37 dBFS |
| Under an air conditioner | −25 dBFS | −37 dBFS |
| Outside the bar's front window | −26 dBFS | −40 dBFS |
| Inside the bar | −13.5 dBFS | −30 dBFS |

Voices, one sound at a time:

| Voice | Peak |
|---|---|
| Own line, English placeholder | −11 dBFS |
| Own jump grunt | −16 dBFS |
| Own death cry | −14.5 dBFS |
| Another player's line 4 m away, and 15 m away | −10, −22 dBFS |
| Another player's pain cry 4 m away | −12 dBFS |

At first other players' lines peaked at −6.4 dBFS 4 m away, near a gunshot, and the player's own at −9; both came down 3 dB.

Everywhere it stays below the player's own walking footsteps, and the bar's music below a reload; at first the music peaked at −5 dBFS inside the bar, as loud as a reload, and passing cars as loud as footsteps, so both came down.

A pistol shot placed 10 m to the screen-right measured 4.6 dB louder in the right channel, and one to the left 4.7 dB louder in the left. Headless checks measure levels, timing and direction, not taste; the mix should still be judged by ear on headphones and laptop speakers.

## Limits

- Snapshots carry only the latest combat event, so when shots arrive faster than snapshots, some of another player's shots can go unheard, as their tracers can go unseen.
- Sound does not travel with a delay over distance, and there is no voice chat. The ambience and the bar's music are made in code; there are no recorded crowd or street sounds.
- The English lines are text-to-speech placeholders and the Hindi lines silent until recorded, as are the meme lines until their clips are added. One male voice serves every player whatever their language.
- Lines a player says when they alone know the moment, such as running dry, are heard only by them. A peer that joins mid-way, or whose own state differs for a moment, can occasionally pick a different line or skip one the others hear.
- Other players' weapon switches are silent, and remote reloads start when the leader's snapshot arrives.
- The reload motion is procedural; the view models still have no authored reload clip.
