import { CanvasTexture, EquirectangularReflectionMapping, LinearFilter, SRGBColorSpace, type Vector3 } from "three/webgpu";

// A painted sky at the end of a wet afternoon, as an equirectangular image: a slate-blue zenith
// over a pale, hazy band of warm light along the horizon, a bright glow round the low sun, and
// broken rain clouds, dark grey away from the sun and lit rose and gold at their edges toward
// it. It is both the background and the light the scene's materials reflect.

type Stops = [number, [number, number, number]][];
const SKY: Stops = [
  // [elevation in degrees, sRGB colour]
  [-20, [44, 42, 44]], [-2, [92, 84, 80]], [0, [214, 178, 146]], [3, [196, 160, 136]], [8, [160, 136, 130]],
  [15, [124, 118, 128]], [28, [92, 98, 116]], [45, [70, 80, 102]], [70, [56, 66, 90]], [90, [50, 60, 84]],
];

// By day: a clear sky, pale and hazy at the horizon and deep blue overhead.
const DAY_SKY: Stops = [
  [-20, [70, 68, 66]], [-2, [140, 136, 130]], [0, [214, 222, 228]], [4, [196, 212, 228]], [12, [160, 190, 222]],
  [25, [120, 162, 210]], [45, [86, 134, 196]], [70, [66, 114, 184]], [90, [58, 104, 176]],
];

// How each time of day paints the glow round the sun and the clouds (see the loop below).
const PAINT = {
  dusk: { stops: SKY, glow: [90, 58, 24], haze: [18, 16, 14], cover: 0.44, shade: [62, 66, 78], lit: [190, 120, 60] },
  day: { stops: DAY_SKY, glow: [60, 50, 34], haze: [22, 22, 20], cover: 0.56, shade: [178, 184, 194], lit: [70, 66, 56] },
};

function skyColor(elevation: number, stops: Stops): [number, number, number] {
  const degrees = elevation * 180 / Math.PI;
  for (let i = 1; i < stops.length; i += 1) {
    const [e1, c1] = stops[i];
    if (degrees <= e1) {
      const [e0, c0] = stops[i - 1];
      const t = Math.max(0, (degrees - e0) / (e1 - e0)), s = t * t * (3 - 2 * t);
      return [c0[0] + (c1[0] - c0[0]) * s, c0[1] + (c1[1] - c0[1]) * s, c0[2] + (c1[2] - c0[2]) * s];
    }
  }
  return stops[stops.length - 1][1];
}

function hash(x: number, y: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Value noise that wraps every `period` cells in x, so the sky has no seam at the back.
function noise(x: number, y: number, period: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y), tx = x - x0, ty = y - y0;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  const wrap = (v: number): number => ((v % period) + period) % period;
  const a = hash(wrap(x0), y0), b = hash(wrap(x0 + 1), y0), c = hash(wrap(x0), y0 + 1), d = hash(wrap(x0 + 1), y0 + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function clouds(azimuth: number, elevation: number): number {
  let value = 0, amplitude = 0.5, frequency = 1;
  for (let octave = 0; octave < 5; octave += 1) {
    const period = 9 * frequency;
    value += amplitude * noise((azimuth / (Math.PI * 2) + 0.5) * period, elevation * 26 * frequency, period);
    amplitude *= 0.5;
    frequency *= 2;
  }
  return value;
}

// `time` is "dusk" (a wet afternoon's end, rain clouds lit gold) or "day" (clear blue, a few white
// fair-weather clouds).
export function duskSky(sun: Vector3, time: "dusk" | "day" = "dusk", width = 2048, height = 1024): CanvasTexture {
  const paint = PAINT[time];
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas textures are unavailable");
  const image = context.createImageData(width, height);
  const pixels = image.data;
  const sunAzimuth = Math.atan2(sun.z, sun.x), sunElevation = Math.asin(Math.max(-1, Math.min(1, sun.y)));
  for (let py = 0; py < height; py += 1) {
    const elevation = (0.5 - (py + 0.5) / height) * Math.PI;
    const base = skyColor(elevation, paint.stops);
    const sinE = Math.sin(elevation), cosE = Math.cos(elevation);
    const above = Math.max(0, elevation);
    const horizonBand = Math.exp(-Math.abs(elevation) / 0.1);
    const haze = Math.exp(-above / 0.045);
    const cloudBand = elevation > 0.01 && elevation < 1.1 ? Math.sin(Math.PI * (elevation - 0.01) / 1.09) ** 0.6 : 0;
    for (let px = 0; px < width; px += 1) {
      const azimuth = ((px + 0.5) / width - 0.5) * Math.PI * 2;
      const toward = Math.cos(azimuth - sunAzimuth);
      const cosSun = cosE * Math.cos(sunElevation) * toward + sinE * Math.sin(sunElevation);
      let [r, g, b] = base;
      // A wide warm glow round the sun, strongest along the horizon, and a tight bright one.
      const facing = Math.max(0, toward);
      const near = Math.max(0, cosSun);
      const glow = horizonBand * (0.15 + 0.85 * facing ** 3) + near ** 6 * 0.55 + near ** 60 * 0.6;
      r += paint.glow[0] * glow; g += paint.glow[1] * glow; b += paint.glow[2] * glow;
      // Pale haze just above the rooftops.
      r += paint.haze[0] * haze; g += paint.haze[1] * haze; b += paint.haze[2] * haze;
      if (cloudBand > 0) {
        const density = Math.max(0, Math.min(1, (clouds(azimuth, elevation) - paint.cover) / 0.2)) * cloudBand;
        if (density > 0) {
          // Rain cloud: dark slate away from the sun; toward it, gold and rose at the thin edges.
          const lit = facing ** 2 * Math.exp(-elevation / 0.35) * (1 - density * 0.6) + near ** 8 * 0.6;
          const cr = paint.shade[0] + paint.lit[0] * lit, cg = paint.shade[1] + paint.lit[1] * lit, cb = paint.shade[2] + paint.lit[2] * lit;
          r += (cr - r) * density * 0.9; g += (cg - g) * density * 0.9; b += (cb - b) * density * 0.9;
        }
      }
      const dither = (hash(px, py) - 0.5) * 2.2;
      const i = (py * width + px) * 4;
      pixels[i] = Math.max(0, Math.min(255, r + dither));
      pixels[i + 1] = Math.max(0, Math.min(255, g + dither));
      pixels[i + 2] = Math.max(0, Math.min(255, b + dither));
      pixels[i + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.mapping = EquirectangularReflectionMapping;
  texture.minFilter = LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}
