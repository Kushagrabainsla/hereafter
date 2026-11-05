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
- **Materials are flat colours**, no textures, with metalness and roughness. Three prefixes mean something:
  - `glow_*`: lamp glass, neon tubes and lit faces. The game draws them with its own lit material and dims or darkens them when the lamp is shot out.
  - `paint_*`: pale, and tinted per copy by the game, like door colours and awning stripes.
  - Everything else is plain. The game merges all of a piece's plain parts into one mesh whose vertices carry each part's colour, roughness and metalness, so a piece draws in a single call however many materials it was made with.
- **Budgets and sizes** are checked on every build. A piece over its triangle budget, more than 10% (or 2 cm) off its declared size, off its declared origin, or using an unregistered material fails the build, and nothing is written.

## In the game

`src/world/kit.ts` loads `market-kit.glb` and every family file (`KIT_FILES`) with the meshopt decoder. `kitPieces()` unpacks the compressed positions to floats, merges plain parts, and keeps `glow_*` and `paint_*` parts apart. Pieces are then used in one of three ways:

- **Many still copies:** `KitPlacer.place(name, matrix)`, drawn as one instanced mesh per piece and part. `splitGlow()` separates a lamp's glass, and the market's `lampSet()` draws the glass once per lamp with a per-copy flag that lights or darkens it. No second, hidden copy is drawn.
- **Copies that move each frame:** `instancedParts()`, as with the swaying lanterns. Whole and torn lanterns are packed into their own meshes each frame, so only those showing are drawn.
- **One-offs:** `kitObject()`, as for signs, the breaker box and lamps that hide with their stall.

Physics, cover and breakage do not change when a code shape becomes a model. Colliders, entities and lamp hit boxes are still declared in `src/world/nightMarket.ts`, so a model only changes what is drawn.

## Signs

Every sign's text, look, colours and size live in `src/world/signs.json`. The signs family builds one piece per entry (`sign_<id>`), and the game places it and lights it at the entry's intensity. `neon` signs are glass tubes along the letters' outlines and a rounded border on a dark backer. `lightbox` signs are steel boxes with a lit face and raised letters. `blade` signs are double-sided neon boxes on wall brackets. To add or change a sign, edit the JSON, place it in `nightMarket.ts` with `sign(id, x, y, z, face)`, and rebuild the family. The lettering uses Bebas Neue (SIL Open Font License); the food truck's roof sign and menu board use it too.

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

## Phases

Each phase replaces one group of shapes drawn in code with modelled pieces, measured as above.

1. **Lights and signs (done):** paper lanterns and their torn versions, string-light bulbs and cables, overhead power lines, the service alley's barn lamps, the restaurant's and record shop's pendants, the stalls' caged lamps, the pool-table lamp, the breaker box, all 19 signs, and the food truck's roof sign and menu board.
2. **Furniture and interiors (done):** the restaurant's tables and bentwood chairs, its pass counter and pantry shelves with jars, tins, sacks and bowls; the bar's counter and brass foot rail, leather stools, mirrored back bar and bottles, pool table and the sofa upstairs; the record shop's counter; the market alley's folding tables and plastic stools. The tables, counters, pool table and sofa keep their solid boxes as colliders (`furnish()` in `nightMarket.ts` draws the piece in their place).
3. **Street dressing (done):** the service alley's dumpsters (lids, casters, stencilling and rust), the stacked pallets and the manhole cover; the cedar water tanks on their steel stands and the TV antennas on the roofs, each antenna stretched to its mast's height; the eight posters and the SOFA mural. The dumpsters keep their solid boxes as colliders.
4. **Weapons and items in the world:** pickup stands, spare and dropped magazines, spent cases, frag and smoke grenades. The stand-in guns, hands and players drawn only when a model fails to load are removed.
5. **Buildings and ground:** walls with depth, cornices, parapets, windows, shopfronts, shutters, shop glass, railings, ladders and stairs, paving, kerbs and floors. This needs the light bake redone (`npm run build:lightmaps`).
6. **Effects:** debris, bullet holes, the muzzle flash, the code-drawn textures (awning stripes, planks, tiles) and the pickup markers. Tracers, smoke, steam, fire and haze stay particle effects.
