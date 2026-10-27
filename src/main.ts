import "cesium/Build/Cesium/Widgets/widgets.css";
import "./style.css";
import { arenaFromUrl, arenaUrl, validateArena, type Arena } from "./world/arena";
import { createMapViewer, type MapViewer, type TileState } from "./world/mapViewer";

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
const tileStatus = element<HTMLElement>("tile-status");
const pendingTiles = element<HTMLElement>("pending-tiles");
const fps = element<HTMLElement>("fps");
const cameraCoordinates = element<HTMLElement>("camera-coordinates");
const graphicsStatus = element<HTMLElement>("graphics-status");
const notice = element<HTMLElement>("notice");
const noticeLabel = element<HTMLElement>("notice-label");
const noticeMessage = element<HTMLElement>("notice-message");

function setStatus(state: TileState, message: string): void {
  tileStatus.textContent = state === "ready" ? "Ready" : state === "loading" ? "Loading" : "Error";
  tileStatus.dataset.state = state;
  notice.dataset.state = state;
  notice.hidden = state === "ready";
  noticeLabel.textContent = state === "error" ? "Map unavailable" : "Loading arena";
  noticeMessage.textContent = message;
}

function webglSupport(): string | null {
  try {
    const canvas = document.createElement("canvas");
    if (canvas.getContext("webgl2")) return "WebGL 2";
    if (canvas.getContext("webgl")) return "WebGL 1";
  } catch {
    return null;
  }
  return null;
}

function fillForm(arena: Arena): void {
  latitudeInput.value = String(arena.latitude);
  longitudeInput.value = String(arena.longitude);
  sizeInput.value = String(arena.sizeMeters);
}

let arena = arenaFromUrl(window.location.search);
fillForm(arena);
const graphics = webglSupport();
graphicsStatus.textContent = graphics ?? "Unavailable";

let viewer: MapViewer | null = null;
const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim();

if (!graphics) {
  setStatus("error", "This browser or device does not support WebGL. Enable hardware acceleration or use a modern desktop browser. WebGPU alone cannot run this Cesium viewer.");
} else if (!apiKey) {
  setStatus("error", "A Google Map Tiles API key is missing. Copy .env.example to .env, set VITE_GOOGLE_MAPS_API_KEY, then restart the development server.");
} else {
  try {
    viewer = createMapViewer(element("map"), arena, apiKey, {
      onStatus: setStatus,
      onMetrics(metrics) {
        fps.textContent = String(metrics.fps);
        pendingTiles.textContent = metrics.pendingTiles === null ? "—" : String(metrics.pendingTiles);
        const { latitude, longitude, height } = metrics.camera;
        cameraCoordinates.textContent = `${latitude.toFixed(5)}, ${longitude.toFixed(5)} · ${Math.round(height)} m`;
      },
    });
  } catch {
    setStatus("error", "The 3D viewer could not start. Check browser graphics support and reload the page.");
  }
}

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
