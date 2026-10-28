import "./style.css";
import { arenaFromUrl, arenaUrl, validateArena, type Arena } from "./world/arena";
import { createMapViewer, type MapViewer, type MapState } from "./world/mapViewer";

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing UI element: ${id}`);
  return found as T;
}

const form = element<HTMLFormElement>("arena-form");
const latitudeInput = element<HTMLInputElement>("latitude");
const longitudeInput = element<HTMLInputElement>("longitude");
const sizeInput = element<HTMLInputElement>("size");
const formError = element<HTMLParagraphElement>("form-error");
const mapStatus = element<HTMLElement>("map-status");
const graphicsStatus = element<HTMLElement>("graphics-status");
const fps = element<HTMLElement>("fps");
const movementState = element<HTMLElement>("movement-state");
const cameraCoordinates = element<HTMLElement>("camera-coordinates");
const buildingCount = element<HTMLElement>("building-count");
const roadCount = element<HTMLElement>("road-count");
const notice = element<HTMLElement>("notice");
const noticeLabel = element<HTMLElement>("notice-label");
const noticeMessage = element<HTMLElement>("notice-message");

function setStatus(state: MapState, message: string): void {
  mapStatus.textContent = state === "ready" ? "Ready" : state === "loading" ? "Loading" : "Error";
  mapStatus.dataset.state = state;
  notice.dataset.state = state;
  notice.hidden = state === "ready";
  noticeLabel.textContent = state === "error" ? "Arena unavailable" : "Preparing arena";
  noticeMessage.textContent = message;
}

function fillForm(arena: Arena): void {
  latitudeInput.value = String(arena.latitude);
  longitudeInput.value = String(arena.longitude);
  sizeInput.value = String(arena.sizeMeters);
}

let arena = arenaFromUrl(window.location.search);
fillForm(arena);
let viewer: MapViewer | null = null;
const initialArena = arena;

void createMapViewer(element("map"), arena, {
  onStatus: setStatus,
  onMetrics(metrics) {
    fps.textContent = String(metrics.fps);
    graphicsStatus.textContent = metrics.renderer;
    buildingCount.textContent = String(metrics.buildings);
    roadCount.textContent = String(metrics.roads);
    movementState.textContent = metrics.player.activity;
    const { latitude, longitude, heading } = metrics.player;
    cameraCoordinates.textContent = `${latitude.toFixed(5)}, ${longitude.toFixed(5)} · ${Math.round(heading)}°`;
  },
}).then((created) => {
  viewer = created;
  if (arena !== initialArena) created.setArena(arena);
}).catch(() => {
  setStatus("error", "The arena could not load. Check the bundled data and browser WebGPU or WebGL 2 support, then reload.");
  graphicsStatus.textContent = "Unavailable";
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const nextArena = {
    latitude: latitudeInput.valueAsNumber,
    longitude: longitudeInput.valueAsNumber,
    sizeMeters: sizeInput.valueAsNumber,
  };
  const error = validateArena(nextArena);
  formError.hidden = !error;
  formError.textContent = error ?? "";
  if (error) return;
  arena = nextArena;
  history.replaceState(null, "", arenaUrl(arena));
  viewer?.setArena(arena);
});
