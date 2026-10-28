export interface Arena {
  latitude: number;
  longitude: number;
  sizeMeters: number;
}

export type Point = [east: number, north: number];

export interface ArenaData {
  version: number;
  center: { latitude: number; longitude: number };
  extentMeters: number;
  source: {
    osm: string;
    osmLicense: string;
    osmLicenseUrl: string;
    osmAttribution: string;
    elevation: string;
    elevationLicense: string;
  };
  elevation: { gridSize: number; meters: number[]; baseMeters: number };
  buildings: { id: number; outline: Point[]; height: number }[];
  roads: { id: number; kind: string; width: number; points: Point[] }[];
  parks: { id: number; outline: Point[] }[];
  trees: Point[];
}

export const DEFAULT_ARENA: Arena = {
  latitude: 37.3378,
  longitude: -121.8897,
  sizeMeters: 400,
};

const DATA_EXTENT_METERS = 350;
const METERS_PER_LATITUDE = 111_320;
const METERS_PER_LONGITUDE = METERS_PER_LATITUDE * Math.cos(DEFAULT_ARENA.latitude * Math.PI / 180);

export function toLocal(latitude: number, longitude: number): Point {
  return [
    (longitude - DEFAULT_ARENA.longitude) * METERS_PER_LONGITUDE,
    (latitude - DEFAULT_ARENA.latitude) * METERS_PER_LATITUDE,
  ];
}

export function toCoordinates(east: number, north: number): { latitude: number; longitude: number } {
  return {
    latitude: DEFAULT_ARENA.latitude + north / METERS_PER_LATITUDE,
    longitude: DEFAULT_ARENA.longitude + east / METERS_PER_LONGITUDE,
  };
}

export function validateArena(arena: Arena): string | null {
  if (!Number.isFinite(arena.latitude) || !Number.isFinite(arena.longitude)) {
    return "Enter valid latitude and longitude values.";
  }
  if (!Number.isFinite(arena.sizeMeters) || arena.sizeMeters < 300 || arena.sizeMeters > 500) {
    return "Arena side length must be between 300 and 500 meters.";
  }
  const [east, north] = toLocal(arena.latitude, arena.longitude);
  const half = arena.sizeMeters / 2;
  if (Math.abs(east) + half > DATA_EXTENT_METERS || Math.abs(north) + half > DATA_EXTENT_METERS) {
    return "This center is outside the bundled San Jose data. Keep the arena within about 100 m of the default center.";
  }
  return null;
}

export function arenaFromUrl(search: string): Arena {
  const params = new URLSearchParams(search);
  const arena = {
    latitude: Number(params.get("lat") ?? DEFAULT_ARENA.latitude),
    longitude: Number(params.get("lon") ?? DEFAULT_ARENA.longitude),
    sizeMeters: Number(params.get("size") ?? DEFAULT_ARENA.sizeMeters),
  };
  return validateArena(arena) ? DEFAULT_ARENA : arena;
}

export function arenaUrl(arena: Arena): string {
  const url = new URL(window.location.href);
  url.searchParams.set("lat", String(arena.latitude));
  url.searchParams.set("lon", String(arena.longitude));
  url.searchParams.set("size", String(arena.sizeMeters));
  return url.toString();
}

export function terrainHeight(data: ArenaData, east: number, north: number): number {
  const { extentMeters: extent, elevation } = data;
  const size = elevation.gridSize;
  const column = (Math.max(-extent, Math.min(extent, east)) + extent) / (extent * 2) * (size - 1);
  const row = (Math.max(-extent, Math.min(extent, north)) + extent) / (extent * 2) * (size - 1);
  const x0 = Math.floor(column);
  const z0 = Math.floor(row);
  const x1 = Math.min(size - 1, x0 + 1);
  const z1 = Math.min(size - 1, z0 + 1);
  const tx = column - x0;
  const tz = row - z0;
  const sample = (x: number, z: number): number => elevation.meters[z * size + x];
  const south = sample(x0, z0) * (1 - tx) + sample(x1, z0) * tx;
  const northValue = sample(x0, z1) * (1 - tx) + sample(x1, z1) * tx;
  return south * (1 - tz) + northValue * tz - elevation.baseMeters;
}

export async function loadArenaData(): Promise<ArenaData> {
  const response = await fetch(`${import.meta.env.BASE_URL}arena/san-jose.json`);
  if (!response.ok) throw new Error(`Arena asset returned HTTP ${response.status}`);
  const data = await response.json() as ArenaData;
  if (data.version !== 1 || !Array.isArray(data.buildings) || !Array.isArray(data.roads) || data.elevation?.meters.length !== 25) {
    throw new Error("Arena asset is invalid");
  }
  return data;
}
