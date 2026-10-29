import { arenaFromUrl, loadArenaData, toCoordinates, type Arena, type ArenaData } from "./arena";
import { nightMarketData } from "./nightMarket";

export type MapId = "san-jose" | "night-market";

export interface GameMap {
  id: MapId;
  // Short name for the corner label and the picker, and the place it shows.
  name: string;
  place: string;
  summary: string;
  size: string;
  preview: string;
}

export const MAPS: GameMap[] = [
  {
    id: "night-market",
    name: "Night Market",
    place: "SoFA alleys, San Jose",
    summary: "A tight back-alley market at dusk: wooden stalls, a restaurant you can run through, a bar with a balcony and a service alley behind.",
    size: "60 × 60 m · 3 lanes",
    preview: "maps/night-market.jpg",
  },
  {
    id: "san-jose",
    name: "San Jose",
    place: "Downtown streets",
    summary: "The open-data downtown block: wide streets, concrete cover, roofs reached by ladders and a stair.",
    size: "140 × 140 m · streets",
    preview: "maps/san-jose.jpg",
  },
];

export function mapById(id: MapId): GameMap {
  return MAPS.find((map) => map.id === id) ?? MAPS[1];
}

// San Jose stays the default so existing links keep working; ?map=night-market picks the market.
export function mapFromUrl(search: string): GameMap {
  const id = new URLSearchParams(search).get("map");
  return mapById(id === "night-market" ? "night-market" : "san-jose");
}

// The market is drawn around the bundled data origin, so its local coordinates match the
// rest of the game's maths (toLocal of this centre is 0, 0).
const MARKET_ARENA: Arena = { ...toCoordinates(0, 0), sizeMeters: 60 };

export function arenaForMap(map: GameMap, search: string): Arena {
  return map.id === "night-market" ? MARKET_ARENA : arenaFromUrl(search);
}

export async function loadMapData(map: GameMap, arena: Arena): Promise<ArenaData> {
  return map.id === "night-market" ? nightMarketData() : loadArenaData(arena);
}

// The page address for a map: other maps drop the San Jose centre and size, and any room.
export function mapUrl(id: MapId): string {
  const url = new URL(window.location.href);
  for (const key of ["room", "lat", "lon", "size"]) url.searchParams.delete(key);
  if (id === "san-jose") url.searchParams.delete("map");
  else url.searchParams.set("map", id);
  return url.toString();
}
