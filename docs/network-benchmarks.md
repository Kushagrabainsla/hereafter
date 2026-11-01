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
| Shot confirm | For players who are not the host: time from sending an attack to playing its shot from the host's update | the viewer's `playEvent` |
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
| Baseline | 109 | 27 | 41 | 3 / 331 | 412 / 955 | 1629 / 4165 | 12.7 / 10.8 | 10 |
| 1. Positions lane | 100 | 19 | 34 | 8 / 284 | 362 / 956 | 1516 / 3266 | 10.9 / 8.2 | 11 |
| 2. Compact positions | 103 | 7 | 25 | 6 / 273 | 370 / 767 | 1492 / 4180 | 11.2 / 6.9 | 11 |
| 3. Only what changed | 39 | 7 | 12 | 3 / 204 | 277 / 568 | 1350 / 3680 | 6.9 / 5.2 | 14 |
| 4. Less when quiet (side by side with 3) | 47 | 7 | 14 | 3 / 225 | 302 / 682 | 1379 / 3285 | 9.4 / 5.9 | 13 |

### Standing still (from step 4, each side by side with step 3)

| Phase and build | Host up KB/s | Player up KB/s | Player down KB/s | Positions each player sends a second | Host's prop updates KB/s | Network CPU host / player ms/s |
|---|---|---|---|---|---|---|
| Idle, step 3 | 9.8 | 8.9 | 9.1 | 96 | 0.43 | 2.5 / 2.2 |
| Idle, step 4 | 1.8 | 1.9 | 1.9 | 18 | 0 | 0.5 / 0.7 |
| Lull after the fight, step 3 | 10.0 | 9.1 | 9.3 | 99 | 0.45 | 3.3 / 2.4 |
| Lull after the fight, step 4 | 1.8 | 1.8 | 1.9 | 19 | 0 | 1.0 / 0.7 |

### What each stage changed

