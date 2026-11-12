import { AdditiveBlending, InstancedMesh, MeshBasicNodeMaterial, PlaneGeometry, Vector3, type Scene } from "three/webgpu";
import { cross, float, fract, instanceIndex, length, normalize, positionLocal, sin, smoothstep, uniform, uv, vec3 } from "three/tsl";
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

export class Rain {
  readonly mesh: InstancedMesh;
  readonly splashes: InstancedMesh;
  private eye = uniform(new Vector3());

  constructor(scene: Scene, count: number) {
    const eye = this.eye, box = vec3(BOX.x, BOX.y, BOX.z);
    {
      const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
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
      // A streak facing the eye about the vertical, leaning with the wind; 12 to 28 cm long (the
      // distance a drop falls while the eye's shutter is open), 0.6 to 1.2 cm wide. Drops nearer than
      // 2.5 m are left out: so close, a streak fills the view like a scratch on the lens.
      const toEye = normalize(vec3(eye.x.sub(x), 0, eye.z.sub(z)));
      const side = normalize(cross(vec3(0, 1, 0), toEye));
      const along = positionLocal.y.mul(look.mul(0.16).add(0.12));
      const across = positionLocal.x.mul(look.mul(0.6).add(0.6));
      material.positionNode = centre.add(side.mul(across)).add(vec3(float(WIND).negate().mul(along), along, 0));
      const distance = centre.sub(eye).length();
      const fade = smoothstep(2.5, 4.5, distance).mul(float(1).sub(smoothstep(9, 13, distance)));
      material.colorNode = vec3(0.55, 0.6, 0.7);
      material.opacityNode = fade.mul(smoothstep(0.97, 1, outdoorNode(centre))).mul(look.mul(0.12).add(0.03));
      this.mesh = new InstancedMesh(new PlaneGeometry(0.01, 1), material, count);
      this.mesh.frustumCulled = false;
      this.mesh.renderOrder = 10;
      this.mesh.name = "rain";
      scene.add(this.mesh);
    }
    {
      // A splash: a thin ring that widens and fades in a third of a second, on a spot of the
      // street that repeats round the eye like the drops do.
      const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
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
      material.opacityNode = ring.mul(float(1).sub(life)).mul(near).mul(smoothstep(0.97, 1, outdoorNode(centre))).mul(0.1);
      this.splashes = new InstancedMesh(new PlaneGeometry(0.16, 0.16), material, SPLASHES);
      this.splashes.frustumCulled = false;
      this.splashes.renderOrder = 10;
      this.splashes.name = "rain splashes";
      scene.add(this.splashes);
    }
  }

  // Keeps the rain round the eye; call each frame.
  follow(eye: Vector3): void { this.eye.value.copy(eye); }
}
