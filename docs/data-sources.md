# San Jose pilot data

The bundled asset at `public/arena/san-jose.json` is derived from:

- [OpenStreetMap API bounding-box extract](https://wiki.openstreetmap.org/wiki/API_v0.6#Retrieving_map_data_by_bounding_box), centered at 37.3378, −121.8897 and covering approximately 700 × 700 m. Building outlines and tagged heights or levels, roads, parks, and tagged trees are converted into local meter coordinates. Missing building heights use an explicitly approximate fallback.
- [USGS Elevation Point Query Service](https://www.usgs.gov/the-national-map-data-delivery/gis-data-download) on a 5 × 5 grid. The service interpolates ground elevations from [3DEP](https://www.usgs.gov/3d-elevation-program). These heights are sampled at build time, then bundled.

OpenStreetMap data and derived geometry are licensed under [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Credit: © OpenStreetMap contributors. The bundled JSON preserves source IDs and the source URL. It can be downloaded directly from the public site or repository as the adapted database. USGS 3DEP data is public domain.

The generation script uses the raw OpenStreetMap data API once per rebuild. It does not bulk-download OpenStreetMap's community-hosted rendered map tiles. The runtime uses only the bundled derived asset. The source geographic data can be updated independently of the rendering and game code.

## Visual materials

The files in `public/textures/` are 1K diffuse and selected normal maps from [Poly Haven](https://polyhaven.com/), released under [CC0](https://polyhaven.com/license). They were downloaded at build time and are served from this repository, with no runtime API calls. Source assets: [Asphalt 01](https://polyhaven.com/a/asphalt_01), [Concrete Pavement 02](https://polyhaven.com/a/concrete_pavement_02), [Grass Ground](https://polyhaven.com/a/grass_ground), [Plastered Wall 04](https://polyhaven.com/a/plastered_wall_04), [Concrete Wall 003](https://polyhaven.com/a/concrete_wall_003), [Brick Wall 001](https://polyhaven.com/a/brick_wall_001), [Grey Roof Tiles](https://polyhaven.com/a/grey_roof_tiles), and [Bark Platanus](https://polyhaven.com/a/bark_platanus).
