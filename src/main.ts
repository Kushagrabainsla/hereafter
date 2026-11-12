import "@fontsource/barlow-condensed/latin-600.css";
import "@fontsource/barlow-condensed/latin-700.css";
import "@fontsource/barlow-condensed/latin-800.css";
import "@fontsource/barlow/latin-400.css";
import "@fontsource/barlow/latin-500.css";
import "@fontsource/jetbrains-mono/latin-400.css";
import "@fontsource/jetbrains-mono/latin-600.css";
import "./style.css";
import { MAPS, SHARED_FILES, CHOSEN_FILES, mapById, type GameMap } from "./maps";
import { bytesOf, filesUnder, prefetch } from "./assetStore";
import { cleanName, loadSettings, measuredQuality, normalizeRoomCode, saveSettings, validRoomCode, LANGUAGES, LANGUAGE_LABEL, voiceOf, type Settings } from "./settings";
import { drawnPixels, pickQuality, QUALITY_CHOICES, QUALITY_LABEL } from "./world/quality";
import { Loading } from "./loading";
import { fillScreen, lockMouse } from "./mouseLock";

// The page opens on the setup screen. While the player chooses, the game's code and the chosen
// map's files download in the background; Deploy shows the loading screen, which downloads
// only the sounds chosen and builds the world. The game itself lives in play.ts.

const BASE = import.meta.env.BASE_URL;
const element = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing UI element: ${id}`);
  return found as T;
};

const setup = element<HTMLElement>("setup");
const form = element<HTMLFormElement>("setup-form");
const roomRow = element<HTMLElement>("setup-room");
const codeInput = element<HTMLInputElement>("setup-code");
const nameInput = element<HTMLInputElement>("setup-name");
const errorLine = element<HTMLElement>("setup-error");
const statusText = element<HTMLElement>("setup-status-text");
const statusPercent = element<HTMLElement>("setup-status-percent");
const statusPips = element<HTMLElement>("setup-status-pips");
const radios = (name: string): HTMLInputElement[] => [...form.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`)];
const checkbox = (name: string): HTMLInputElement => form.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;

const settings: Settings = loadSettings();
// An invite link opens on its room, ready to join.
const invite = normalizeRoomCode(new URLSearchParams(window.location.search).get("room") ?? "");
if (invite) Object.assign(settings, { mode: "room", room: "join", code: invite });

// The game's code downloads at once; play.ts waits for launch before it does anything.
const game = import("./play");
game.catch(() => undefined);

// The maps, as cards; the chosen one's still is the backdrop of both screens.
const mapList = element<HTMLElement>("setup-maps");
for (const map of MAPS) {
  const card = document.createElement("label");
  card.className = "map-card";
  card.innerHTML = `<input type="radio" name="map" /><img alt="" width="104" height="58" /><div><span></span><b></b><small></small></div>`;
  card.querySelector("input")!.value = map.id;
  card.querySelector("img")!.src = `${BASE}${map.thumbnail}`;
  card.querySelector("span")!.textContent = `Map ${map.number}`;
  card.querySelector("b")!.textContent = map.name;
  card.querySelector("small")!.textContent = map.place;
  mapList.append(card);
}
const soon = document.createElement("div");
soon.className = "map-soon";
soon.innerHTML = "<i>+</i>More maps<br />soon";
mapList.append(soon);
element("setup-map-count").textContent = `${MAPS.length} of ${MAPS.length}`;

function showMap(map: GameMap): void {
  document.documentElement.style.setProperty("--map-art", `url("${BASE}${map.art}")`);
  element("setup-map-number").textContent = `Map ${map.number}`;
  element("setup-map-name").textContent = map.name;
  element("setup-map-place").textContent = `${map.place} · ${map.about}`;
}

// The form shows the settings, and every change is kept.
function render(): void {
  for (const input of radios("mode")) input.checked = input.value === settings.mode;
  for (const input of radios("room")) input.checked = input.value === settings.room;
  for (const input of radios("map")) input.checked = input.value === settings.map;
  for (const input of radios("language")) input.checked = input.value === settings.language;
  checkbox("lines").checked = settings.lines;
  checkbox("adult").checked = settings.adult;
  checkbox("memes").checked = settings.memes;
  for (const input of radios("graphics")) input.checked = input.value === settings.graphics;
  // Auto names the preset it will use on this screen.
  const pixels = drawnPixels(window.innerWidth, window.innerHeight, window.devicePixelRatio);
  element("setup-graphics-note").textContent = settings.graphics === "auto" ? `Auto: ${QUALITY_LABEL[pickQuality("auto", measuredQuality(pixels), pixels)]}` : "";
  codeInput.value = settings.code;
  nameInput.value = settings.name;
  const solo = settings.mode === "solo";
  roomRow.setAttribute("aria-disabled", String(solo));
  for (const input of [...radios("room"), codeInput]) input.disabled = solo;
  showMap(mapById(settings.map));
}

