# Checkpoint: AAA gap work, paused 2026-11-18

Read this first in a new session. It says what is done, what is left, how the work is done and what went wrong before. The working tree was clean at the pause; every change is on `main` and live.

## The task

The user asked to work through GitHub issue 2 of `Kushagrabainsla/hereafter` ("AAA gap audit", 66 items), in its order. In the middle of that, they asked for a pass on objects that look fake: "either remove them or upgrade their shaders and make them interactable". They then asked for three fixes first (aim, real voices, shop music). Those are done.

## Rules for every item

1. Reproduce the problem in the running game before you change anything.
2. Show that the fix works in the running game.
3. A look change needs two blind juries, one in each order (A/B swapped). Ship only a change that wins in both orders.
4. Measure a feel change, and keep its tuning in one table (a named constant object).
5. Frame rate: lose no more than 3 FPS against the live build. Never lower the render resolution.
6. If a packet or a validity rule changes, increase `PROTOCOL_VERSION` (`src/network/peerRoom.ts`, now 33) and add a line to `docs/multiplayer.md`.
7. Commit each item alone, push to `main`, wait for the Pages deploy, check the live bundle, and tick the issue checkbox (issue items only).
8. Do not commit `.claude/`, `resume.md` or `docs/PHOTO_PROPS_HANDOFF.md`. Remove every `TEMP-TEST` line before a commit. Update the docs when behaviour changes.
9. Report to the user in simple, precise words (ASD-STE100), with before and after pictures. Keep test figures out of the chat unless they matter.
10. Continue without asking for approval (standing approval). Ask only for choices that are truly the user's, and before downloading files.
11. Never use text-to-speech for any voice line, Hindi or English. Record CC0 sources in `docs/data-sources.md`. Do not redo or propose the issue's "already good" or "rejected" ideas.

Shell rules (global CLAUDE.md): no `cd` in a compound command, no `;` `&&` `||`, one command per Bash call, no inline scripts (write the script to a file first), absolute paths, `git -C`, `npm --prefix`.

## Done in the 2026-11-18 session (all live)

| Commit | Change |
|---|---|
| 2dece83 | Stalls: real shelf goods (tins, cups, jars, boxes), a cloth valance on each awning; the chalk board and card awning tongues removed; the OPEN sign shows only its neon tubes |
| a06cf86 | Fuel drums dull and dented; plastic crates faded with cut-out slots; folding tables have steel tops and are thin steel in physics (protocol 33) |
| 843cdda | Paving: each slab's own shade is evened out (`PAVING` in `nightMarket.ts`) |
| f7feba5 | Far puddles keep their edges: the rain smear of reflections is kept only on water (`WATER_EDGE` in `mapViewer.ts`) |
| ad39edd | Mural and posters weather like real paint and paper (`sprayed` and `pasted` kinds, `POSTED` in `surfaces.ts`) |
| f61e072 | Paper lanterns glow as if lit by a bulb inside (`LANTERN` in `nightMarket.ts`) |
| 8139c2a | Meter and valve labels are faded enamel |
| f3d7326, 3da1cf0 | Aiming: large iron sights on the centre, fitted by measurement (`SIGHTS` in `authoredViewModel.ts`). The user rejected a red dot: they want standard AAA iron sights |
| ba4e986 | Voices: 13 English lines are a real actor (Kenney Voiceover Pack, CC0, male; `STOCK_EN` in `scripts/audio/voices.py`). All other lines are silent until the user records them. The game picks only recorded lines |
| ee8a197 | Every shop plays its own recorded music (CC0 or US public domain; `scripts/audio/music.sh`, `SHOP_MUSIC` in `mapViewer.ts`) |

Rejected in blind tests this session (do not retry the same way): faded, dusty cement sacks lost in both orders.

## What is left

**Fake objects pass** (from a picture review of the whole map), next in this order: shopfronts, food truck windows, the bar shelf, food, restaurant tiles, sign boxes, washers, back doors. Most small props already move with real physics. The dumpsters stay fixed: they are cover with a pickup on top, so moving them is the user's call.

