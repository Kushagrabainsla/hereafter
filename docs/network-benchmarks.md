# Multiplayer network benchmarks

Measurements of a six-player room before and after each step that makes the network traffic leaner. Every stage runs the same scripted match, so the numbers can be compared stage by stage.

## How it is measured

Six windows of a headless Chrome on one Apple M4 MacBook Air join one room on the build under test, at 640 × 360 on the WebGL renderer, one at a time as each finishes loading. (Headless Chrome on this machine could not start more than two or three WebGPU devices at once; the network code is the same on either renderer.) A fresh browser is started for every run, and each stage runs three times; the tables give the median of the three.

Every player runs a 1.6 m circle of its own in the market alley, in sight of the others. Two phases follow:

- **Moving:** 10 s of everyone running.
- **Firefight:** 20 s of everyone running and firing a carbine every 160 ms, reloading when empty, with six spare magazines each.

From step 4 on, two more phases measure quiet moments: **idle**, 10 s of everyone standing still on their marks before they start running, and **lull**, 10 s of everyone standing still after the firefight, among the props it knocked about.

Each player records:

| Measure | What it is | From |
|---|---|---|
| Up and down KB/s | Bytes on the wire, all data channels, including Trystero's framing, SCTP and DTLS | WebRTC `getStats()` transport counters |
| Position delay | Time from a peer sending its position to this player using it, on the same machine clock | the viewer's `setRemotePose` |
| Position gap | Time between two positions arriving from the same peer; 50 ms when nothing is lost or held up | the same |
| Shot confirm | For players who are not the host: time from sending an attack to playing the shot the host made of it, matched exactly (see the correction below) | the attack's sequence number, the host's record of the shot each attack made, the viewer's `playEvent` |
| Network CPU | Main-thread time per second in Trystero and `src/network/`, including everything their messages trigger | Chrome CPU profile, 1 ms sampling |
| FPS | Frames drawn per second | `requestAnimationFrame` |

The script is kept with the session's scratch files (`bench.mjs`, `bench-run.sh`, `bench-summary.mjs`); the game itself carries no benchmark code. It reaches the game through two temporary hooks that are removed before each commit.

## Limits

- All six players share one machine and one GPU, so each draws only 10 to 15 frames a second and its main thread is busy. Delays and shot confirmation are far longer than six separate computers would see. Compare stages with each other, not with a real match.
- The players talk over the machine's own network, which loses no packets. What a lost packet costs on real Wi-Fi, and so the main gain of step 1, cannot be measured here without changing the machine's network settings.
- Other applications ran on the machine during the runs, which adds noise; that is why each stage runs three times. From step 3 on, a stage also runs side by side with the one before: each from its own copy of the code on its own server, alternating run by run, three runs each, so both see the same conditions.

## Results

Medians of three runs. Delays and gaps are in milliseconds; p50 is the typical value, p95 the value only one in twenty exceeds. Host up is what the host uploads; player figures are the median of the five other players.

### Moving (10 s, everyone running)

| Build | Host up KB/s | Player up KB/s | Player down KB/s | Position delay p50 / p95 | Position gap p95 / max | Network CPU host / player ms/s | FPS |
|---|---|---|---|---|---|---|---|
| Baseline | 39 | 38 | 38 | 1 / 6 | 59 / 580 | 12.4 / 14.2 | 10 |
| 1. Positions lane | 30 | 29 | 29 | 1 / 5 | 59 / 676 | 4.5 / 4.9 | 11 |
| 2. Compact positions | 10 | 9 | 9 | 1 / 6 | 59 / 654 | 3.5 / 3.6 | 11 |
| 3. Only what changed | 10 | 9 | 9 | 1 / 4 | 58 / 300 | 1.9 / 2.4 | 14 |
| 4. Less when quiet (side by side with 3) | 9 | 9 | 9 | 1 / 3 | 58 / 105 | 2.3 / 2.5 | 14 |

### Firefight (20 s, everyone running and firing carbines)

