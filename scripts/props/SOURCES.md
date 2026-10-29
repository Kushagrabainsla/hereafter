# Street prop sources

All props are Poly Haven models released under CC0 1.0 (https://polyhaven.com/license). Rebuild with
`sh scripts/props/fetch.sh && sh scripts/props/build.sh`; the outputs are `public/models/props/*.glb` and
`public/models/props/props.json`.

| Asset (built file) | Author | Source | License |
| --- | --- | --- | --- |
| Wooden Crate 01 (`crate_wood.glb`) | James Ray Cock | https://polyhaven.com/a/wooden_crate_01 | CC0 1.0 |
| Wooden Military Crate (`crate_wood_large.glb`) | Prabhjinder Singh | https://polyhaven.com/a/wooden_military_crate | CC0 1.0 |
| Metal Trash Can (`trash_can.glb`) | GurJas Studios | https://polyhaven.com/a/metal_trash_can | CC0 1.0 |
| Barrel 03 (`oil_drum.glb`) | Serhii Khromov | https://polyhaven.com/a/barrel_03 | CC0 1.0 |
| Cardboard Box 01 (`cardboard_box.glb`) | Rahul Chaudhary | https://polyhaven.com/a/cardboard_box_01 | CC0 1.0 |
| Exterior Aircon Unit (`aircon_unit.glb`) | Monsta3D | https://polyhaven.com/a/exterior_aircon_unit | CC0 1.0 |
| Plastic Crate 02 (`plastic_crate.glb`) | Fabi_G | https://polyhaven.com/a/plastic_crate_02 | CC0 1.0 |

Changes made by the build: the clean variant is kept where the source has two (trash can, aircon unit); the
trash can lid is seated on the can; the aircon's hanging condensate pipe is removed; meshes are simplified,
textures resized to 512 px and converted to WebP; each model is centred on x/z with its base at y = 0.
