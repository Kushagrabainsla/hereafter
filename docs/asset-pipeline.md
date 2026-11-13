# Asset pipeline

Everything you can see in the Night Market should be a modelled object, not a shape drawn in code. The asset pipeline builds those objects in Blender from short Python recipes, checks them against budgets, previews them, compresses them and hands them to the game, which places them by name. It grew out of the scripts that already built the wall kit, the food truck and the view models, and shares their modelling library.

```
recipe (scripts/assets/families/*.py)
  -> Blender, headless: build every piece, smooth, check     (scripts/assets/build.py)
  -> report (scripts/assets/reports/<family>.json) and preview sheet
  -> public/models/<family>.glb, compressed with meshopt     (scripts/assets/build.sh)
  -> the game loads every family with the kit and places pieces by name   (src/world/kit.ts)
```

## Commands

| Command | What it does |
|---|---|
| `npm run build:assets` | Build, check and compress every family |
| `FAMILY=lights npm run build:assets` | One family |
| `PREVIEW=/some/dir npm run build:assets` | Also render a sheet of close-ups per family, `<dir>/<family>.png`, and one image per piece |
| `blender -b --python-exit-code 1 --python scripts/assets/build.py -- --family lights --only lantern --no-export --preview /tmp/p` | Try one piece without writing anything |
| `npm run build:textures` | Bake the wood floor and kitchen tile textures from Blender node materials (`scripts/assets/textures.py`) |
| `npm run build:kit`, `npm run build:truck` | The older wall kit and food truck builds; the kit now uses the same library and compression |

You need Blender 4.4 or newer (`blender` on the PATH, in `/Applications`, or `BLENDER=`), and Node for the compression step, which runs the pinned `@gltf-transform/cli@4.5.1` through `npx`. `scripts/assets/fetch.sh` downloads the sign font into the ignored `assets-src/fonts/`; the build runs it when the font is missing.

## Writing a recipe

A family is one Python module in `scripts/assets/families/`. It defines `materials()`, which registers its materials, and `PIECES`, a list of `Piece`s:

```python
from lib import Piece, cylinder, join, lathe, material

def materials():
    material("enamel_cream", 0xe8e0cc, 0.1, 0.3)       # name, colour, metalness, roughness
    material("glow_bulb", 0xfff2d8, 0.0, 0.2)          # glow_*: the game lights it

def pendant():
    shade = lathe("shade", [(0.16, -0.11), (0.11, -0.04), (0.035, 0.1)], "enamel_cream", verts=24)
    bulb = lathe("glass", [(0.012, 0.06), (0.04, -0.01), (0.0, -0.055)], "glow_bulb", verts=10)
    return join([shade, bulb], "pendant")

PIECES = [Piece("pendant", pendant, budget=1100, size=(0.33, 0.33, 1.24), origin=None, notes="Restaurant pendants")]
```

Model in metres with Z up. The exporter turns that into the game's Y up: Blender's -Y becomes three.js +Z, the way a piece faces out of its wall.

`scripts/assets/lib.py` holds the shared helpers: `box`, `turned_box`, `cylinder`, `sphere`, `tube` (a tube along a polyline), `ring`, `arc`, `prism` (an extruded profile), `hull` (the convex hull of some points, for tapered and sloped shapes), `lathe` (a turned shape, optionally ribbed), `cut` (a boolean), `join`, `move`, `smooth`, `mirror_x`, `text_mesh` (letters as solid or flat shapes, as neon tubes along their outlines, or fattened by an offset for a painted outline), `fit` (narrows text to a width), `paint` (a single flat face, for paint and decals on a wall), `ellipse` and `clip` (outlines, cut to a rectangle), `rounded_rect`, `jitter` and `tear` (for crumpled or torn versions), and `triangles`.

## Rules the game relies on

