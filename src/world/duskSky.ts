import { CanvasTexture, EquirectangularReflectionMapping, LinearFilter, SRGBColorSpace, type Vector3 } from "three/webgpu";

// A painted dusk sky as an equirectangular image: a deep blue zenith fading through violet and
// rose to an orange band where the sun has just gone, a warm glow around the sun's bearing,
// low streaks of cloud lit from below, a faint city haze on the horizon and the first stars.
// It is both the background and the light the scene's materials reflect.

const SKY: [number, [number, number, number]][] = [
  // [elevation in degrees, sRGB colour]
  [-20, [14, 12, 20]], [-2, [36, 28, 40]], [0, [236, 132, 78]], [2.5, [222, 116, 96]], [6, [176, 90, 120]],
  [12, [116, 72, 128]], [22, [62, 56, 112]], [40, [30, 36, 86]], [65, [16, 22, 58]], [90, [9, 13, 40]],
];

function skyColor(elevation: number): [number, number, number] {
  const degrees = elevation * 180 / Math.PI;
  for (let i = 1; i < SKY.length; i += 1) {
    const [e1, c1] = SKY[i];
    if (degrees <= e1) {
      const [e0, c0] = SKY[i - 1];
      const t = Math.max(0, (degrees - e0) / (e1 - e0)), s = t * t * (3 - 2 * t);
      return [c0[0] + (c1[0] - c0[0]) * s, c0[1] + (c1[1] - c0[1]) * s, c0[2] + (c1[2] - c0[2]) * s];
    }
  }
  return SKY[SKY.length - 1][1];
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

export function duskSky(sun: Vector3, width = 2048, height = 1024): CanvasTexture {
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
    const base = skyColor(elevation);
    const sinE = Math.sin(elevation), cosE = Math.cos(elevation);
    const above = Math.max(0, elevation);
    const horizonBand = Math.exp(-Math.abs(elevation) / 0.1);
    const haze = Math.exp(-above / 0.045);
    const cloudBand = elevation > 0.015 && elevation < 0.5 ? Math.sin(Math.PI * (elevation - 0.015) / 0.485) : 0;
    for (let px = 0; px < width; px += 1) {
      const azimuth = ((px + 0.5) / width - 0.5) * Math.PI * 2;
      const toward = Math.cos(azimuth - sunAzimuth);
      const cosSun = cosE * Math.cos(sunElevation) * toward + sinE * Math.sin(sunElevation);
      let [r, g, b] = base;
      // Warm glow around the sun's bearing, strongest along the horizon.
      const facing = Math.max(0, toward);
      const glow = horizonBand * (0.25 + 0.75 * facing * facing) + Math.pow(Math.max(0, cosSun), 12) * 0.5;
      r += 120 * glow; g += 52 * glow; b += 14 * glow;
      // City light reflected in the haze just above the rooftops.
      r += 26 * haze; g += 14 * haze; b += 18 * haze;
      if (cloudBand > 0) {
        const density = Math.max(0, Math.min(1, (clouds(azimuth, elevation) - 0.5) / 0.22)) * cloudBand;
        if (density > 0) {
          // Lit from below by the set sun: orange and rose toward it, violet-grey away.
          const lit = 0.35 + 0.65 * facing * Math.exp(-elevation / 0.25);
          const cr = 70 + 150 * lit, cg = 48 + 70 * lit, cb = 78 + 30 * lit;
          r += (cr - r) * density * 0.85; g += (cg - g) * density * 0.85; b += (cb - b) * density * 0.85;
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
  // The first stars, only where the sky has darkened.
  for (let index = 0; index < 1800; index += 1) {
    const u = hash(index, 7), v = hash(index, 13);
    const elevation = Math.asin(v);
    const fade = Math.min(1, Math.max(0, (elevation - 0.35) / 0.6));
    if (fade <= 0) continue;
    const px = Math.floor(u * width), py = Math.floor((0.5 - elevation / Math.PI) * height);
    const brightness = (0.35 + 0.65 * Math.pow(hash(index, 29), 3)) * fade * 210;
    const i = (py * width + px) * 4;
    for (const channel of [0, 1, 2]) pixels[i + channel] = Math.min(255, pixels[i + channel] + brightness * (channel === 2 ? 1 : 0.92));
  }
  context.putImageData(image, 0, 0);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.mapping = EquirectangularReflectionMapping;
  texture.minFilter = LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}
