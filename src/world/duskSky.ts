import { CanvasTexture, EquirectangularReflectionMapping, LinearFilter, SRGBColorSpace, type Vector3 } from "three/webgpu";

// A painted sky at the end of a wet afternoon, as an equirectangular image: a slate-blue zenith
// over a pale, hazy band of warm light along the horizon, a bright glow round the low sun, and
// broken rain clouds, dark grey away from the sun and lit rose and gold at their edges toward
// it. It is both the background and the light the scene's materials reflect.

const SKY: [number, [number, number, number]][] = [
  // [elevation in degrees, sRGB colour]
  [-20, [44, 42, 44]], [-2, [92, 84, 80]], [0, [214, 178, 146]], [3, [196, 160, 136]], [8, [160, 136, 130]],
  [15, [124, 118, 128]], [28, [92, 98, 116]], [45, [70, 80, 102]], [70, [56, 66, 90]], [90, [50, 60, 84]],
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
      r += 90 * glow; g += 58 * glow; b += 24 * glow;
      // Pale haze just above the rooftops.
      r += 18 * haze; g += 16 * haze; b += 14 * haze;
      if (cloudBand > 0) {
        const density = Math.max(0, Math.min(1, (clouds(azimuth, elevation) - 0.44) / 0.2)) * cloudBand;
        if (density > 0) {
          // Rain cloud: dark slate away from the sun; toward it, gold and rose at the thin edges.
          const lit = facing ** 2 * Math.exp(-elevation / 0.35) * (1 - density * 0.6) + near ** 8 * 0.6;
          const cr = 62 + 190 * lit, cg = 66 + 120 * lit, cb = 78 + 60 * lit;
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
