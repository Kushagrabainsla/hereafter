# Asset sources

Everything the game uses is bundled with the site; nothing is fetched from a third party while playing.

## Visual materials

The files in `public/textures/` are 1K diffuse and normal maps from [Poly Haven](https://polyhaven.com/), released under [CC0](https://polyhaven.com/license): [Asphalt 02](https://polyhaven.com/a/asphalt_02), [Concrete Pavement 02](https://polyhaven.com/a/concrete_pavement_02), [Plastered Wall 04](https://polyhaven.com/a/plastered_wall_04), [Concrete Wall 003](https://polyhaven.com/a/concrete_wall_003) and [Brick Wall 001](https://polyhaven.com/a/brick_wall_001).

`storefront-stone.jpg` and `storefront-cafe.jpg` were generated with the built-in imagegen tool for this project. Their prompts requested flat, front-facing, photo-real downtown California storefront textures: one with a stone base and recessed glass entry, the other a dark green cafe with a warm interior. Both prompts excluded people, text, logos, signs, and perspective distortion. They are the shop interiors seen behind the market's shopfront glass.

The dusk sky, the sign faces, the window interiors, the posters, the mural, the awning stripes, the wood grain and the kitchen tiles are drawn in code when the map loads.

## First-person view models

`public/models/knife.glb`, `pistol.glb` and `rifle.glb` are built by `scripts/viewmodels/build.py` (see [rendering notes](rendering.md)) from these sources. The sources are downloaded by `scripts/viewmodels/fetch.sh` into the ignored `assets-src/` folder; only the built GLBs are committed.

| Asset | Used for | Author | Source | License |
|---|---|---|---|---|
| Arms, gloves and wristwatch of the avatar `Military_Male_03` | arms in all three files | Microsoft, [Microsoft Rocketbox Avatar Library](https://github.com/microsoft/Microsoft-Rocketbox) (commit `0943055`) | `Assets/Avatars/Professions/Military_Male_03` | [MIT](https://github.com/microsoft/Microsoft-Rocketbox/blob/master/LICENSE.md) (notice below) |
| [Fish Knife](https://polyhaven.com/a/fish_knife) | field knife | Mateusz Sadek | Poly Haven, 1K glTF | [CC0](https://polyhaven.com/license) |
| [Service Pistol](https://polyhaven.com/a/service_pistol) | pistol | Mateusz Sadek | Poly Haven, 1K glTF, wooden-grip variant with the empty magazine seated | [CC0](https://polyhaven.com/license) |
| [AKM](https://opengameart.org/content/akm) | carbine | LonesomeDucky | OpenGameArt.org, `akm54.blend` | [CC0](https://creativecommons.org/publicdomain/zero/1.0/) |
| Whole avatar `Military_Male_03` and the clips `m_idle_neutral_01`, `m_walk_neutral`, `m_run_neutral`, `m_crouch_idle` from the Rocketbox animation library | `public/models/player.glb`, the third-person character | Microsoft, [Microsoft Rocketbox Avatar Library](https://github.com/microsoft/Microsoft-Rocketbox) (commit `0943055`) | `Assets/Avatars/Professions/Military_Male_03`, `Assets/Animations` | [MIT](https://github.com/microsoft/Microsoft-Rocketbox/blob/master/LICENSE.md) (notice below) |

The Rocketbox body mesh is cut to the faces weighted to the arm bones, the sleeve insignia (a flag, a name tape and unit patches) are painted over with neighbouring fabric, and the two arm islands of the 2K body atlas are repacked into one 1K WebP texture set (colour, normal and a roughness map derived from the specular map). The watch keeps a crop of the equipment atlas. The AKM's 4K textures are reduced to 1K and its ambient-occlusion map is dropped. The third-person character (`scripts/viewmodels/build_player.py`) is the same avatar decimated to about 8,000 triangles with its face bones and holstered pistol removed, its body atlas at 1K (insignia painted over) and head, helmet and equipment at 512 px; the Rocketbox clips are retargeted onto it and a death fall is generated. No asset is fetched at runtime.

## Sound effects

The 69 MP3 files in `public/audio/` (420 KB in total) are cut, peak-normalised and encoded by `scripts/audio/build.sh` from the sources below, which `scripts/audio/fetch.sh` downloads into the ignored `assets-src/audio/` folder. `npm run build:audio` runs both and needs ffmpeg with libmp3lame. Every source is CC0, so no attribution is required; the authors are credited here anyway. No sound is fetched from a third party at runtime. See [audio notes](audio.md) for how they are mixed.

| Sounds | Source | Author | License |
|---|---|---|---|
| Pistol and carbine gunshots, near and mid-distance takes (`pistol-*`, `rifle-*`) | [The Free Firearm Sound Library](https://opengameart.org/content/the-free-firearm-sound-library), prepared edition: Walther PPQ 9 mm (`X_39P`, `X_31P`) and AK-47 (`C_28P`, `C_31P`), 96 kHz recordings | Ben Jaszczak, Brian Nelson, Kevin Heras and Matthew Nanney | [CC0](https://creativecommons.org/publicdomain/zero/1.0/) |
| Pistol and rifle reloads (`reload-pistol`, `reload-rifle`) | [Gun Reload Sounds](https://opengameart.org/content/gun-reload-sounds), `gunreload1.wav` and `assaultriflereload1.wav` | SpringySpringo | [CC0](https://creativecommons.org/publicdomain/zero/1.0/) |
| Magazine seat on pickup (`mag-in`) | [Gun Reload Sound Effects](https://opengameart.org/content/gun-reload-sound-effects), `clipload1.wav` | Brian MacIntosh (BMacZero) | [CC0](https://creativecommons.org/publicdomain/zero/1.0/) |
| Footsteps on concrete and grass, landings, body hits, hurt and bullet impacts (`step-*`, `land-*`, `body-hit-*`, `hurt-*`, `bullet-impact-*`) | [Impact Sounds](https://kenney.nl/assets/impact-sounds) 1.0: `footstep_concrete`, `footstep_grass`, `impactSoft_heavy`, `impactPunch_medium`, `impactPunch_heavy`, `impactMining` | Kenney | [CC0](https://creativecommons.org/publicdomain/zero/1.0/) |
| Material impacts and breakage: metal, wood, glass, soft (`impact-metal-*`, `impact-wood-*`, `impact-glass-*`, `impact-soft-*`, `glass-break-*`, `wood-break-*`) | [Impact Sounds](https://kenney.nl/assets/impact-sounds) 1.0: `impactMetal_light`, `impactWood_light`, `impactGlass_light`, `impactSoft_medium`, `impactGlass_heavy`, `impactWood_heavy` | Kenney | [CC0](https://creativecommons.org/publicdomain/zero/1.0/) |
| Weapon handling: dry fire, ready click, knife draw, cloth, grabs, knife cut (`dry-fire`, `latch`, `draw-knife-*`, `cloth-*`, `grab-*`, `knife-hit-*`) | [RPG Audio](https://kenney.nl/assets/rpg-audio): `metalClick`, `metalLatch`, `drawKnife`, `cloth`, `handleSmallLeather`, `knifeSlice` | Kenney | [CC0](https://creativecommons.org/publicdomain/zero/1.0/) |

The gunshot takes start 3 ms before each detected onset and keep a short tail; the mid-distance takes keep their street echo and, for the AK-47, the supersonic crack that arrives ahead of the report. The pistol reload loses two silent gaps to fit the 1.2 s reload, and the rifle reload gains 0.12 s to fit 1.7 s. The hit tick, headshot ring, elimination confirmation, knife swing, near-miss crack and the low thump under shots are synthesised in the browser.

## Props

`public/models/props/*.glb` and `props.json` are built by `scripts/props/build.sh` (run by `npm run build:props`) from Poly Haven models downloaded by `scripts/props/fetch.sh`, which pins every source file by MD5. The build keeps the clean variant where a source has two, seats the trash can lid, removes the air-conditioner's hanging pipe, simplifies each mesh, resizes textures to 512 px WebP and centres each model with its base at y = 0. All are CC0 1.0 under the [Poly Haven license](https://polyhaven.com/license).

| Prop | Author | Source |
|---|---|---|
| Wooden crate | James Ray Cock | [Wooden Crate 01](https://polyhaven.com/a/wooden_crate_01) |
| Large wooden crate | Prabhjinder Singh | [Wooden Military Crate](https://polyhaven.com/a/wooden_military_crate) |
| Trash can | GurJas Studios | [Metal Trash Can](https://polyhaven.com/a/metal_trash_can) |
| Oil drum | Serhii Khromov | [Barrel 03](https://polyhaven.com/a/barrel_03) |
| Cardboard box | Rahul Chaudhary | [Cardboard Box 01](https://polyhaven.com/a/cardboard_box_01) |
| Air-conditioning unit | Monsta3D | [Exterior Aircon Unit](https://polyhaven.com/a/exterior_aircon_unit) |
| Plastic crate | Fabi_G | [Plastic Crate 02](https://polyhaven.com/a/plastic_crate_02) |

### Microsoft Rocketbox: MIT License

Copyright (c) 2020 Microsoft

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