**Issue 2:** 30 of 66 items are ticked. F2 is half done (lamp shadows still open). H1 (gunshots) was skipped by the user. Open: B5, B8, B9, B11, B13, C3, C4, C5, C6, D3, D4, D5, D6, D7, D8, E1, E2, E3, F2, F5, F6, F7, F8, G1, G2, G3, G4, G5, G6, H4, H5, H6, H7, I3, I5.

**Waiting on the user:** recordings of the 33 English and all Hindi voice lines (`docs/voice-lines.md`).

## How the testing works

The test kit is in `.claude/testkit/` in the main checkout. It is not in git, so a session in a separate worktree must read it from `/Users/kushagrabainsls/Desktop/projects/hereafter/.claude/testkit/`.

- Headless Chrome runs on CDP port 9312 (WebGPU on). Do not touch the user's Chrome on port 9235. After hours a second tab can hang on load: restart Chrome, do not hunt for a bug.
- The dev server runs on port 5173. `sh .claude/testkit/addhooks.sh <root>` adds the `window.__test` and `window.__internals` hooks; `prep.sh` removes every `TEMP-TEST` line, typechecks and builds `dist/`.
- Pictures: `play/shots-at.mjs <label> <dusk|day> name:east,north,heading,pitch[,feet] ...`, `play/tour.mjs` for the whole map, `play/sheet.mjs` and `play/cropsheet.mjs` for contact sheets. Shots go to the session scratchpad.
- Juries: `play/jury.mjs` (whole pictures) or `play/jurycrop.mjs` (crops). Run two subagents, one per order. Ask each to describe A and B first and to answer "tie" when it cannot point to a difference: one jury picked "B" every time in both orders, which is position bias, not a result.
- Frame rate: `play/fps.mjs` (live against local, after the commit) and `play/fps-at.mjs` (two local builds at one place: baseline in `dist-base/` on port 4174 via `setbase.sh`, new build in `dist/` on port 4173, both with hooks). To isolate a model change, copy the old `.glb` into `dist-base/models/`.
- Ship: `prep.sh`, commit with `-F <message file>`, `fps.mjs`, push, `waitdeploy.sh <marker>` (checks the live bundle), `tick.sh <ID>` for issue items, then `addhooks.sh` again.
- Other probes: `play/aimshot.mjs` and `play/sightprobe.mjs` (sights), `play/voicepick.mjs` (needs a temporary `window.__voices` hook), `play/shopmusic.mjs` and `play/shopcount.mjs` (shop music), `play/table.mjs`, `play/matprobe.mjs`, `play/pick.mjs`.
- Blender builds the kit (`sh scripts/kit/build.sh`) and the asset families (`FAMILY=<name> sh scripts/assets/build.sh`).

## Pitfalls found this session

- In TSL, `materialColor` is a vec4: take `.xyz` before `dot()`, or the alpha adds 1 to a luminance sum.
- `texture(map)` in TSL ignores the texture's repeat (`updateMatrix` is false). Pass the UV yourself, scaled by `map.repeat`.
- Kit pieces in the game are not always centred on their Blender origin: take shape terms from normals, not heights (the lanterns).
- A scanned prop with BLEND alpha is skipped by the prop weather shader; make it a cut-out (`CUTOUT` in `props.ts`).
- Plain kit materials merge into `kit:merged`: match both names when you hide one (the OPEN sign backing).
- The gun's `back` offset also moves its sights: fit height, side and back together, averaging 12 samples (the gun sways).
- In a `while read` loop, ffmpeg needs `-nostdin` or it eats the loop's input.
- Headless Chrome has no audio context until a real click: send a CDP mouse press before audio tests.
- The loader downloads everything under `audio/` before a match; streamed folders go in `CHOSEN_FILES` (`src/maps.ts`).