- **One piece, one top-level object**, built at the origin and named after the piece. Names are unique across every family and the wall kit, since the game merges them all into one table.
- **Origins** are where the game places a piece: on the floor (`base`), hanging from its top (`top`), at its middle (`center`), or backing onto a wall at y = 0 and built toward -Y (`wall`). Wall pieces are placed with `wallMatrix(face, at, along, y)` in `src/world/facades.ts`.
- **Materials are flat colours**, no textures, with metalness and roughness. The game layers wear over them by kind (see Layered surfaces), so name a material for what it is made of (`wood`, `steel`, `paint`, `stone`, `rust`, `fabric` and so on). Four prefixes mean something:
  - `glow_*`: lamp glass, neon tubes and lit faces. The game draws them with its own lit material and dims or darkens them when the lamp is shot out.
  - `paint_*`: pale, and tinted per copy by the game, like door colours and awning stripes.
  - `card_*`: a flat face that keeps texture coordinates from 0 to 1, for the game to draw its own picture or glass on: the rooms behind windows, the storefront photographs and shop glass. Only meshes with a card material carry texture coordinates in the file, and the game flips them to its own pictures' orientation (glTF counts rows from the top).
  - `sign_*`: sign backers and frames, kept clean.
  - Everything else is plain. The game merges all of a piece's plain parts into one mesh whose vertices carry each part's colour, roughness and metalness, so a piece draws in a single call however many materials it was made with.
- **Budgets and sizes** are checked on every build. A piece over its triangle budget, more than 10% (or 2 cm) off its declared size, off its declared origin, or using an unregistered material fails the build, and nothing is written.

## In the game

`src/world/kit.ts` loads `market-kit.glb` and every family file (`KIT_FILES`) with the meshopt decoder. `kitPieces()` unpacks the compressed positions to floats, merges plain parts, and keeps `glow_*` and `paint_*` parts apart. Pieces are then used in one of three ways:

