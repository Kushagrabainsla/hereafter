import { ClampToEdgeWrapping, Data3DTexture, LinearFilter, RedFormat, UnsignedByteType, type Node } from "three/webgpu";
import { float, mix, texture3D, uniform, vec3 } from "three/tsl";

// How much of the sky reaches each place in the market, on a 1 m grid, worked out once as the map
// loads from the fixed parts of the map (walls, roofs, ceilings, stalls, the truck).
//
// The walls and the ground have this baked into their lightmap. The things that are not baked
// (crates, drums, chairs, tables, stalls and their goods, pipes, signs, the truck, the players)
// were lit by the whole sky wherever they stood: under an awning or inside a shop they stayed
// bright while the walls beside them were dark, as if pasted on the picture. Their materials now
// read this grid at each point and take that share of the sky's light. The sun and the lamps are
// not changed by it.
export const SKY_GRID = { x0: -40, y0: 0, z0: -42, nx: 80, ny: 12, nz: 84 };

// How much of the grid's shade is applied (0 none, 1 all), as on the baked walls (lightmap.ts),
// and the least sky that any place keeps, so that a closed room is never black.
// (At a least of 0.1, steel tables and cookers went almost black in lit rooms.)
// Players take only half of the shade: with all of it, an enemy in a shaded lane was hard to see.
export const SKY_SHADE = { strength: uniform(0.9), least: 0.18, players: 0.5 };

const cells = new Uint8Array(SKY_GRID.nx * SKY_GRID.ny * SKY_GRID.nz).fill(255);
const volume = new Data3DTexture(cells, SKY_GRID.nx, SKY_GRID.ny, SKY_GRID.nz);
volume.format = RedFormat;
volume.type = UnsignedByteType;
volume.minFilter = volume.magFilter = LinearFilter;
volume.wrapS = volume.wrapT = volume.wrapR = ClampToEdgeWrapping;
volume.needsUpdate = true;

// The share of the sky's light that a point of the world takes: for a material's `aoNode`, which
// scales the light of the sky and the ground and leaves the sun and the lamps alone.
// `part` is how much of the shade the thing takes: 1 for props, less for players, who must stay
// easy to see in a dark place.
export function skyShade(position: Node<"vec3">, part = 1): Node<"float"> {
  const at = vec3(position.x.sub(SKY_GRID.x0).div(SKY_GRID.nx), position.y.sub(SKY_GRID.y0).div(SKY_GRID.ny), position.z.sub(SKY_GRID.z0).div(SKY_GRID.nz));
  return mix(float(1), texture3D(volume, at).r, SKY_SHADE.strength.mul(part));
}

// The same on the CPU, at the nearest cell: 0 to 1.
export function skyAt(x: number, y: number, z: number): number {
  const g = SKY_GRID, i = Math.max(0, Math.min(g.nx - 1, Math.floor(x - g.x0))), j = Math.max(0, Math.min(g.ny - 1, Math.floor(y - g.y0))), k = Math.max(0, Math.min(g.nz - 1, Math.floor(z - g.z0)));
  return cells[(k * g.ny + j) * g.nx + i] / 255;
}

// Fills the grid. `visible` gives the share of the sky that reaches a point (physics.skyVisible).
// The work is done in slabs with a pause between them, so the loading screen keeps moving.
export async function bakeSky(visible: (at: { x: number; y: number; z: number }) => number): Promise<void> {
  const g = SKY_GRID;
  for (let k = 0; k < g.nz; k += 1) {
    for (let j = 0; j < g.ny; j += 1) for (let i = 0; i < g.nx; i += 1) {
      const share = visible({ x: g.x0 + i + 0.5, y: g.y0 + j + 0.5, z: g.z0 + k + 0.5 });
      cells[(k * g.ny + j) * g.nx + i] = Math.round(255 * (SKY_SHADE.least + (1 - SKY_SHADE.least) * share));
    }
    if (k % 12 === 11) await new Promise((resolve) => setTimeout(resolve));
  }
  volume.needsUpdate = true;
}
