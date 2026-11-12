import { Data3DTexture, LinearFilter, RepeatWrapping, RGBAFormat, UnsignedByteType } from "three/webgpu";

// A block of smooth noise that repeats in every direction, worked out once as the map loads and
// read by the surface shaders (surfaces.ts). Reading it is far cheaper than working out noise
// per pixel. Its four channels hold noise of four sizes: 2, 4, 8 and 16 bumps across the block,
// each with finer detail added, and each stretched to the same contrast.
const SIZE = 64;
let volume: Data3DTexture | null = null;

function lattice(period: number, seed: number): Float32Array {
  const values = new Float32Array(period * period * period);
  let state = seed >>> 0;
  for (let i = 0; i < values.length; i += 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    values[i] = state / 4294967296;
  }
  return values;
}

// Value noise on a lattice of `period` cells that wraps at the block's edge.
function sample(grid: Float32Array, period: number, x: number, y: number, z: number): number {
  const fx = x * period, fy = y * period, fz = z * period;
  const x0 = Math.floor(fx), y0 = Math.floor(fy), z0 = Math.floor(fz);
  const tx = fx - x0, ty = fy - y0, tz = fz - z0;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty), sz = tz * tz * (3 - 2 * tz);
  const at = (i: number, j: number, k: number): number => grid[(((i % period) + period) % period) + period * ((((j % period) + period) % period) + period * (((k % period) + period) % period))];
  const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
  const x00 = lerp(at(x0, y0, z0), at(x0 + 1, y0, z0), sx), x10 = lerp(at(x0, y0 + 1, z0), at(x0 + 1, y0 + 1, z0), sx);
  const x01 = lerp(at(x0, y0, z0 + 1), at(x0 + 1, y0, z0 + 1), sx), x11 = lerp(at(x0, y0 + 1, z0 + 1), at(x0 + 1, y0 + 1, z0 + 1), sx);
  return lerp(lerp(x00, x10, sy), lerp(x01, x11, sy), sz);
}

export function noiseVolume(): Data3DTexture {
  if (volume) return volume;
  const count = SIZE * SIZE * SIZE;
  const channels = [2, 4, 8, 16].map((base, channel) => {
    const octaves = [base, base * 2, base * 4].filter((period) => period <= SIZE / 2);
    const grids = octaves.map((period, octave) => lattice(period, 9781 + channel * 131 + octave * 17));
    const values = new Float32Array(count);
    let sum = 0, squares = 0;
    for (let z = 0, i = 0; z < SIZE; z += 1) for (let y = 0; y < SIZE; y += 1) for (let x = 0; x < SIZE; x += 1, i += 1) {
      let value = 0, weight = 1, total = 0;
      for (let octave = 0; octave < octaves.length; octave += 1) {
        value += sample(grids[octave], octaves[octave], x / SIZE, y / SIZE, z / SIZE) * weight;
        total += weight;
        weight *= 0.5;
      }
      value /= total;
      values[i] = value;
      sum += value;
      squares += value * value;
    }
    // Stretch to one contrast: two standard deviations either side of the mean fill the range.
    const mean = sum / count, deviation = Math.sqrt(Math.max(1e-6, squares / count - mean * mean));
    for (let i = 0; i < count; i += 1) values[i] = Math.min(1, Math.max(0, 0.5 + (values[i] - mean) / (4 * deviation)));
    return values;
  });
  const data = new Uint8Array(count * 4);
  for (let i = 0; i < count; i += 1) for (let c = 0; c < 4; c += 1) data[i * 4 + c] = Math.round(channels[c][i] * 255);
  volume = new Data3DTexture(data, SIZE, SIZE, SIZE);
  volume.format = RGBAFormat;
  volume.type = UnsignedByteType;
  volume.wrapS = volume.wrapT = volume.wrapR = RepeatWrapping;
  volume.minFilter = volume.magFilter = LinearFilter;
  volume.generateMipmaps = false;
  volume.needsUpdate = true;
  return volume;
}