- **Many still copies:** `KitPlacer.place(name, matrix)`, drawn as one instanced mesh per piece and part. A placement may stretch a piece: mouldings, rails and stringers are modelled 1 m long and stretched to fit (`wallMatrix`'s last argument stretches along the wall). `splitGlow()` separates a lamp's glass, and the market's `lampSet()` draws the glass once per lamp with a per-copy flag that lights or darkens it. No second, hidden copy is drawn.
- **Copies that move each frame:** `instancedParts()`, as with the swaying lanterns. Whole and torn lanterns are packed into their own meshes each frame, so only those showing are drawn.
- **One-offs:** `kitObject()`, as for signs, the breaker box and lamps that hide with their stall, and for things that come and go during play: the gun stands, magazines and thrown grenades.

Instanced meshes whose copies come and go (debris, bullet holes, spent cases) always draw at least one copy, shrunk to nothing, so their shaders are built while the map loads rather than at the first shot. The viewer hands the loaded pieces to the code that draws items as well as to the map: `WeaponVisuals` (gun stands), `LootViews` and `Ejecta` (magazines and spent cases, the cases packed into one instanced mesh per calibre each frame) and `WorldEffects` (grenades, debris and bullet holes).

Physics, cover and breakage do not change when a code shape becomes a model. Colliders, entities and lamp hit boxes are still declared in `src/world/nightMarket.ts`, so a model only changes what is drawn.

## Layered surfaces

The models keep flat colours in their files, but the game does not draw them flat. `src/world/surfaces.ts` gives every material a kind from its name (painted, stone, wood, bare metal, rusted, fabric and paper, or plain) and builds the surface in layers per pixel: colour variation, paint worn through in small chips near the bottom (grey primer at the edge, dark old material in the middle), rust that grows from the bottom, wood grain, dust on faces that point up, grime near the ground and in rain streaks, roughness that changes with all of these, and a little relief from bump mapping. The patterns follow each piece's own position, so no texture coordinates are needed and moving parts such as doors carry their pattern. Merged plain parts carry their kind per vertex in the `surface` attribute (roughness, metalness, kind); kept-apart materials get a layered copy; the food truck layers its parts the same way. Lamp glass, neon, cards and signs stay clean.

The noise comes from one 64³ block that repeats in every direction, made once at load (`src/world/noiseVolume.ts`) and read three times per pixel. Working out the noise per pixel instead cost about 30% of the frame rate on a 2x screen; the block costs about 2 FPS. To change how a kind weathers, edit its row in `KINDS`; to change which materials are which kind, edit `surfaceKind()`.

**Edge wear.** Wear follows each piece's shape. When the kit and the food truck load, `src/world/edges.ts` looks at every triangle's three sides. If the triangle across a side lies flat with it (within 20°), the side is only a face's diagonal. Otherwise the side is an outside edge (the neighbour turns away) or an inside corner (it turns toward this face); a side with no neighbour counts as outside. Two vertex attributes carry the distance in metres to each side that counts, which the graphics card interpolates exactly across the triangle, so the shader knows how far every pixel is from the nearest outside edge and the nearest inside corner. Within about 3 cm of an outside edge, in stretches broken up by noise and more often low down, paint rubs through to primer and, right at the edge, to bare polished steel, and bare metal, stone and wood wear paler and smoother. Within about 5 cm of an inside corner dirt gathers, darker and duller. Edges between separate parts that only touch (a panel laid on a body) are not found, since the two share no side. The geometry is split into separate triangles for this, which costs memory but no draw calls. A blind judge preferred the market with edge wear at 9 spots of 18 and at none without it, and scored surfaces 4 against 3. The first try polished the very edge to bare steel: it caught the sky and drew silver outlines round every dumpster rim, and lost; the wear now only dulls and darkens, and fades out where a pixel spans more than about a centimetre. It costs about 4% of the frame rate (2% to 7% across runs on a busy machine).

**Wet surfaces.** The pieces take the rain as Saltline's surfaces do. What faces up stays wet, runs of water follow the grime streaks down the sides, and a band below about 45 cm is splashed. Broad patches stay drier, and nothing indoors is wet. A wet surface darkens by how porous it is (stone 45%, fabric 50%, wood 40%, paint 12%, bare metal 10%) and turns glossy, but in broken beads and drier spots, not one even sheen: an even sheen read as plastic across a whole dumpster lid in a blind test. Smudges vary the gloss of dry metal and paint too. Tops facing the sky fade paler and greyer than the sides, in patches, a little more higher up a piece, and painted pieces carry more grime. Paint chips now gather in a few worn zones with ragged outlines, where they used to sprinkle evenly along the bottom of every panel (a row of polka dots along the food truck's skirt), and rust has a grainy edge drawn out up and down, so it runs in streaks rather than sitting as round, sticker-like patches. A blind judge preferred this at 6 spots of 18 and at none without it (surfaces 4 against 3), at about 1% of the frame rate.

**Rain streaks.** The streaks come from a picture that the graphics card draws once at load, in about 50 ms (`src/world/wearTextures.ts`), after the way Saltline (a Fable 5.2 game) draws all its textures from code. The method is written from scratch here. The 1.6 m picture holds a broad grime film with fine and broad runs washed down by the rain, and paler runs where the rain ran clean. It is periodic value noise whose frequencies are whole numbers, so it repeats without seams. Each piece reads it from three sides in its own coordinates, blended by which way the surface faces. The same method also drew paint chips, rust patches, halos and runs, wood grain and relief, in place of the noise block. Those lost two blind tests: the chips read as decals scattered over flat panels (a polka-dot food truck), and the wood grain was weaker. With only the streaks added, a third blind test preferred the market at 4 spots of 18 and the rest were the same; the surface score rose from 3 to 3.5. The streaks cost no measurable frame rate at 2560 × 1440 at 2×.

## Signs

Every sign's text, look, colours and size live in `src/world/signs.json`. The signs family builds one piece per entry (`sign_<id>`), and the game places it and lights it at the entry's intensity. `neon` signs are glass tubes along the letters' outlines and a rounded border on a dark backer. `lightbox` signs are steel boxes with a lit face and raised letters. `blade` signs are double-sided neon boxes on wall brackets. To add or change a sign, edit the JSON, place it in `nightMarket.ts` with `sign(id, x, y, z, face)`, and rebuild the family. The lettering uses Bebas Neue (SIL Open Font License); the food truck's roof sign and menu board use it too.

