# San Jose pilot data

The bundled asset at `public/arena/san-jose.json` is derived from:

- [OpenStreetMap API bounding-box extract](https://wiki.openstreetmap.org/wiki/API_v0.6#Retrieving_map_data_by_bounding_box), centered at 37.3378, −121.8897 and covering approximately 700 × 700 m. Building outlines and tagged heights or levels, roads, parks, and tagged trees are converted into local meter coordinates. Missing building heights use an explicitly approximate fallback.
- [USGS Elevation Point Query Service](https://www.usgs.gov/the-national-map-data-delivery/gis-data-download) on a 5 × 5 grid. The service interpolates ground elevations from [3DEP](https://www.usgs.gov/3d-elevation-program). These heights are sampled at build time, then bundled.

OpenStreetMap data and derived geometry are licensed under [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Credit: © OpenStreetMap contributors. The bundled JSON preserves source IDs and the source URL. It can be downloaded directly from the public site or repository as the adapted database. USGS 3DEP data is public domain.

The generation script uses the raw OpenStreetMap data API once per rebuild. It does not bulk-download OpenStreetMap's community-hosted rendered map tiles. The runtime uses only the bundled derived asset. The source geographic data can be updated independently of the rendering and game code.
