# Multiplayer network benchmarks

Measurements of a six-player room before and after each step that makes the network traffic leaner. Every stage runs the same scripted match, so the numbers can be compared stage by stage.

## How it is measured

Six windows of a headless Chrome on one Apple M4 MacBook Air join one room on the build under test, at 640 × 360 on the WebGL renderer, one at a time as each finishes loading. (Headless Chrome on this machine could not start more than two or three WebGPU devices at once; the network code is the same on either renderer.) A fresh browser is started for every run, and each stage runs three times; the tables give the median of the three.

Every player runs a 1.6 m circle of its own in the market alley, in sight of the others. Two phases follow:

- **Moving:** 10 s of everyone running.
- **Firefight:** 20 s of everyone running and firing a carbine every 160 ms, reloading when empty, with six spare magazines each.

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
- Other applications ran on the machine during the runs, which adds noise; that is why each stage runs three times.

## Results

Medians of three runs. Delays and gaps are in milliseconds; p50 is the typical value, p95 the value only one in twenty exceeds. Host up is what the host uploads; player figures are the median of the five other players.

### Moving (10 s, everyone running)

| Build | Host up KB/s | Player up KB/s | Player down KB/s | Position delay p50 / p95 | Position gap p95 / max | Network CPU host / player ms/s | FPS |
|---|---|---|---|---|---|---|---|
| Baseline | 39 | 38 | 38 | 1 / 6 | 59 / 580 | 12.4 / 14.2 | 10 |
| 1. Positions lane | 30 | 29 | 29 | 1 / 5 | 59 / 676 | 4.5 / 4.9 | 11 |
| 2. Compact positions | 10 | 9 | 9 | 1 / 6 | 59 / 654 | 3.5 / 3.6 | 11 |
| 3. Only what changed | 10 | 9 | 9 | 1 / 4 | 58 / 300 | 1.9 / 2.4 | 14 |

### Firefight (20 s, everyone running and firing carbines)

| Build | Host up KB/s | Player up KB/s | Player down KB/s | Position delay p50 / p95 | Position gap p95 / max | Shot confirm p50 / p95 | Network CPU host / player ms/s | FPS |
|---|---|---|---|---|---|---|---|---|
| Baseline | 109 | 27 | 41 | 3 / 331 | 412 / 955 | 1629 / 4165 | 12.7 / 10.8 | 10 |
| 1. Positions lane | 100 | 19 | 34 | 8 / 284 | 362 / 956 | 1516 / 3266 | 10.9 / 8.2 | 11 |
| 2. Compact positions | 103 | 7 | 25 | 6 / 273 | 370 / 767 | 1492 / 4180 | 11.2 / 6.9 | 11 |
| 3. Only what changed | 39 | 7 | 12 | 3 / 204 | 277 / 568 | 1350 / 3680 | 6.9 / 5.2 | 14 |

### What each stage changed

**Baseline.** Every message (positions, shots, the host's updates) travels on one reliable, ordered channel per pair of players. Positions are sent as text, about 238 bytes each, 20 times a second to every other player, which alone makes about 38 KB/s each way per player. In the firefight, players upload *less* (27 KB/s): a position waits while the channel is busy with shots, and the next one is skipped, so other players see each player less often just when it matters. One position in twenty then arrives more than 400 ms after the one before.

**1. A lane of its own for positions.** Positions now travel on a second data channel beside Trystero's, opened by both players with the same id: unordered, and never resent. A lost position holds nothing up, and the next one replaces it 50 ms later. If the lane is backed up, a position is skipped rather than queued. Positions also skip Trystero's own framing, so each player uploads a quarter less while moving (38 to 29 KB/s), and handling network messages takes a third of the time it did (about 13 to under 5 ms of main thread each second). In the firefight, position gaps and delays shrink a little (the slowest one in twenty: 412 to 362 ms between positions, 331 to 284 ms in transit). Shot confirmation moves from 1.6 to 1.5 s typically and 4.2 to 3.3 s at worst. The firefight is limited mostly by six copies of the game sharing one processor, and lost packets, which this step is mainly for, do not happen on one machine.

The step also fixed a bug the benchmark exposed. A player's position was rejected when it lay further from the last accepted one than they could have run in at most half a second. After a stall of a second or more, such as a bad moment on Wi-Fi, every later position failed that test, and the player froze on everyone's screen until they respawned. The check now times the run by the sender's own clock and, after more than 1.5 s without a position, takes the next one as it is.

The lane's statistics show what limits the firefight: there, the host sends 26 to 47 positions a second instead of 100, because deciding shots and drawing leave its main thread too little time for the timer that sends them.

**2. Compact positions.** A position on the lane is now 25 bytes of numbers instead of about 238 bytes of text: position and jump height to the centimetre, heading, pitch and lean to the hundredth, and five movement flags packed into one byte. A round trip between two players came back exact to those units. Each player now uploads 9 KB/s while moving, against 29 after step 1 and 38 at the start, and 7 KB/s in the firefight. Handling network messages drops again, to about 3.5 ms a second. Delays and gaps are unchanged, as expected: the bytes were never what held positions up on one machine. The host still uploads about 100 KB/s in the firefight. That is now almost all its updates to the other players, which step 3 addresses.

**3. Only what has changed.** After the first update, the host's updates carry only what has changed since the one before. Before, every update carried every player whole, about 230 bytes each, and the shot at full precision. Now an update after a shot carries the shooter's rounds in that gun (about 35 bytes), the health of whatever the round damaged, and the shot itself. Its numbers go to four decimal places, a tenth of a millimetre in a position, which makes a shot 462 bytes instead of 684. A player who joins, or asks to catch up, still gets the whole state once, and so does everyone when a new host takes over. In the firefight the host uploads 39 KB/s instead of 103, and each player downloads 12 KB/s instead of 25. Handling network messages takes 6.9 ms of the host's main thread each second instead of 11.2.

These three runs had a quieter machine than the earlier stages: load averages of 2 to 5, against 5 to 10. So the higher frame rate, which rose in the moving phase too where this step changes nothing, and part of the shorter delays come from that. The traffic figures do not depend on the load.

A separate check ran three players, then a fourth who joined mid-fight, then had the host leave so another took over. It fired carbines, threw a grenade and opened a door, and after each stage compared every player's copy of the match with the host's: players, damaged objects, pickups, grenades, drops and doors all agreed, and no page reported an error.
