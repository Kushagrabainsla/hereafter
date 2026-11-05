// The maps a match can be played on. Each lists the public files it needs, by path prefix; the
// setup screen downloads them while the player chooses, so only the chosen map is fetched.
// Its art is a still of the map for the setup and loading screens, and its thumbnail the
// picture on its card.
//
// For now there is one map. When there are more, the player who creates a room chooses it and
// the room must tell joining players which one to load (see docs/multiplayer.md).

export interface GameMap {
  id: string;
  number: string;
  name: string;
  place: string;
  about: string;
  files: string[];
  art: string;
  thumbnail: string;
}

export const MAPS: GameMap[] = [
  {
    id: "night-market",
    number: "01",
    name: "Night Market",
    place: "San Jose · Dusk",
    about: "Back-alley market",
    files: ["models/", "textures/", "lightmaps/night-market"],
    art: "maps/night-market.jpg",
    thumbnail: "maps/night-market-thumb.jpg",
  },
];

// Sounds every match uses, whatever the map: gunfire, footsteps, impacts and the like. Voices
// and memes are loaded by choice instead.
export const SHARED_FILES = ["audio/"];
export const CHOSEN_FILES = ["audio/voice/", "audio/meme/"];

export const mapById = (id: string): GameMap => MAPS.find((map) => map.id === id) ?? MAPS[0];