**Baseline.** Every message (positions, shots, the host's updates) travels on one reliable, ordered channel per pair of players. Positions are sent as text, about 238 bytes each, 20 times a second to every other player, which alone makes about 38 KB/s each way per player. In the firefight, players upload *less* (27 KB/s): a position waits while the channel is busy with shots, and the next one is skipped, so other players see each player less often just when it matters. One position in twenty then arrives more than 400 ms after the one before.

**1. A lane of its own for positions.** Positions now travel on a second data channel beside Trystero's, opened by both players with the same id: unordered, and never resent. A lost position holds nothing up, and the next one replaces it 50 ms later. If the lane is backed up, a position is skipped rather than queued. Positions also skip Trystero's own framing, so each player uploads a quarter less while moving (38 to 29 KB/s), and handling network messages takes a third of the time it did (about 13 to under 5 ms of main thread each second). In the firefight, position gaps and delays shrink a little (the slowest one in twenty: 412 to 362 ms between positions, 331 to 284 ms in transit). Shot confirmation moves from 1.6 to 1.5 s typically and 4.2 to 3.3 s at worst. The firefight is limited mostly by six copies of the game sharing one processor, and lost packets, which this step is mainly for, do not happen on one machine.

The step also fixed a bug the benchmark exposed. A player's position was rejected when it lay further from the last accepted one than they could have run in at most half a second. After a stall of a second or more, such as a bad moment on Wi-Fi, every later position failed that test, and the player froze on everyone's screen until they respawned. The check now times the run by the sender's own clock and, after more than 1.5 s without a position, takes the next one as it is.

The lane's statistics show what limits the firefight: there, the host sends 26 to 47 positions a second instead of 100, because deciding shots and drawing leave its main thread too little time for the timer that sends them.

**2. Compact positions.** A position on the lane is now 25 bytes of numbers instead of about 238 bytes of text: position and jump height to the centimetre, heading, pitch and lean to the hundredth, and five movement flags packed into one byte. A round trip between two players came back exact to those units. Each player now uploads 9 KB/s while moving, against 29 after step 1 and 38 at the start, and 7 KB/s in the firefight. Handling network messages drops again, to about 3.5 ms a second. Delays and gaps are unchanged, as expected: the bytes were never what held positions up on one machine. The host still uploads about 100 KB/s in the firefight. That is now almost all its updates to the other players, which step 3 addresses.

**3. Only what has changed.** After the first update, the host's updates carry only what has changed since the one before. Before, every update carried every player whole, about 230 bytes each, and the shot at full precision. Now an update after a shot carries the shooter's rounds in that gun (about 35 bytes), the health of whatever the round damaged, and the shot itself. Its numbers go to four decimal places, a tenth of a millimetre in a position, which makes a shot 462 bytes instead of 684. A player who joins, or asks to catch up, still gets the whole state once, and so does everyone when a new host takes over. In the firefight the host uploads 39 KB/s instead of 103, and each player downloads 12 KB/s instead of 25. Handling network messages takes 6.9 ms of the host's main thread each second instead of 11.2.

These three runs had a quieter machine than the earlier stages: load averages of 2 to 5, against 5 to 10, and the frame rate rose in the moving phase too, where this step changes nothing. To separate the step from the load, steps 2 and 3 then ran again side by side, each from its own copy of the code, alternating run by run, three runs each (medians):

| Firefight, side by side | Host up KB/s | Player down KB/s | Host updates KB/s | Position delay p50 / p95 | Position gap p95 / max | Shot confirm p50 / p95 | FPS |
|---|---|---|---|---|---|---|---|
| 2. Compact positions | 104 | 26 | 91 | 4 / 214 | 297 / 654 | 1340 / 3693 | 14 |
| 3. Only what changed | 40 | 13 | 28 | 2 / 213 | 294 / 681 | 1357 / 3080 | 14 |

("Host updates" counts only what the host's updates carry, before any framing.) Under the same conditions, the traffic falls as before and the timings do not move: on one machine, with no packet loss and bandwidth to spare, the bytes were never what held shots up. The gain is for real connections, where a host's upload is shared with everything else in the house and 100 KB/s of reliable, ordered traffic queues behind any lost packet.

A separate check ran three players, then a fourth who joined mid-fight, then had the host leave so another took over. It fired carbines, threw a grenade and opened a door, and after each stage compared every player's copy of the match with the host's: players, damaged objects, pickups, grenades, drops and doors all agreed, and no page reported an error.

**4. Less when little is happening.** A player standing still used to send the same position 20 times a second to every other player. Now they send it every quarter second, often enough that the host, which ignores positions over 1.5 s old, never counts them gone. Standing on the ground, the height above it wavers by a centimetre from frame to frame, so a change under 1.5 cm counts as none. When they move again, the position they held goes out first, stamped at the moment before, so others see them set off at that moment rather than glide from where they stood a quarter second earlier. The host's hit checks rewind through the same positions, so a player who has just set off is hit where the shooter saw them. A check with two players confirmed all three: 3.8 positions a second while standing, never more than 0.29 s between them at the host, and the held position sent 46 ms before the first step.

The host also used to resend every prop that had been knocked out of place every two seconds, for players who had just joined. Now it sends those that moved since it last did, and everything only after someone joins.

Standing still, each player now uploads 1.9 KB/s instead of 8.9 and sends 18 positions a second instead of 96, and the prop updates stop, in the quiet before a fight and in the lull after it. Handling network messages drops to under 1 ms a second. Running and fighting are unchanged, as they should be: the moving rows match step 3. In the firefight the host uploaded 47 KB/s against 37, but these runs happened to fire more: 221 to 275 shots confirmed, against 178 to 246. The host's update bytes per confirmed shot overlap (0.11 to 0.15 KB against 0.10 to 0.15), and nothing this step changes is sent while players move. The same check as for step 3, with a late joiner and a host leaving, found every player's copy of the match in agreement with the host's.