## Baked textures

The floors and tiles that were painted on a canvas in code are now node materials in Blender, baked to a colour map and an OpenGL normal map 1024 px square (`scripts/assets/textures.py`, `npm run build:textures`): oak floorboards, 14 across a 2 m tile, a metre long and staggered by half, with grain and wear; and white subway tiles 20 by 10 cm in grey grout. They tile seamlessly: every pattern repeats a whole number of times across the tile, noise runs round a torus in 4D so it meets itself at the edges, and each board's shade comes from its row and place within the tile, so a board cut by the edge matches on both sides. The game loads them with the other surface textures (`src/world/surfaceTextures.ts`).

## Posters

Every paper poster's wall, place, lines and colours live in `src/world/posters.json`. The street family builds one piece per entry (`poster_<id>`): a sheet of paper with a little thickness, taped at three corners, the fourth peeling off the wall, a slight tilt, and its lines in Bebas Neue over an accent disc. The game places every entry on its wall itself, so adding a poster is an edit to the JSON and a rebuild of the family. The mural is one piece of flat paint layers a couple of millimetres apart: the ground, four blobs, the word with its outline and offset line, spray mist and drips.

## Performance

Every phase is measured against the release it replaces, at fixed camera spots, in alternating runs, since the machine's load swings frame rates between runs. The budget for a phase is at most 10% more draw calls, 15% more triangles and no more than 3 FPS lost. A model that breaks it is simplified or left out.

Phase 1 (lamps and signs), production builds in headless Chrome on an Apple M4, two alternating rounds at ten spots:

| | Before | After |
|---|---|---|
| Frame rate, mean of the ten spots | 43.3 FPS | 43.4 FPS |
| Draw calls, market alley | 512 | 405 |
| Draw calls, other spots | 143 to 428 | 116 to 327 (20 to 23% fewer) |
| Triangles, market alley | 541,000 | 587,000 (+8.5%) |
| Triangles, other spots | +7% to +15% | |
| `market-kit.glb` | 1.83 MB | 0.65 MB (meshopt) |

Merging plain parts cut a fifth of the draw calls everywhere, the wall kit's included. The extra triangles are the lanterns, signs and lamps. The neon tubes were first six-sided at full curve detail, which put 48,000 triangles into the signs; four-sided tubes at lower detail brought that to 29,500 with no visible difference past arm's length.

Phase 2 (furniture and interiors), at ten spots in the restaurant, the bar, upstairs, the record shop and the market alley. Both builds held the display's 60 FPS cap on a quiet machine, so frame rate could not separate them; draw calls and triangles are exact:

| Spot | Draw calls | Triangles |
|---|---|---|
| Restaurant, under the pendants | 186 to 191 | 454,906 to 488,136 (+7.3%) |
| Restaurant, along the pass | 314 to 319 | 557,342 to 590,908 (+6.0%) |
| Kitchen shelves | 108 to 114 | 419,536 to 453,438 (+8.1%) |
| Bar, along the counter | 148 to 151 | 381,006 to 389,210 (+2.2%) |
| Pool table | 155 to 158 | 452,274 to 459,298 (+1.6%) |
| Market alley tables | 295 to 299 | 545,040 to 578,234 (+6.1%) |
| Record shop counter | 167 to 173 | 467,930 to 477,490 (+2.0%) |

Sixteen pieces, 12,400 triangles in all and 159 KB compressed; each draws in one call however many copies stand about, except the backlit bottles' glass.

Phase 3 (street dressing), at eight spots in the service alley, the market alley and on the roofs. Frame rates matched within the machine's swings; draw calls and triangles are exact:

