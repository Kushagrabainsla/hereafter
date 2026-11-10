import { Vector2, type Light, type Node, type Renderer, type UniformNode } from "three/webgpu";
import { clamp, float, Fn, int, log, positionView, screenCoordinate, uniform } from "three/tsl";
import { ClusteredLighting } from "three/addons/lighting/ClusteredLighting.js";
import ClusteredLightsNode from "three/addons/tsl/lighting/ClusteredLightsNode.js";

// three's clustered lighting fits its grid of screen tiles to the drawing size and writes the
// grid's dimensions into every lit material's shader, so any change of size (a window resized,
// going fullscreen, the resolution lowered) rebuilds every shader. On a 16-inch Retina screen
// that froze the page for seconds at a time. Here the grid is fixed at 40 × 24 tiles whatever
// the size: it is built once, and each fragment finds its tile through a uniform updated every
// frame, so a resize changes no shader.
const TILES_X = 40;
const TILES_Y = 24;
const drawing = new Vector2();

// three's own fields this reaches into, which its type declarations leave out.
interface Internals {
  tileSize: number;
  zSlices: number;
  _bufferSize: Vector2 | null;
  _screenClusterIndex: Node;
  _cameraNear: UniformNode<"float", number>;
  _cameraFar: UniformNode<"float", number>;
  create(width: number, height: number): void;
}

class FixedGridLightsNode extends ClusteredLightsNode {
  private tilesPerPixel = uniform(new Vector2(1, 1));

  updateProgram(renderer: Renderer): void {
    // The tiles span whatever is being drawn into: the canvas, or a pass drawn smaller than it.
    const target = renderer.getRenderTarget();
    if (target) drawing.set(target.width, target.height);
    else renderer.getDrawingBufferSize(drawing);
    this.tilesPerPixel.value.set(TILES_X / drawing.x, TILES_Y / drawing.y);
    const node = this as unknown as Internals;
    if (node._bufferSize !== null) return;
    // Build the grid as if the screen were exactly 40 × 24 tiles; the light assignment works
    // in normalised device coordinates, so only the fragment's tile lookup needs replacing.
    node.create(TILES_X * node.tileSize, TILES_Y * node.tileSize);
    const slices = node.zSlices;
    const clusterIndex = Fn(() => {
      const tile = screenCoordinate.mul(this.tilesPerPixel).floor();
      const invLogFarOverNear = float(1).div(log(node._cameraFar.div(node._cameraNear)));
      const slice = clamp(log(positionView.z.negate().div(node._cameraNear)).mul(invLogFarOverNear).mul(float(slices)).floor(), float(0), float(slices - 1));
      return int(clamp(tile.x, float(0), float(TILES_X - 1)))
        .add(int(clamp(tile.y, float(0), float(TILES_Y - 1))).mul(int(TILES_X)))
        .add(int(slice).mul(int(TILES_X * TILES_Y)));
    });
    node._screenClusterIndex = clusterIndex().toVar();
  }
}

export class FixedGridLighting extends ClusteredLighting {
  createNode(lights: Light[] = []): ClusteredLightsNode {
    return new FixedGridLightsNode(this.maxLights, this.tileSize, this.zSlices, this.maxLightsPerCluster).setLights(lights) as ClusteredLightsNode;
  }
}
