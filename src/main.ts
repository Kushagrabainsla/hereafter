import "./style.css";
import { arenaFromUrl } from "./world/arena";
import { createMapViewer, type MapViewer, type MapState } from "./world/mapViewer";

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing UI element: ${id}`);
  return found as T;
}

const controlsDialog = element<HTMLDialogElement>("controls-dialog");
const openControlsButton = element<HTMLButtonElement>("open-controls");
const closeControlsButton = element<HTMLButtonElement>("close-controls");
const performanceLabel = element<HTMLElement>("performance");
const notice = element<HTMLElement>("notice");
const noticeLabel = element<HTMLElement>("notice-label");
const noticeMessage = element<HTMLElement>("notice-message");
let viewer: MapViewer | null = null;

function setStatus(state: MapState, message: string): void {
  notice.dataset.state = state;
  notice.hidden = state === "ready";
  noticeLabel.textContent = state === "error" ? "Arena unavailable" : "Preparing arena";
  noticeMessage.textContent = message;
}

function openControls(): void {
  if (controlsDialog.open) return;
  viewer?.setPaused(true);
  controlsDialog.showModal();
}

function closeControls(): void {
  if (controlsDialog.open) controlsDialog.close();
}

openControlsButton.addEventListener("click", openControls);
closeControlsButton.addEventListener("click", closeControls);
controlsDialog.addEventListener("close", () => viewer?.setPaused(false));
document.addEventListener("keydown", (event) => {
  if (event.key.toLowerCase() !== "h" || event.repeat || event.altKey || event.metaKey || event.ctrlKey) return;
  event.preventDefault();
  if (controlsDialog.open) closeControls();
  else openControls();
});

void createMapViewer(element("map"), arenaFromUrl(window.location.search), {
  onStatus: setStatus,
  onMetrics(metrics) {
    performanceLabel.textContent = `${metrics.renderer} · ${metrics.fps} FPS`;
  },
}).then((created) => {
  viewer = created;
  if (controlsDialog.open) viewer.setPaused(true);
}).catch(() => {
  setStatus("error", "The world could not load. Check browser WebGPU or WebGL 2 support, then reload.");
  performanceLabel.textContent = "Graphics unavailable";
});
