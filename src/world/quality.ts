// Graphics presets. Each one keeps the full drawing resolution (a lower one reads as pixelated)
// and trims the cost of every pixel instead: how many lamps are real lights, ambient occlusion,
// edge smoothing, glow, film grain, the sun's shadows, sky reflections and multisampling of
// the hands and weapon. The game picks one for the device (see pickQuality); the player can
// choose another on the setup screen.
export type QualityLevel = "low" | "medium" | "high";
export const QUALITY_LEVELS: QualityLevel[] = ["low", "medium", "high"];
export const QUALITY_LABEL: Record<QualityLevel, string> = { low: "Low", medium: "Medium", high: "High" };

export interface GraphicsQuality {
  level: QualityLevel;
  // Every lamp, bulb string and sign as a real light (clustered, WebGPU only); otherwise six
  // key lights and painted pools of light, as on WebGL 2.
  manyLights: boolean;
  // Ambient occlusion: samples and the share of the drawing resolution it works at, or none.
  occlusion: { samples: number; scale: number } | null;
  // Edge smoothing of the world.
  smaa: boolean;
  bloom: boolean;
  grain: boolean;
  // The low sun's shadows over the upper floors and roofs.
  shadows: boolean;
  // Multisampling of the hands and weapon, drawn in a pass of their own.
  viewSamples: number;
  // The lamps, signs and lit windows mirrored in the puddles (screen-space reflections).
  reflections: boolean;
  // How many raindrops fall around the player at once.
  raindrops: number;
}

// Measured on a 2560 x 1440 screen at 2x (4.2 million pixels drawn), against High in alternating
// runs: the lamps as real lights cost about 4 FPS, ambient occlusion 4.5 (fewer samples saved
// nothing), edge smoothing 1.7, the sun's shadows 1.5 and multisampling the hands 1; glow and grain
// cost nothing. Medium ran 16% faster than High and Low 29% faster. Every preset keeps the lamps:
// without them the stalls and the service alley go dark (the six key lights of WebGL 2 ran 52%
// faster but lost the market's light). Edge smoothing stays too: without it edges stair-step. The sun's
// shadows stay on Low too: since the sun reaches the wet street, without them it lit the whole
// street and the puddles blazed white toward it. They cost Low about 8% (34 to 31 FPS).
export const QUALITY: Record<QualityLevel, GraphicsQuality> = {
  high: { level: "high", manyLights: true, occlusion: { samples: 12, scale: 0.5 }, smaa: true, bloom: true, grain: true, shadows: true, viewSamples: 4, reflections: true, raindrops: 14000 },
  medium: { level: "medium", manyLights: true, occlusion: null, smaa: true, bloom: true, grain: true, shadows: true, viewSamples: 4, reflections: true, raindrops: 10000 },
  low: { level: "low", manyLights: true, occlusion: null, smaa: true, bloom: true, grain: true, shadows: true, viewSamples: 2, reflections: false, raindrops: 6000 },
};

// What the player chose on the setup screen: a preset, or Auto.
export type QualityChoice = QualityLevel | "auto";
export const QUALITY_CHOICES: QualityChoice[] = ["auto", "high", "medium", "low"];

// Auto starts from how many pixels the world will draw (at most 4.2 million, never below the
// screen's own resolution): a large or high-density screen starts on Medium. Once a match has
// run long enough to measure, a frame rate under FPS_FLOOR moves Auto one preset down for the
// next match (switching mid-match would rebuild every shader and stall the game).
export const FPS_FLOOR = 45;
const BIG_SCREEN = 3e6;

export function drawnPixels(width: number, height: number, ratio: number): number {
  const css = width * height;
  return Math.max(css * Math.min(1, ratio) ** 2, Math.min(4.2e6, css * Math.min(ratio, 2) ** 2));
}

export function pickQuality(choice: QualityChoice, measured: QualityLevel | null, pixels: number): QualityLevel {
  if (choice !== "auto") return choice;
  return measured ?? (pixels > BIG_SCREEN ? "medium" : "high");
}

// The preset one step cheaper, or null from Low.
export function cheaper(level: QualityLevel): QualityLevel | null {
  return level === "high" ? "medium" : level === "medium" ? "low" : null;
}