| Build | Host up KB/s | Player up KB/s | Player down KB/s | Position delay p50 / p95 | Position gap p95 / max | Shot confirm p50 / p95 | Network CPU host / player ms/s | FPS |
|---|---|---|---|---|---|---|---|---|
| Baseline | 109 | 27 | 41 | 3 / 331 | 412 / 955 | * | 12.7 / 10.8 | 10 |
| 1. Positions lane | 100 | 19 | 34 | 8 / 284 | 362 / 956 | * | 10.9 / 8.2 | 11 |
| 2. Compact positions | 103 | 7 | 25 | 6 / 273 | 370 / 767 | * | 11.2 / 6.9 | 11 |
| 3. Only what changed | 39 | 7 | 12 | 3 / 204 | 277 / 568 | * | 6.9 / 5.2 | 14 |
| 4. Less when quiet (side by side with 3) | 47 | 7 | 14 | 3 / 225 | 302 / 682 | * | 9.4 / 5.9 | 13 |

### Standing still (from step 4, each side by side with step 3)

| Phase and build | Host up KB/s | Player up KB/s | Player down KB/s | Positions each player sends a second | Host's prop updates KB/s | Network CPU host / player ms/s |
|---|---|---|---|---|---|---|
| Idle, step 3 | 9.8 | 8.9 | 9.1 | 96 | 0.43 | 2.5 / 2.2 |
| Idle, step 4 | 1.8 | 1.9 | 1.9 | 18 | 0 | 0.5 / 0.7 |
| Lull after the fight, step 3 | 10.0 | 9.1 | 9.3 | 99 | 0.45 | 3.3 / 2.4 |
| Lull after the fight, step 4 | 1.8 | 1.8 | 1.9 | 19 | 0 | 1.0 / 0.7 |

\* *Invalid; see the correction below.*

**Correction: shot confirmation.** Until the final comparison, the benchmark paired each attack a player sent with the next shot of theirs it played, in order. The host refuses some attacks, such as those from a gun that has just run dry, which the shooter's copy of the match learns of only a moment later. Every refusal shifted the pairing by one, and the list of attacks waiting to be paired held eight, 1.28 s of firing. The 1.3 to 1.6 s it reported at every stage was mostly that, not delay, so those figures are struck out above. The final comparison matches each attack exactly: the shooter records its sequence number and when it sent it, the host records which shot each accepted attack made, and the shooter records when it played that shot. Nothing else in the tables was affected.

### What each stage changed

