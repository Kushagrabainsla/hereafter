import { MAPS } from "./maps";

// The player's choices for a match, chosen on the setup screen and kept in this browser; the
// match dialog changes them during play. Storage can be unavailable, as in some private
// windows, and then the choices last this visit.

export type VoiceChoice = "hi" | "en" | "grunts";
export const VOICE_CHOICES: VoiceChoice[] = ["hi", "en", "grunts"];
export const VOICE_LABEL: Record<VoiceChoice, string> = { hi: "हिन्दी", en: "English", grunts: "Grunts only" };

export interface Settings {
  // Alone in the market, or in a room with others.
  mode: "solo" | "room";
  // In a room: start a new one or join one by its code.
  room: "create" | "join";
  code: string;
  map: string;
  name: string;
  voice: VoiceChoice;
  // Whether this player hears 18+ lines; off, they hear a clean line instead.
  adult: boolean;
  // Whether this player hears meme lines and sound effects.
  memes: boolean;
}

export const NAME_LENGTH = 16;

// Room codes: letters and digits, read without case or spacing.
const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function normalizeRoomCode(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}
export const validRoomCode = (code: string): boolean => code.length >= 6 && code.length <= 24;
export function newRoomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return [...bytes].map((byte) => ROOM_ALPHABET[byte % ROOM_ALPHABET.length]).join("");
}

// A name as players see it: printable, single-spaced and at most NAME_LENGTH characters.
export function cleanName(name: string): string {
  return Array.from(name.normalize("NFC").replace(/[\p{C}]/gu, "").replace(/\s+/g, " ").trim()).slice(0, NAME_LENGTH).join("").trim();
}

const KEYS = { name: "hereafter.name", voice: "hereafter.voice", adult: "hereafter.adult", memes: "hereafter.memes", mode: "hereafter.mode", map: "hereafter.map" };
const read = (key: string): string | null => { try { return window.localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string): void => { try { window.localStorage.setItem(key, value); } catch { /* unavailable */ } };

// A first visit gets a random name, which the player can change.
const NAME_WORDS = [
  ["Quiet", "Neon", "Rusty", "Lucky", "Swift", "Paper", "Midnight", "Copper", "Smoky", "Silver", "Crimson", "Velvet", "Jade", "Amber", "Salty", "Sleepy"],
  ["Lantern", "Bao", "Dumpling", "Tiger", "Kite", "Comet", "Fox", "Noodle", "Moth", "Sparrow", "Ember", "Crane", "Otter", "Gecko", "Mango", "Raven"],
];
function randomName(): string {
  const pick = (words: string[]): string => words[crypto.getRandomValues(new Uint32Array(1))[0] % words.length];
  return `${pick(NAME_WORDS[0])} ${pick(NAME_WORDS[1])}`;
}

export function loadSettings(): Settings {
  const name = cleanName(read(KEYS.name) ?? "") || randomName();
  write(KEYS.name, name);
  const map = read(KEYS.map);
  return {
    mode: read(KEYS.mode) === "room" ? "room" : "solo",
    room: "create",
    code: "",
    map: MAPS.some((entry) => entry.id === map) ? map! : MAPS[0].id,
    name,
    // English is the default until the Hindi lines are recorded.
    voice: VOICE_CHOICES.find((choice) => choice === read(KEYS.voice)) ?? "en",
    adult: read(KEYS.adult) === "1",
    memes: read(KEYS.memes) !== "0",
  };
}

export function saveSettings(settings: Settings): void {
  write(KEYS.name, settings.name);
  write(KEYS.voice, settings.voice);
  write(KEYS.adult, settings.adult ? "1" : "0");
  write(KEYS.memes, settings.memes ? "1" : "0");
  write(KEYS.mode, settings.mode);
  write(KEYS.map, settings.map);
}
