import { AddEquation, BackSide, CustomBlending, DynamicDrawUsage, IcosahedronGeometry, InstancedBufferAttribute, InstancedMesh, MeshBasicNodeMaterial, OneFactor, ZeroFactor, type Object3D, type TextureNode } from "three/webgpu";
import { cameraFar, cameraNear, cameraPosition, dot, float, fract, instancedBufferAttribute, length, max, min, mix, perspectiveDepthToViewZ, positionGeometry, positionView, screenCoordinate, screenUV, smoothstep, sqrt, uniform, varying, vec2, vec3 } from "three/tsl";
import type { Node } from "three/webgpu";
import { outdoorAt } from "./wetness";

// The lamps' light in the damp air: a soft glow round each outdoor lamp, and a cone of light
// under the shaded ones (the stalls' cage lamps under their awnings, the barn lamps on the
// service alley walls). Each lamp draws the inside of a sphere round it; every pixel of it sums
// the lamp's light scattered toward the eye along the view ray inside the sphere, in a few
// steps, up to the wall or floor drawn at that pixel. So a beam stops on the street and is cut
// by a stall roof or a passing body like real light in haze. A lamp that breaks takes its glow
// with it, as the glow follows the light's strength.
export const LAMP_HAZE = {
  // How much light the air scatters toward the eye, per unit of the lamp's strength.
  strength: uniform(0.012),
  // Metres in front of the eye where the glow begins: the air right at the eye is too thin to show,
  // and counting it veiled the whole view in orange whenever the player stood near a lamp.
  clear: uniform(1.5),
};

// How far round a lamp its glow reaches, in metres (at most): a bare bulb's halo stays tight, as
// a wide one on every bulb turns the whole street milky; a shaded lamp's beam reaches the ground.
const HALO = 1.6;
const BEAM = 3.5;
// The steps along each ray.
const STEPS = 8;

// A shaded lamp's beam: the way it points, the cosine of its half-angle (the edge softens over 0.3
// of a cosine) and how much stronger it shows than a bare bulb's halo, as the shade gathers the
// light into the cone. Lamps with no entry glow all round.
export interface LampCone { aim: [number, number, number]; cos: number; gain: number }

// Light added to what is behind it, leaving the clouds' coverage (alpha) alone (as rain.ts).
function glowMaterial(): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, depthTest: false, side: BackSide });
  material.blending = CustomBlending;
  material.blendEquation = AddEquation;
  material.blendSrc = OneFactor;
  material.blendDst = OneFactor;
  material.blendSrcAlpha = ZeroFactor;
  material.blendDstAlpha = OneFactor;
  return material;
}

export class LampHaze {
  readonly mesh: InstancedMesh;
  // The lights drawn, as indexes into the light sources, and their colours (linear 0 to 1).
  private picked: number[];
  private tints: [number, number, number][];
  private gains: number[];
  private colours: InstancedBufferAttribute;

  // `sources` are the market's lights as [x, y, z, colour, intensity, distance]; their strength
  // changes as lamps break. The glow draws in the clouds' scene (`parent`), hidden behind walls
  // by the world's depth (`worldDepth`), like the rain.
  constructor(parent: Object3D, private sources: [number, number, number, number, number, number][], cones: Map<number, LampCone>, worldDepth: TextureNode) {
    this.picked = sources.map((_, index) => index).filter((index) => outdoorAt(sources[index][0], sources[index][2]));
    const count = this.picked.length;
    const places = new Float32Array(count * 4), aims = new Float32Array(count * 4);
    this.gains = this.picked.map((index) => cones.get(index)?.gain ?? 1);
    this.tints = this.picked.map((index, k) => {
      const [x, y, z, colour, , distance] = sources[index];
      const cone = cones.get(index);
      places.set([x, y, z, cone ? Math.min(BEAM, distance * 0.45) : Math.min(HALO, distance * 0.25)], k * 4);
      aims.set(cone ? [...cone.aim, cone.cos] : [0, -1, 0, -3], k * 4);
      // sRGB to linear, roughly, so the glow matches the light's own colour.
      return [((colour >> 16) & 255) / 255, ((colour >> 8) & 255) / 255, (colour & 255) / 255].map((c) => c ** 2.2) as [number, number, number];
    });
    this.colours = new InstancedBufferAttribute(new Float32Array(count * 3), 3);
    this.colours.setUsage(DynamicDrawUsage);

    const place = instancedBufferAttribute(new InstancedBufferAttribute(places, 4)) as unknown as Node<"vec4">;
    const aim = instancedBufferAttribute(new InstancedBufferAttribute(aims, 4)) as unknown as Node<"vec4">;
    const colour = instancedBufferAttribute(this.colours) as unknown as Node<"vec3">;
    const centre = place.xyz, radius = place.w;
    const material = glowMaterial();
    material.positionNode = centre.add(positionGeometry.mul(radius));
    const world = varying(centre.add(positionGeometry.mul(radius)));
    const light = varying(centre), reach = varying(radius), beam = varying(aim), tint = varying(colour);

    // The view ray through this pixel and the stretch of it inside the sphere, cut short where
    // the world's surface lies (its distance scales with the view depth along one ray).
    const toFragment = world.sub(cameraPosition);
    const fragmentDistance = length(toFragment);
    const direction = toFragment.div(fragmentDistance);
    const surface = fragmentDistance.mul(perspectiveDepthToViewZ(worldDepth.sample(screenUV), cameraNear, cameraFar).div(positionView.z));
    const toLight = light.sub(cameraPosition);
    const middle = dot(toLight, direction);
    const miss = dot(toLight, toLight).sub(middle.mul(middle));
    const half = sqrt(max(reach.mul(reach).sub(miss), 0));
    const near = max(middle.sub(half), LAMP_HAZE.clear);
    const far = min(middle.add(half), surface);
    const span = max(far.sub(near), 0);
    // A different offset at each pixel hides the steps; the film grain covers the rest.
    const jitter = fract(float(52.9829189).mul(fract(dot(screenCoordinate.xy, vec2(0.06711056, 0.00583715)))));
    let sum: Node<"float"> = float(0);
    for (let step = 0; step < STEPS; step += 1) {
      const at = cameraPosition.add(direction.mul(mix(near, far, jitter.add(step).div(STEPS))));
      const away = at.sub(light);
      const square = dot(away, away);
      // Inverse-square, softened at the bulb and brought to zero at the sphere's edge.
      const edge = max(float(1).sub(square.div(reach.mul(reach))), 0);
      const falloff = edge.mul(edge).div(square.add(0.06));
      const inBeam = smoothstep(beam.w, beam.w.add(0.3), dot(away, beam.xyz).div(sqrt(square).add(1e-4)));
      sum = sum.add(falloff.mul(inBeam));
    }
    material.colorNode = vec3(tint).mul(sum.mul(span).div(STEPS)).mul(LAMP_HAZE.strength);
    material.opacityNode = float(1);
    this.mesh = new InstancedMesh(new IcosahedronGeometry(1, 2), material, count);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 9;
    this.mesh.name = "lamp haze";
    parent.add(this.mesh);
    this.update();
  }

  // Follows each light's strength (lamps break and come back); call each frame.
  update(): void {
    const data = this.colours.array as Float32Array;
    this.picked.forEach((index, k) => {
      const strength = this.sources[index][4] * this.gains[k], [r, g, b] = this.tints[k];
      data[k * 3] = r * strength;
      data[k * 3 + 1] = g * strength;
      data[k * 3 + 2] = b * strength;
    });
    this.colours.needsUpdate = true;
  }
}
