import { readFile, writeFile } from "node:fs/promises";

const source = JSON.parse(await readFile("public/arena/san-jose.json", "utf8"));
const latitude = 37.337261;
const longitude = -121.890152;
const side = 140;
const margin = 65;
const centerEast = (longitude - source.center.longitude) * 111_320 * Math.cos(source.center.latitude * Math.PI / 180);
const centerNorth = (latitude - source.center.latitude) * 111_320;
const radius = side / 2 + margin;
const overlaps = (points) => {
  const east = points.map((point) => point[0]);
  const north = points.map((point) => point[1]);
  return Math.min(...east) <= centerEast + radius && Math.max(...east) >= centerEast - radius
    && Math.min(...north) <= centerNorth + radius && Math.max(...north) >= centerNorth - radius;
};
const block = {
  ...source,
  buildings: source.buildings.filter((building) => overlaps(building.outline)),
  roads: source.roads.filter((road) => overlaps(road.points)),
  parks: source.parks.filter((park) => overlaps(park.outline)),
  trees: source.trees.filter((point) => overlaps([point])),
};
await writeFile("public/arena/san-jose-block.json", `${JSON.stringify(block)}\n`);
console.log(`Built block: ${block.buildings.length} buildings, ${block.roads.length} road segments, ${block.trees.length} trees`);
