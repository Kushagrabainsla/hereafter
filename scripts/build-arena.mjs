import { readFile, mkdir, writeFile } from "node:fs/promises";

const center = { latitude: 37.3378, longitude: -121.8897 };
const extentMeters = 350;
const gridSize = 5;
const metersPerLatitude = 111_320;
const metersPerLongitude = metersPerLatitude * Math.cos(center.latitude * Math.PI / 180);
const osmUrl = new URL("https://api.openstreetmap.org/api/0.6/map");
osmUrl.searchParams.set("bbox", [
  center.longitude - extentMeters / metersPerLongitude,
  center.latitude - extentMeters / metersPerLatitude,
  center.longitude + extentMeters / metersPerLongitude,
  center.latitude + extentMeters / metersPerLatitude,
].join(","));

function project(node) {
  return [
    Math.round((node.lon - center.longitude) * metersPerLongitude * 10) / 10,
    Math.round((node.lat - center.latitude) * metersPerLatitude * 10) / 10,
  ];
}

function clipPolygon(points) {
  let result = points;
  for (const [axis, value, side] of [
    [0, -extentMeters, 1], [0, extentMeters, -1],
    [1, -extentMeters, 1], [1, extentMeters, -1],
  ]) {
    const input = result;
    result = [];
    for (let index = 0; index < input.length; index += 1) {
      const a = input[index];
      const b = input[(index + 1) % input.length];
      const insideA = side * (a[axis] - value) >= 0;
      const insideB = side * (b[axis] - value) >= 0;
      if (insideA) result.push(a);
      if (insideA !== insideB) {
        const fraction = (value - a[axis]) / (b[axis] - a[axis]);
        result.push([a[0] + fraction * (b[0] - a[0]), a[1] + fraction * (b[1] - a[1])]
          .map((coordinate) => Math.round(coordinate * 10) / 10));
      }
    }
  }
  return result;
}

function clipSegment(a, b) {
  let start = 0;
  let end = 1;
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  for (const [p, q] of [
    [-dx, a[0] + extentMeters], [dx, extentMeters - a[0]],
    [-dz, a[1] + extentMeters], [dz, extentMeters - a[1]],
  ]) {
    if (p === 0 && q < 0) return null;
    if (p < 0) start = Math.max(start, q / p);
    if (p > 0) end = Math.min(end, q / p);
    if (start > end) return null;
  }
  return [start, end].map((t) => [
    Math.round((a[0] + dx * t) * 10) / 10,
    Math.round((a[1] + dz * t) * 10) / 10,
  ]);
}

function roadWidth(kind) {
  if (["motorway", "trunk", "primary"].includes(kind)) return 17;
  if (["secondary", "tertiary"].includes(kind)) return 12;
  if (["residential", "unclassified"].includes(kind)) return 8;
  if (["service", "living_street"].includes(kind)) return 5;
  return 2.5;
}

function buildingHeight(tags, id) {
  const explicit = Number.parseFloat(tags.height ?? "");
  if (Number.isFinite(explicit)) return Math.max(3, Math.min(150, explicit));
  const levels = Number.parseFloat(tags["building:levels"] ?? "");
  if (Number.isFinite(levels)) return Math.max(3, Math.min(150, levels * 3.2));
  return 9 + (id % 5) * 3;
}

async function loadOsm() {
  const sourceIndex = process.argv.indexOf("--osm-file");
  if (sourceIndex >= 0) {
    const filename = process.argv[sourceIndex + 1];
    if (!filename) throw new Error("--osm-file needs a path");
    return JSON.parse(await readFile(filename, "utf8"));
  }
  const response = await fetch(osmUrl, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`OpenStreetMap returned HTTP ${response.status}`);
  return response.json();
}

async function elevationAt(east, north) {
  const url = new URL("https://epqs.nationalmap.gov/v1/json");
  url.searchParams.set("x", String(center.longitude + east / metersPerLongitude));
  url.searchParams.set("y", String(center.latitude + north / metersPerLatitude));
  url.searchParams.set("units", "Meters");
  url.searchParams.set("wkid", "4326");
  url.searchParams.set("includeDate", "false");
  const response = await fetch(url);
  if (!response.ok) throw new Error(`USGS elevation returned HTTP ${response.status}`);
  const point = await response.json();
  const value = Number(point.value);
  if (!Number.isFinite(value)) throw new Error("USGS elevation response was invalid");
  return Math.round(value * 100) / 100;
}

async function elevationGrid() {
  const positions = Array.from({ length: gridSize * gridSize }, (_, index) => [
    -extentMeters + (index % gridSize) * 2 * extentMeters / (gridSize - 1),
    -extentMeters + Math.floor(index / gridSize) * 2 * extentMeters / (gridSize - 1),
  ]);
  const values = new Array(positions.length);
  let next = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < positions.length) {
      const index = next++;
      values[index] = await elevationAt(...positions[index]);
    }
  }));
  return { gridSize, meters: values, baseMeters: values[Math.floor(values.length / 2)] };
}

const osm = await loadOsm();
const nodes = new Map(osm.elements.filter((element) => element.type === "node").map((node) => [node.id, node]));
const buildings = [];
const roads = [];
const parks = [];
const trees = [];

for (const element of osm.elements) {
  if (element.type === "node" && element.tags?.natural === "tree") {
    const point = project(element);
    if (Math.abs(point[0]) <= extentMeters && Math.abs(point[1]) <= extentMeters) trees.push(point);
    continue;
  }
  if (element.type !== "way" || !element.tags) continue;
  const points = element.nodes.map((id) => nodes.get(id)).filter(Boolean).map(project);
  if (points.length < 2) continue;
  const closed = element.nodes[0] === element.nodes.at(-1);
  if (closed && points.length >= 4) {
    const outline = clipPolygon(points.slice(0, -1));
    if (outline.length >= 3) {
      if (element.tags.building && element.tags.building !== "no") {
        buildings.push({ id: element.id, outline, height: buildingHeight(element.tags, element.id) });
      } else if (element.tags.leisure === "park" || ["grass", "recreation_ground"].includes(element.tags.landuse)) {
        parks.push({ id: element.id, outline });
      }
    }
  }
  if (element.tags.highway) {
    for (let index = 0; index < points.length - 1; index += 1) {
      const segment = clipSegment(points[index], points[index + 1]);
      if (segment) roads.push({ id: element.id, kind: element.tags.highway, width: roadWidth(element.tags.highway), points: segment });
    }
  }
}

const arena = {
  version: 1,
  center,
  extentMeters,
  source: {
    osm: osmUrl.toString(),
    osmLicense: "ODbL 1.0",
    osmLicenseUrl: "https://opendatacommons.org/licenses/odbl/1-0/",
    osmAttribution: "© OpenStreetMap contributors",
    elevation: "USGS 3DEP via EPQS",
    elevationLicense: "Public domain",
  },
  elevation: await elevationGrid(),
  buildings,
  roads,
  parks,
  trees,
};

await mkdir("public/arena", { recursive: true });
await writeFile("public/arena/san-jose.json", `${JSON.stringify(arena)}\n`);
console.log(`Built arena: ${buildings.length} buildings, ${roads.length} road segments, ${parks.length} parks, ${trees.length} trees`);
