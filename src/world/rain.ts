import { AddEquation, CustomBlending, InstancedMesh, MeshBasicNodeMaterial, OneFactor, PlaneGeometry, SrcAlphaFactor, Vector3, ZeroFactor, type Object3D, type TextureNode } from "three/webgpu";
import { cameraFar, cameraNear, cross, dot, float, fract, instanceIndex, length, max, normalize, perspectiveDepthToViewZ, positionLocal, positionView, pow, screenUV, sin, smoothstep, uniform, uv, vec3 } from "three/tsl";
import { ATMOSPHERE } from "./atmosphere";
import type { Node } from "three/webgpu";
import { outdoorNode, rainTime } from "./wetness";

// Rain falling through the lamplight, and its splashes on the street, worked out on the graphics
// card from each drop's number, so nothing is updated per drop. Each drop has a fixed place in
// the world that repeats every box-width, so walking through the rain does not drag it along. It
// falls at a drop's real speed with a little wind, faces the camera about the vertical, fades out
// near the eye and far away, and is not drawn over an indoor floor. Drops differ in length, width
// and brightness, as real ones catch the light differently.
const BOX = new Vector3(26, 14, 26);
// Metres per second, about a large raindrop's terminal speed.
const SPEED = 8.5;
const WIND = 0.12;
// Splashes on the ground round the player: how many, over what square, and how often each spot
// is hit.
const SPLASHES = 700;
const SPLASH_BOX = 18;
const SPLASH_RATE = 1.6;

const hash = (index: Node<"float">, k: number, m: number): Node<"float"> => fract(sin(index.mul(k)).mul(m));

// Light added to what is behind it, leaving the clouds' coverage (alpha) alone, so the rain never
// darkens the world under it when the clouds' layer is laid over the world.
function rainMaterial(): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, depthTest: false });
  material.blending = CustomBlending;
  material.blendEquation = AddEquation;
  material.blendSrc = SrcAlphaFactor;
  material.blendDst = OneFactor;
  material.blendSrcAlpha = ZeroFactor;
  material.blendDstAlpha = OneFactor;
  return material;
}

export class Rain {
  readonly mesh: InstancedMesh;
  readonly splashes: InstancedMesh;
  private eye = uniform(new Vector3());

  // The rain draws in the clouds' own scene (`parent`), laid over the world after its ambient
  // occlusion and reflections. In the world pass it would also write the normal buffer those
  // read, and each streak and splash would draw a dark line or square on what is behind it. With
  // no depth buffer of its own there, it is hidden behind walls by the world's depth (`worldDepth`).
  constructor(parent: Object3D, count: number, worldDepth: TextureNode) {
    const eye = this.eye, box = vec3(BOX.x, BOX.y, BOX.z);
    // How far in front of the world's surface at this pixel a fragment lies, in metres.
    const clearance = positionView.z.sub(perspectiveDepthToViewZ(worldDepth.sample(screenUV), cameraNear, cameraFar));
    {
      const material = rainMaterial();
      const index = float(instanceIndex);
      const seed = vec3(hash(index, 12.9898, 43758.5453), hash(index, 78.233, 24634.6345), hash(index, 39.425, 15731.743));
      const look = hash(index, 93.989, 28001.8384);
      // Where the drop is: its column repeats every box-width round the eye; it falls through the
      // box's height and starts again at the top.
      const fall = fract(seed.y.sub(rainTime.mul(SPEED / BOX.y)));
      const y = eye.y.sub(BOX.y * 0.35).add(fall.mul(box.y));
      const x = eye.x.add(fract(seed.x.sub(eye.x.div(box.x))).sub(0.5).mul(box.x)).add(y.sub(eye.y).mul(WIND));
      const z = eye.z.add(fract(seed.z.sub(eye.z.div(box.z))).sub(0.5).mul(box.z));
      const centre = vec3(x, y, z);
      // A streak facing the eye about the vertical, leaning with the wind; 30 to 55 cm long (the
      // distance a drop falls while the eye's shutter is open), 0.6 to 1 cm wide. Drops nearer than
      // 2.5 m are left out: so close, a streak fills the view like a scratch on the lens.
      const toEye = normalize(vec3(eye.x.sub(x), 0, eye.z.sub(z)));
      const side = normalize(cross(vec3(0, 1, 0), toEye));
      const along = positionLocal.y.mul(look.mul(0.25).add(0.3));
      const across = positionLocal.x.mul(look.mul(0.4).add(0.6));
      material.positionNode = centre.add(side.mul(across)).add(vec3(float(WIND).negate().mul(along), along, 0));
      const distance = centre.sub(eye).length();
      const fade = smoothstep(2.5, 4.5, distance).mul(float(1).sub(smoothstep(9, 13, distance)));
      // A drop is a tiny lens: it shows little against the shade and lights up with the sun
      // behind it, so the rain is seen mostly when looking toward the sun.
      const backlit = pow(max(dot(normalize(centre.sub(eye)), ATMOSPHERE.toSun), 0), 6);
      material.colorNode = vec3(0.3, 0.34, 0.4).add(ATMOSPHERE.sun.mul(backlit).mul(2.5));
      material.opacityNode = fade.mul(smoothstep(0.97, 1, outdoorNode(centre))).mul(look.mul(0.07).add(0.02)).mul(smoothstep(0, 0.1, clearance));
      this.mesh = new InstancedMesh(new PlaneGeometry(0.01, 1), material, count);
      this.mesh.frustumCulled = false;
      this.mesh.renderOrder = 10;
      this.mesh.name = "rain";
      parent.add(this.mesh);
    }
    {
      // A splash: a thin ring that widens and fades in a third of a second, on a spot of the
      // street that repeats round the eye like the drops do.
      const material = rainMaterial();
      const index = float(instanceIndex);
      const sx = hash(index, 17.317, 31415.927), sz = hash(index, 53.719, 27182.818), phase = fract(rainTime.mul(SPLASH_RATE).add(hash(index, 71.13, 16180.339)));
      const x = eye.x.add(fract(sx.sub(eye.x.div(SPLASH_BOX))).sub(0.5).mul(SPLASH_BOX));
      const z = eye.z.add(fract(sz.sub(eye.z.div(SPLASH_BOX))).sub(0.5).mul(SPLASH_BOX));
      const centre = vec3(x, 0.03, z);
      const size = hash(index, 29.71, 14142.136).mul(0.5).add(0.4);
      material.positionNode = centre.add(vec3(positionLocal.x.mul(size), 0, positionLocal.y.negate().mul(size)));
      const life = smoothstep(0, 0.35, phase), r = length(uv().sub(0.5)).mul(2);
      const ring = smoothstep(life.sub(0.3), life, r).mul(float(1).sub(smoothstep(life, life.add(0.15), r)));
      const near = float(1).sub(smoothstep(5, 8.5, centre.sub(eye).length()));
      material.colorNode = vec3(0.6, 0.65, 0.75);
      // A ring lies on the street, so it shows down to just under the surface the world drew there.
      material.opacityNode = ring.mul(float(1).sub(life)).mul(near).mul(smoothstep(0.97, 1, outdoorNode(centre))).mul(0.1).mul(smoothstep(-0.12, -0.04, clearance));
      this.splashes = new InstancedMesh(new PlaneGeometry(0.16, 0.16), material, SPLASHES);
      this.splashes.frustumCulled = false;
      this.splashes.renderOrder = 10;
      this.splashes.name = "rain splashes";
      parent.add(this.splashes);
    }
  }

  // Keeps the rain round the eye; call each frame.
  follow(eye: Vector3): void { this.eye.value.copy(eye); }
}