**Baseline.** Every message (positions, shots, the host's updates) travels on one reliable, ordered channel per pair of players. Positions are sent as text, about 238 bytes each, 20 times a second to every other player, which alone makes about 38 KB/s each way per player. In the firefight, players upload *less* (27 KB/s): a position waits while the channel is busy with shots, and the next one is skipped, so other players see each player less often just when it matters. One position in twenty then arrives more than 400 ms after the one before.

**1. A lane of its own for positions.** Positions now travel on a second data channel beside Trystero's, opened by both players with the same id: unordered, and never resent. A lost position holds nothing up, and the next one replaces it 50 ms later. If the lane is backed up, a position is skipped rather than queued. Positions also skip Trystero's own framing, so each player uploads a quarter less while moving (38 to 29 KB/s), and handling network messages takes a third of the time it did (about 13 to under 5 ms of main thread each second). In the firefight, position gaps and delays shrink a little (the slowest one in twenty: 412 to 362 ms between positions, 331 to 284 ms in transit). The firefight is limited mostly by six copies of the game sharing one processor, and lost packets, which this step is mainly for, do not happen on one machine.

The step also fixed a bug the benchmark exposed. A player's position was rejected when it lay further from the last accepted one than they could have run in at most half a second. After a stall of a second or more, such as a bad moment on Wi-Fi, every later position failed that test, and the player froze on everyone's screen until they respawned. The check now times the run by the sender's own clock and, after more than 1.5 s without a position, takes the next one as it is.

The lane's statistics show what limits the firefight: there, the host sends 26 to 47 positions a second instead of 100, because deciding shots and drawing leave its main thread too little time for the timer that sends them.

**2. Compact positions.** A position on the lane is now 25 bytes of numbers instead of about 238 bytes of text: position and jump height to the centimetre, heading, pitch and lean to the hundredth, and five movement flags packed into one byte. A round trip between two players came back exact to those units. Each player now uploads 9 KB/s while moving, against 29 after step 1 and 38 at the start, and 7 KB/s in the firefight. Handling network messages drops again, to about 3.5 ms a second. Delays and gaps are unchanged, as expected: the bytes were never what held positions up on one machine. The host still uploads about 100 KB/s in the firefight. That is now almost all its updates to the other players, which step 3 addresses.

**3. Only what has changed.** After the first update, the host's updates carry only what has changed since the one before. Before, every update carried every player whole, about 230 bytes each, and the shot at full precision. Now an update after a shot carries the shooter's rounds in that gun (about 35 bytes), the health of whatever the round damaged, and the shot itself. Its numbers go to four decimal places, a tenth of a millimetre in a position, which makes a shot 462 bytes instead of 684. A player who joins, or asks to catch up, still gets the whole state once, and so does everyone when a new host takes over. In the firefight the host uploads 39 KB/s instead of 103, and each player downloads 12 KB/s instead of 25. Handling network messages takes 6.9 ms of the host's main thread each second instead of 11.2.

These three runs had a quieter machine than the earlier stages: load averages of 2 to 5, against 5 to 10, and the frame rate rose in the moving phase too, where this step changes nothing. To separate the step from the load, steps 2 and 3 then ran again side by side, each from its own copy of the code, alternating run by run, three runs each (medians):

| Firefight, side by side | Host up KB/s | Player down KB/s | Host updates KB/s | Position delay p50 / p95 | Position gap p95 / max | Shot confirm p50 / p95 | FPS |
|---|---|---|---|---|---|---|---|
| 2. Compact positions | 104 | 26 | 91 | 4 / 214 | 297 / 654 | * | 14 |
| 3. Only what changed | 40 | 13 | 28 | 2 / 213 | 294 / 681 | * | 14 |

("Host updates" counts only what the host's updates carry, before any framing.) Under the same conditions, the traffic falls as before and the timings do not move: on one machine, with no packet loss and bandwidth to spare, the bytes were never what held shots up. The gain is for real connections, where a host's upload is shared with everything else in the house and 100 KB/s of reliable, ordered traffic queues behind any lost packet.

A separate check ran three players, then a fourth who joined mid-fight, then had the host leave so another took over. It fired carbines, threw a grenade and opened a door, and after each stage compared every player's copy of the match with the host's: players, damaged objects, pickups, grenades, drops and doors all agreed, and no page reported an error.

**4. Less when little is happening.** A player standing still used to send the same position 20 times a second to every other player. Now they send it every quarter second, often enough that the host, which ignores positions over 1.5 s old, never counts them gone. Standing on the ground, the height above it wavers by a centimetre from frame to frame, so a change under 1.5 cm counts as none. When they move again, the position they held goes out first, stamped at the moment before, so others see them set off at that moment rather than glide from where they stood a quarter second earlier. The host's hit checks rewind through the same positions, so a player who has just set off is hit where the shooter saw them. A check with two players confirmed all three: 3.8 positions a second while standing, never more than 0.29 s between them at the host, and the held position sent 46 ms before the first step.

The host also used to resend every prop that had been knocked out of place every two seconds, for players who had just joined. Now it sends those that moved since it last did, and everything only after someone joins.

Standing still, each player now uploads 1.9 KB/s instead of 8.9 and sends 18 positions a second instead of 96, and the prop updates stop, in the quiet before a fight and in the lull after it. Handling network messages drops to under 1 ms a second. Running and fighting are unchanged, as they should be: the moving rows match step 3. In the firefight the host uploaded 47 KB/s against 37, but more shots got through in these runs: 221 to 275 of the other players' shots, against 178 to 246. The host's update bytes per shot overlap (0.11 to 0.15 KB against 0.10 to 0.15), and nothing this step changes is sent while players move. The same check as for step 3, with a late joiner and a host leaving, found every player's copy of the match in agreement with the host's.

**5. Choosing the host.** The host used to be whoever had the lowest of the random player ids, so a player who joined mid-match with a lower id took the role over, and a host whose computer struggled stayed host. Now the room keeps its host until it leaves, whoever joins, and every two seconds each player reports how long its game keeps an arriving message waiting and its round trip to every other player. The host hands the role to the best player when the typical player would answer clearly faster, for six seconds running. [Multiplayer notes](multiplayer.md) give the rules and the measurements behind each.

A check with four players confirmed the parts that must not go wrong: a fourth player who joined with the lowest id of all did not take over; a host slowed to a quarter speed handed over, and the players' copies of the match agreed with the new host's; and when that host left, the next took over and they agreed again. A host slowed to a sixth of its speed hands over within about 14 seconds.

To measure what it buys, the host's processor was slowed to a sixth of its speed, as on a struggling laptop, and the players first fired into the ground for 20 s, as in a match's first fight. Medians of three runs each, side by side:

| Slowed host, firefight | Host role moved | Network work on the slow machine | Shot to host p50 / p95 | Host back to shooter p50 / p95 | Shot confirm p50 / p95 |
|---|---|---|---|---|---|
| 4. Less when quiet | in 0 of 3 runs | 56 ms a second | 71 / 376 | 94 / 387 | 240 / 585 |
| 5. Choosing the host | in 3 of 3 runs | 7.6 ms a second | 28 / 321 | 64 / 391 | 245 / 623 |

The role left the slow machine every time, which no longer resolves everyone's shots, and each leg of a shot got shorter. The whole round trip did not: on one overloaded computer the slowed player still shares the same processor with the others. In these runs the role also moved a second time during the measured fight. A host's own load rises in a fight, and on this machine one copy of the game sometimes stalled for over ten seconds; the twenty-second median is meant to ride out shorter stalls.

## Before and after

The original game against all five steps, side by side, three runs each. The machine was heavily loaded by other work during these runs, about 6 frames a second in each copy, so the timings are long for both; the traffic does not depend on that. These step 5 runs used an earlier form of the handover rule, which sends the same messages.

| Phase | Host up KB/s | Player up KB/s | Player down KB/s | Network CPU host / player ms/s |
|---|---|---|---|---|
| Idle, before | 38 | 36.5 | 36.6 | 15.4 / 11.7 |
| Idle, after | 2.3 | 1.9 | 1.8 | 2.9 / 2.7 |
| Moving, before | 39.6 | 39 | 39 | 9.5 / 9.1 |
| Moving, after | 9.9 | 9.3 | 9.3 | 5.9 / 5.9 |
| Firefight, before | 110.5 | 31.3 | 42.8 | 14.5 / 16 |
| Firefight, after | 16.5 | 8.3 | 11.8 | 14.9 / 15.5 |
| Lull, before | 39.3 | 38.7 | 38.8 | 10 / 11.9 |
| Lull, after | 2.4 | 2 | 1.9 | 2.1 / 2 |

The host uploads a seventh of what it did in a fight, and every player a quarter or less. Shot confirmation, now matched exactly, was 205 ms typically and 1.35 s at worst before, and 224 ms and 1.26 s after, under that load. With three players firing one round a second on a quiet machine, it was 13 and 182 ms typically in two runs of the original game, 49 and 201 ms after step 4, and 37 to 59 ms in three runs after step 5, with the slowest one in twenty between 0.2 and 0.35 s throughout. Shots are no slower for all the changes. On one machine, with no packet loss and bandwidth to spare, they could not get much faster: what the steps buy is room on real connections, where six players' traffic shares a household's upload and Wi-Fi drops packets.

## Connection layer

A second set of steps works on how players connect, and on what happens when the host goes. These steps are measured with probes of their own, each side by side with the build before it: each build from its own copy of the code on its own server, alternating run by run, with a fresh browser for every run.

### How it is measured

- **Host lost.** Three players join one room, each in a tab of a headless Chrome. Once all three hold the host's match, the host's tab crashes (Chrome's `Page.crash`), is closed (`Target.closeTarget`), or navigates to another page. The time is from that moment until each of the other two follows a new host and holds its match, or, for the new host, has sent it. The tables give the slower of the two; three runs each.
- **Host in the background.** The same three players, in a Chrome that slows background tabs as an ordinary one does. The host's tab is covered by another tab, so it runs its timers once a second and draws no frames. The probe times how long the host role takes to move to a player whose tab is in front, while the players fire one round a second.
- **Joining.** A second player opens an invite link to a room the first has open. The probe records, on the machine's shared clock, when the page opened, when the world finished loading, when each relay connection opened, the WebRTC connection's progress, and when the two first play together.
- **Six-player fight.** The benchmark above, two runs a build, to check that the new rules leave traffic alone and do not move the host in a fight.

### The original connection layer

Joining: the room opened only once the world had loaded, 5.9 s after the page opened on a quiet machine and 42 to 44 s on a busy one. Connecting then took 1.0 and 1.07 s on the quiet machine (2.2 to 3.3 s on the busy one): 0.14 s for the relay connections to open, three trips through the relays of about 0.2 s each, a 0.38 s stall while the new page drew its first frames, and 0.33 s for the WebRTC handshake. The game always used the same five of Trystero's 29 public relays, chosen by its app id; from here they took 186 to 283 ms to pass an event back, and one of them, relay.degmods.com, accepted connections but relayed nothing in that run. Other public relays answered in 14 to 120 ms.

| Host lost (three players) | Until the others play again |
|---|---|
| Its tab crashes | 11.8 to 13.1 s |
| Its tab is closed | 11.7 to 13.2 s |
| Its page navigates away | 0.01 to 0.02 s |
| Its tab goes to the background | the role moves after 14.3 to 16.4 s |

When a tab crashed, the browser reported the connection "disconnected" after 5 to 7.5 s, and Trystero waited 5 s more before giving the peer up. A closing tab fared no better, because it was gone before its goodbye got out. Navigating away worked, because the page lives long enough to say goodbye. A host whose tab went to the background kept the role until its slowness showed in its reports. Shots stayed fast meanwhile (6 to 7 ms typically), since a background tab still answers messages as they come; what stops is everything run on its own timers or frames, such as the props it simulates.

### 1. Noticing a lost host

Every player now notes when it last heard from each other player. Positions come at least four times a second, so a host unheard for 2 s, and still unheard at the next check a quarter of a second later, has gone: the player that notices names the next host and the others follow. A host whose tab goes to the background hands the role to a player whose tab is in front, and a closing tab goes to the background first, so a closing host hands over before it goes. A leaving page also says goodbye with one byte on each position lane, and the others drop it as soon as that arrives. [Multiplayer notes](multiplayer.md) give the rules.

| Host lost (three players) | Before | After |
|---|---|---|
| Its tab crashes | 12.06, 12.42, 12.41 s | 2.02, 2.08, 2.25 s |
| Its tab is closed | 13.12, 12.21, 13.15 s | 0.025, 0.201, 0.023 s |
| Its tab goes to the background (the role moves after) | 16.4 s; 15.2 to 15.4 s | 0.4 s; 0.3 s |

The crash runs of the final rule ran on their own; a first version without the second check, run side by side with the original, took 1.94 to 2.00 s, and the original's time is set by fixed waits in the browser and Trystero. A host frozen for 1.5 s kept the role, and one frozen for 3 s lost it, after which all three players, the old host among them, followed the new host and held the same players.

In the six-player benchmark the traffic did not change: each player sent 1.9 to 2.2 KB/s standing still and 9.2 to 9.4 KB/s running, in both builds. During the fights a player went at most 0.45 to 1.97 s without hearing the host, and most of each player's longest wait was its own page freezing; the host itself froze for at most 0.8 s in a fight. The new rule moved the role once in each of three runs, always outside the measured fight. In the run timed to the moment, the host's page froze for 3.6 s just after every player was given a carbine, most likely drawing six carbines for the first time on an overloaded machine, and the role moved 2.3 s into that freeze; the old host followed the new one when it recovered. Because the role moved just before the fight, the host upload figures of those runs belong to the wrong player and are left out. The original build kept its host through both of its runs.

A player who is not the host, gone from a three-player room, is dropped by the other two after (one run before, two after; where the two differed, both):

| How the player goes | Before | After |
|---|---|---|
| Leaves the room, the tab staying open | 0.17 s | 0.11 s; 0.11 s |
| Its tab is closed | 14.2 s | 0.02 and 0.36 s; 0.42 s |
| Its page is closed, running its unload handlers | 2.0 s | 0.004 s; 0.37 s |

Until it is dropped, its body stands where it was. The first version of this step closed the connections at once without a goodbye; that dropped a closed tab in 2.7 s, but cut off Trystero's own goodbye when a player left the room, which then took 0.5 to 1.2 s.

### 2. Connecting while the world loads

An invite link now joins its room as the page opens, so the relay messages and the WebRTC handshake happen while the world downloads and builds. A player still loading tells the others so: it cannot be chosen as host and takes no part in the match until its world is ready, and then it asks the host for the match.

On this machine one thing dominates loading: the first frame builds every shader before it draws, which held the page still for about 20 s, connections included. With the game's files already cached the world itself loads in under a second before that, so a page opened from a link connects after the shaders either way. After them, playing together took 1.6 to 2.1 s with step 1 and 1.1 to 1.2 s with step 2, which had connected to its relays and announced itself beforehand (three runs each, alternating, on the development server). Building the shaders off the page with three's `compileAsync` freed the page, but made loading four times slower here, so the game does not.

A friend opening the link for the first time downloads the game's 23 MB first, and the page is free while it does. Built as shipped, with the second player's browser held to a 25 Mbit/s connection with nothing cached, three runs each, alternating:

| First visit at 25 Mbit/s | Step 1 | Step 2 |
|---|---|---|
| Connected | 2.0 to 2.1 s after the world loaded | 26 to 43 s before |
| Playing together after the world loaded | 2.21, 2.14, 2.22 s | 0.39, 0.34, 0.41 s |
| Playing together after opening the link | 33.0, 31.8, 31.6 s | 46.4, 29.7, 29.6 s |

The 46 s run loaded slowly from the start. Six more runs, in the same conditions, opened a new room's link in two browsers at once, or in the second 3 s after the first had loaded and was alone. Every time both followed one host at epoch 1 with the same players, and a lone host kept the role while its friend loaded, including when the friend had the lower id, which under the old rule took the room over once it arrived. A host crash still took 2.1 s, and a six-player fight sent the same traffic as with step 1 (2.0 KB/s a player standing still, 9.3 running, 40.5 from the host in the fight) without the host moving.

### 3. Relays that work, and quickly

Players find each other through public Nostr relays, which pass the messages that set up a connection. Left to itself Trystero uses five of its 29 relays, picked by the game's id. Timed from here, publishing an event and receiving it back, three rounds each in four probes over two days: relay.routstr.com timed out or took 3.5 to 6 s in the last two, relay.degmods.com lost some or all of its messages in three of the four, and the other three took 135 to 285 ms. The game now names seven relays that passed every message in the three latest probes:

| Relay | Echo |
|---|---|
| relay.aarpia.com | 48 to 53 ms |
| cdn.satellite.earth | 78 to 86 ms |
| nostrcity-club.fly.dev | 77 to 129 ms |
| nostr.red5d.dev | 83 to 116 ms |
| relay.agentry.com | 111 to 131 ms |
| relay.hackshed.dev | 135 to 195 ms |
| relay.nostr.blockhenge.com | 195 to 196 ms |

Every message goes out on all of them, so the quickest carries it. These times are from California; a relay fast here may be slower elsewhere, which is one reason to keep seven.

Two players already in the game meeting by room code, the second typing the code once its first frames were past, four runs each, alternating:

| Room code to playing together | Step 2 | Step 3 |
|---|---|---|
| First relay connection open | 0.22 s | 0.03 to 0.04 s |
| First relay message back | 0.41 s | 0.05 to 0.10 s |
| Connected | 0.93 to 1.11 s | 0.25 to 0.31 s |
| Playing together | 1.13, 1.09, 0.96, 0.95 s | 0.26, 0.30, 0.32, 0.29 s |

A friend opening an invite link connects while the world loads, so there the gain is hidden behind loading.

### 4. Drawing other players closer to now

Each player now sends its position 30 times a second instead of 20, and draws every other player only as far behind that player's newest position as the connection needs: the time between its positions while it moves, plus how late nine in ten of its last 64 arrived beyond the quickest, between 40 and 150 ms. It was a fixed 100 ms. The delay changes at a tenth of real time, so nobody's motion jumps when it does.

To measure it, every player runs a circle of its own at a steady 4.8 m/s, moved every 16 ms as a function of the shared clock, so each viewer knows where each other player really is at every moment. Each viewer records, every frame, how far behind now it draws each other player, how far the drawn body is from where that player really is, and how often drawing runs past the newest position (extrapolating) or past the 100 ms limit on that (frozen). Three players, three runs each, alternating, and one run each with six players:

| | Step 3 | Step 4 |
|---|---|---|
| Three players: drawn behind now, typical / 1 in 20 | 109 to 110 / 117 to 119 ms | 47 / 52 to 55 ms |
| Three players: drawn body from the real one, typical / 1 in 20 | 53 to 54 / 58 to 59 cm | 24 to 25 / 28 to 31 cm |
| Three players: frames extrapolating / frozen | 0% / 0% | 0.2 to 0.3% / 0 to 0.07% |
| Three players: each player's upload | 3.8 to 4.1 KB/s | 5.7 to 6.0 KB/s |
| Six players (7 to 10 frames a second): drawn behind now | 115 / 125 ms | 48 / 56 ms |
| Six players: drawn body from the real one | 57 / 63 cm | 25 / 30 cm |
| Six players: frames extrapolating / frozen | 0% / 0% | 0.4% / 0% |
| Six players: each player's upload | 9.5 KB/s | 14.3 KB/s |

Other players are drawn about 60 ms nearer the present, which puts a running player about 30 cm nearer where they really are, and the shooter's aim is checked against that same moment. One step 4 run had a single frame 47 m out, where a player had briefly frozen. Running players send half as much again; standing still they send what they did before, four positions a second.
