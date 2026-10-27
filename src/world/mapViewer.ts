import { Cesium3DTileset, Color, Viewer } from "cesium";
import type { Arena } from "./arena";
import { CameraControls, type CameraPose } from "./cameraControls";

export type TileState = "loading" | "ready" | "error";

export interface MapMetrics {
  fps: number;
  pendingTiles: number | null;
  camera: CameraPose;
}

export interface MapViewerEvents {
  onStatus: (state: TileState, message: string) => void;
  onMetrics: (metrics: MapMetrics) => void;
}

export interface MapViewer {
  setArena: (arena: Arena) => void;
  destroy: () => void;
}

const ROOT_TILESET_URL = "https://tile.googleapis.com/v1/3dtiles/root.json";

export function createMapViewer(
  container: HTMLElement,
  arena: Arena,
  apiKey: string,
  events: MapViewerEvents,
): MapViewer {
  const viewer = new Viewer(container, {
    animation: false,
    baseLayer: false,
    baseLayerPicker: false,
    fullscreenButton: false,
    geocoder: false,
    globe: false,
    homeButton: false,
    infoBox: false,
    navigationHelpButton: false,
    sceneModePicker: false,
    selectionIndicator: false,
    skyBox: false,
    skyAtmosphere: false,
    timeline: false,
    requestRenderMode: false,
  });

  viewer.scene.backgroundColor = Color.fromCssColorString("#080e19");
  const camera = new CameraControls(viewer, arena);
  let destroyed = false;
  let selectedArena = arena;
  let pendingTiles: number | null = null;
  let tileFailure = false;
  let frames = 0;
  let lastMetricsAt = performance.now();

  viewer.scene.renderError.addEventListener(() => {
    events.onStatus("error", "The 3D renderer stopped. Reload the page or check browser graphics support.");
  });

  viewer.scene.postRender.addEventListener(() => {
    frames += 1;
    const now = performance.now();
    if (now - lastMetricsAt < 500) return;
    events.onMetrics({
      fps: Math.round(frames * 1000 / (now - lastMetricsAt)),
      pendingTiles,
      camera: camera.pose(),
    });
    frames = 0;
    lastMetricsAt = now;
  });

  events.onStatus("loading", "Connecting to Google Photorealistic 3D Tiles…");
  const rootUrl = `${ROOT_TILESET_URL}?key=${encodeURIComponent(apiKey)}`;
  void Cesium3DTileset.fromUrl(rootUrl, { showCreditsOnScreen: true })
    .then((tileset) => {
      if (destroyed) {
        tileset.destroy();
        return;
      }
      tileset.loadProgress.addEventListener((requests: number, processing: number) => {
        pendingTiles = requests + processing;
        if (pendingTiles > 0) events.onStatus("loading", "Streaming the selected arena…");
        else if (!tileFailure) events.onStatus("ready", "Arena tiles loaded. Click the map to explore.");
      });
      tileset.allTilesLoaded.addEventListener(() => {
        pendingTiles = 0;
        if (!tileFailure) events.onStatus("ready", "Arena tiles loaded. Click the map to explore.");
      });
      tileset.tileFailed.addEventListener(() => {
        tileFailure = true;
        events.onStatus("error", "A map tile failed to load. Check the API key, billing, quota, network, and browser console.");
      });
      viewer.scene.primitives.add(tileset);
      events.onStatus("loading", "Tileset connected. Streaming the selected arena…");
    })
    .catch(() => {
      if (!destroyed) {
        events.onStatus("error", "Google 3D Tiles could not load. Check the Map Tiles API key, billing, quota, and network.");
      }
    });

  return {
    setArena(nextArena) {
      if (nextArena.latitude === selectedArena.latitude && nextArena.longitude === selectedArena.longitude && nextArena.sizeMeters === selectedArena.sizeMeters) return;
      selectedArena = nextArena;
      camera.reset(nextArena);
      pendingTiles = null;
      tileFailure = false;
      events.onStatus("loading", "Moving to the selected arena…");
    },
    destroy() {
      destroyed = true;
      camera.destroy();
      viewer.destroy();
    },
  };
}