| Spot | Draw calls | Triangles |
|---|---|---|
| Service alley, dumpsters | 179 to 178 | 480,024 to 498,858 (+3.9%) |
| Pallets and mural | 97 to 96 | 340,872 to 361,387 (+6.0%) |
| Service alley, south posters | 232 to 231 | 525,680 to 545,319 (+3.7%) |
| Market alley poster | 123 to 123 | 461,354 to 473,150 (+2.6%) |
| Manhole | 245 to 245 | 524,416 to 545,805 (+4.1%) |
| Over the rooftops | 137 to 138 | 433,406 to 461,017 (+6.4%) |
| Beside a water tank | 84 to 84 | 334,648 to 345,716 (+3.3%) |

Fourteen pieces, 12,700 triangles in all and 159 KB compressed. The five water tanks are most of it (2,120 triangles each); every copy of a piece draws in the one call.

Phase 4 (items in the world), at five spots, including a frag and a smoke grenade, ten spent cases and two dropped magazines lying under the market's lanterns. Each magazine, grenade and stand was several meshes and is now one:

| Spot | Draw calls | Triangles |
|---|---|---|
| Carbine stand | 289 to 276 | 576,950 to 578,558 (+0.3%) |
| Pistol stand | 96 to 95 | 363,040 to 360,924 (-0.6%) |
| Magazines on the floor | 123 to 118 | 492,258 to 489,738 (-0.5%) |
| Magazines on a table | 137 to 132 | 510,416 to 507,896 (-0.5%) |
| Grenades, cases and dropped magazines | 139 to 132 | 490,076 to 490,685 (+0.1%) |

Seven pieces, 3,700 triangles in all and 62 KB compressed.

Phase 5 (building dressing), at eight spots on both alleys, at the shopfronts, the fire escape, the bar's balcony and its stair. Most of the added triangles are the 247 window units, 196 triangles each against 62 for the boxes they replace, all drawn in one call:

| Spot | Draw calls | Triangles |
|---|---|---|
| Market alley, west facade | 156 to 156 | 508,378 to 547,712 (+7.7%) |
| Service alley facades | 141 to 141 | 461,068 to 505,202 (+9.6%) |
| North passage shutter | 86 to 85 | 334,998 to 371,952 (+11.0%) |
| Fire escape | 146 to 146 | 498,192 to 537,526 (+7.9%) |
| Bar balcony and ladder | 153 to 153 | 472,518 to 516,652 (+9.3%) |
| Bar stair | 137 to 137 | 403,505 to 446,379 (+10.6%) |
| Noodle bar shopfront | 96 to 95 | 389,058 to 426,012 (+9.5%) |
| Restaurant glass | 141 to 141 | 473,770 to 513,104 (+8.3%) |

Fourteen pieces, 1,300 triangles in all and 39 KB compressed. Frame rates were compared at a MacBook Pro's Retina size (1728 × 1117 at 2×) with production builds in two alternating rounds over six of the spots: the median was 43 FPS before and 43.5 after, and the means 42.8 and 40.1, pulled down by a few one-off stalls in both builds (one before, three after).

Phase 6 (effects and the last code shapes), at six spots: bullet holes on a wall, a burst of debris, a magazine pickup, a gun stand, the kitchen and the bar's floor. Debris and holes used to draw every unused copy shrunk to nothing; now each shape's mesh holds only the pieces about, so the counts fell:

| Spot | Draw calls | Triangles |
|---|---|---|
| Bullet holes on a wall | 281 to 280 | 635,077 to 632,171 (-0.5%) |
| Debris burst | 303 to 304 | 651,634 to 647,826 (-0.6%) |
| Magazines on a table | 132 to 130 | 547,230 to 540,106 (-1.3%) |
| Carbine stand | 277 to 275 | 617,904 to 608,296 (-1.6%) |
| Kitchen | 120 to 118 | 501,016 to 496,080 (-1.0%) |
| Bar floor | 120 to 118 | 439,913 to 428,501 (-2.6%) |