form.addEventListener("change", (event) => {
  const input = event.target as HTMLInputElement;
  if (input.name === "mode") settings.mode = input.value === "room" ? "room" : "solo";
  else if (input.name === "room") settings.room = input.value === "join" ? "join" : "create";
  else if (input.name === "map") { settings.map = input.value; startDownload(); }
  else if (input.name === "language") settings.language = LANGUAGES.find((language) => language === input.value) ?? "en";
  else if (input.name === "lines") settings.lines = input.checked;
  else if (input.name === "adult") settings.adult = input.checked;
  else if (input.name === "memes") settings.memes = input.checked;
  else if (input.name === "graphics") settings.graphics = QUALITY_CHOICES.find((choice) => choice === input.value) ?? "auto";
  errorLine.textContent = "";
  saveSettings(settings);
  render();
});
codeInput.addEventListener("input", () => {
  settings.code = normalizeRoomCode(codeInput.value);
  if (settings.code) settings.room = "join";
  errorLine.textContent = "";
  for (const input of radios("room")) input.checked = input.value === settings.room;
});
nameInput.addEventListener("input", () => {
  const name = cleanName(nameInput.value);
  if (name) { settings.name = name; saveSettings(settings); }
});
nameInput.addEventListener("change", () => { nameInput.value = settings.name; });

// The chosen map's files and the shared sounds, downloaded while the player chooses. The
// speed they come at sizes the download's share of the loading bar later.
let download: { map: string; files: string[]; total: number; received: number; startedAt: number; done: Promise<void> } | null = null;
function startDownload(): void {
  const map = mapById(settings.map);
  if (download?.map === map.id) return;
  const files = filesUnder([...map.files, ...SHARED_FILES], CHOSEN_FILES);
  const state = { map: map.id, files, total: bytesOf(files), received: 0, startedAt: performance.now(), done: Promise.resolve() };
  state.done = prefetch(files, (bytes) => { state.received += bytes; showDownload(); });
  download = state;
  showDownload();
}
// Bytes a millisecond, from what has come so far; a cautious guess before anything has.
const speed = (): number => download && download.received > 200_000 ? download.received / Math.max(1, performance.now() - download.startedAt) : 1500;

let codeReady = false;
game.then(() => { codeReady = true; showDownload(); }, () => undefined);
function showDownload(): void {
  if (!download) return;
  const fraction = download.total ? Math.min(1, download.received / download.total) : 1;
  const name = mapById(download.map).name;
  const ready = fraction >= 1 && codeReady;
  statusText.textContent = ready ? `${name} ready` : `Downloading ${name}`;
  statusPercent.textContent = ready ? "✓" : `${Math.floor(fraction * 100)}%`;
  const lit = Math.round(fraction * 6);
  statusPips.replaceChildren(...Array.from({ length: 6 }, (_, index) => {
    const pip = document.createElement("i");
    if (index < lit) pip.className = "on";
    return pip;
  }));
}

render();
startDownload();
if (invite) codeInput.focus();

form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (settings.mode === "room" && settings.room === "join" && !validRoomCode(settings.code)) {
    errorLine.textContent = "Enter a room code of 6 to 24 letters or numbers, or create a room.";
    codeInput.focus();
    return;
  }
  saveSettings(settings);
  // Deploy is the click (or Enter) browsers need before they lock the mouse or go full screen,
  // so it does both now: the mouse to the canvas the world will draw on, so mouse look is on as
  // soon as the market appears, and the game to the whole screen. The lock comes first, as going
  // full screen uses up the click.
  lockMouse(element<HTMLCanvasElement>("view"));
  fillScreen();
  void deploy();
});

async function deploy(): Promise<void> {
  const map = mapById(settings.map);
  const voice = settings.lines ? LANGUAGE_LABEL[settings.language] : "Grunts";
  const sounds = [voice, settings.adult ? "18+" : "", settings.memes ? "Memes" : ""].filter(Boolean).join(" · ");
  const left = download ? Math.max(0, download.total - download.received) : 0;
  const loading = new Loading(
    { map: [`Downloading ${map.name}`, "Map downloaded"], sounds: [`Downloading sounds · ${sounds}`, `Sounds · ${sounds}`] },
    // The downloads' shares are their bytes at the measured speed, plus decoding the sounds.
    { map: left / speed(), sounds: 60 + bytesOf(filesUnder([`audio/voice/${voiceOf(settings)}/`, "audio/voice/effort/", ...(settings.memes ? ["audio/meme/"] : [])])) / speed() },
    `Deploying to ${map.name}`,
  );
  const match = element<HTMLElement>("loader-match");
  const room = settings.mode === "solo" ? "Single player" : settings.room === "join" ? `Multiplayer · Room ${settings.code}` : "Multiplayer · New room";
  match.innerHTML = "<b>Match</b> · <span></span><br /><b>Voice</b> · <span></span>";
  const [roomText, voiceText] = match.querySelectorAll("span");
  roomText.textContent = room;
  voiceText.textContent = [voice, settings.adult ? "18+ on" : "18+ off", settings.memes ? "Memes on" : "Memes off"].join(" · ");
  const title = element<HTMLElement>("loader-map");
  title.innerHTML = "Loading map <span></span> · <b></b> · <span></span>";
  const [number, place] = title.querySelectorAll("span");
  number.textContent = map.number;
  title.querySelector("b")!.textContent = map.name;
  place.textContent = map.place;
  setup.hidden = true;

  loading.begin("map");
  const current = download!;
  const mapProgress = window.setInterval(() => loading.progress("map", current.total ? current.received / current.total : 1), 100);
  try {
    const [play] = await Promise.all([game, current.done]);
    window.clearInterval(mapProgress);
    loading.done("map");
    await play.launch(settings, loading);
  } catch {
    window.clearInterval(mapProgress);
    loading.fail("The game could not load. Check your connection, then reload.");
  }
}
