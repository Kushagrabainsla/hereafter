export interface Arena {
  latitude: number;
  longitude: number;
  sizeMeters: number;
}

export const DEFAULT_ARENA: Arena = {
  latitude: 37.3378,
  longitude: -121.8897,
  sizeMeters: 400,
};

export function validateArena(arena: Arena): string | null {
  if (!Number.isFinite(arena.latitude) || arena.latitude < -85 || arena.latitude > 85) {
    return "Latitude must be between −85 and 85 for this viewer.";
  }
  if (!Number.isFinite(arena.longitude) || arena.longitude < -180 || arena.longitude > 180) {
    return "Longitude must be between −180 and 180.";
  }
  if (!Number.isFinite(arena.sizeMeters) || arena.sizeMeters < 300 || arena.sizeMeters > 500) {
    return "Arena side length must be between 300 and 500 meters.";
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