Eight effect pieces (578 triangles, 18 KB), the kitchen's counter and range (1,456 triangles) and the fire escape's walkway (228). The first burst of debris after loading took no longer a frame than the screen did standing still.

The shops (`scripts/assets/families/shops.py`): the counters, the boba shop's fridge, the tea house's counter, the laundry's washer, what stands on the cooking lines, the menus and the food a player takes. Sixteen pieces, 18,000 triangles in all and 208 KB compressed. Measured at a MacBook Pro's Retina size (1728 × 1117 at 2×) with production builds in three alternating rounds over eight spots on both alleys, against the release before, on a busy machine:

| | Before | After |
|---|---|---|
| Frame rate, mean of the eight spots | 45.1 FPS | 43.6 FPS |
| Triangles | | +3.1% to +6.4% |
| Draw calls | 173 to 405 | +5% to +23% (9 to 56 more) |

Draw calls are over the 10% budget at most spots. Most of them are the new door leaves, shop glass, food and wall colours, and the frame rate is inside its 3 FPS budget, so they stay. Toggling parts of the shops within one session showed where the frames went: two real lights per shop cost 2 to 3 FPS, because a light costs every pixel it reaches, through walls as well, while the glass cost about 1 FPS and the furniture nothing measurable. Each shop now has one light of 5.5 m range between its two pendants. The shops' furniture is placed apart from the same chairs and shelves elsewhere, since one instanced mesh is drawn whole whenever any copy of it is in view, which had drawn about 36,000 more triangles of the restaurant's furniture in views of the alley.

## Phases

Each phase replaces one group of shapes drawn in code with modelled pieces, measured as above.

1. **Lights and signs (done):** paper lanterns and their torn versions, string-light bulbs and cables, overhead power lines, the service alley's barn lamps, the restaurant's and record shop's pendants, the stalls' caged lamps, the pool-table lamp, the breaker box, all 19 signs, and the food truck's roof sign and menu board.
2. **Furniture and interiors (done):** the restaurant's tables and bentwood chairs, its pass counter and pantry shelves with jars, tins, sacks and bowls; the bar's counter and brass foot rail, leather stools, mirrored back bar and bottles, pool table and the sofa upstairs; the record shop's counter; the market alley's folding tables and plastic stools. The tables, counters, pool table and sofa keep their solid boxes as colliders (`furnish()` in `nightMarket.ts` draws the piece in their place).
3. **Street dressing (done):** the service alley's dumpsters (lids, casters, stencilling and rust), the stacked pallets and the manhole cover; the cedar water tanks on their steel stands and the TV antennas on the roofs, each antenna stretched to its mast's height; the eight posters and the SOFA mural. The dumpsters keep their solid boxes as colliders.
4. **Weapons and items in the world (done):** the gun stands with their glowing ring, the spare and dropped magazines (the pistol's double stack and the carbine's curved steel magazine, each with its top round showing), spent 9 mm brass and 7.62 mm lacquered steel cases, and the frag and smoke grenades. The stand-in guns, hands and players drawn while a model loaded, or when one failed, are gone: a missing model now leaves its slot empty. The pickup markers (rings and beams) wait for phase 6.
5. **Buildings (done):** window units with their glass on cards, cornices and string courses, roller shutters, shopfront pilasters and ledges round the storefront photographs, railings, the steel ladders and the bar's open-tread stair with stringers, and the shop glass. The walls and the ground stay the map's own flat surfaces with photographed textures and baked light: a modelled wall would be the same flat face. The light bake was redone.
6. **Effects (done):** debris as modelled chips, splinters, glass shards, leaves and spark streaks; bullet holes and blast scorches as modelled craters; the pickup markers' rings and beams; the wood floors and kitchen tiles baked in Blender in place of the canvas drawings (the awning stripes were already unused). The last plain boxes, the kitchen's steel counters and range and the market fire escape's walkway, became modelled modules. The first-person muzzle flash is part of the view models, modelled already. Tracers, smoke, steam, fire and haze stay particle effects.
