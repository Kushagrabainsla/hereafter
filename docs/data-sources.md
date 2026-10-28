# San Jose pilot data

The full source asset at `public/arena/san-jose.json` is derived from:

- [OpenStreetMap API bounding-box extract](https://wiki.openstreetmap.org/wiki/API_v0.6#Retrieving_map_data_by_bounding_box), centered at 37.3378, −121.8897 and covering approximately 700 × 700 m. Building outlines and tagged heights or levels, roads, parks, and tagged trees are converted into local meter coordinates. Missing building heights use an explicitly approximate fallback.
- [USGS Elevation Point Query Service](https://www.usgs.gov/the-national-map-data-delivery/gis-data-download) on a 5 × 5 grid. The service interpolates ground elevations from [3DEP](https://www.usgs.gov/3d-elevation-program). These heights are sampled at build time, then bundled.

OpenStreetMap data and derived geometry are licensed under [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Credit: © OpenStreetMap contributors. The bundled JSON preserves source IDs and the source URL. It can be downloaded directly from the public site or repository as the adapted database. USGS 3DEP data is public domain.

The generation script uses the raw OpenStreetMap data API once per rebuild. It does not bulk-download OpenStreetMap's community-hosted rendered map tiles. The runtime uses only the bundled derived asset. The source geographic data can be updated independently of the rendering and game code.

`scripts/build-block.mjs` filters the source extract to the default 140 m playable square plus a 65 m visual buffer. It produces `public/arena/san-jose-block.json` without another network request. The default game loads this compact file; supported custom arena URLs use the full source extract.

## Visual materials

Most files in `public/textures/` are 1K diffuse and selected normal or alpha maps from [Poly Haven](https://polyhaven.com/), released under [CC0](https://polyhaven.com/license). They are served from this repository, with no runtime API calls. Source assets: [Asphalt 02](https://polyhaven.com/a/asphalt_02), [Concrete Pavement 02](https://polyhaven.com/a/concrete_pavement_02), [Grass Ground](https://polyhaven.com/a/grass_ground), [Plastered Wall 04](https://polyhaven.com/a/plastered_wall_04), [Concrete Wall 003](https://polyhaven.com/a/concrete_wall_003), [Brick Wall 001](https://polyhaven.com/a/brick_wall_001), [Grey Roof Tiles](https://polyhaven.com/a/grey_roof_tiles), [Bark Platanus](https://polyhaven.com/a/bark_platanus), [Tree Small 02](https://polyhaven.com/a/tree_small_02) leaf maps, and the 1K [Kloofendal 48d Partly Cloudy (Pure Sky)](https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky) HDRI used for the sky and reflections.

The optimized `public/models/concrete_road_barrier_02/barrier-optimized.glb` contains the CC0 [Concrete Road Barrier 02](https://polyhaven.com/a/concrete_road_barrier_02) from Poly Haven and its three 1K material maps. Its mesh was welded and simplified to roughly 30% of the source triangles with glTF Transform 4.5.1 (`weld`, then `simplify --ratio 0.3 --error 0.005`). It is bundled with the site and does not use Poly Haven's live API during play.

`storefront-stone.jpg` and `storefront-cafe.jpg` were generated with the built-in imagegen tool for this project. Their prompts requested flat, front-facing, photo-real downtown California storefront textures: one with a stone base and recessed glass entry, the other a dark green cafe with a warm interior. Both prompts excluded people, text, logos, signs, and perspective distortion. The two images are used only on selected street-facing ground floors.
