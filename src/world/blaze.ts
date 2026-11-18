import { AddEquation, CustomBlending, DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, MeshBasicNodeMaterial, OneFactor, PlaneGeometry, SrcAlphaFactor, Vector3, ZeroFactor, type Node, type Object3D, type TextureNode } from "three/webgpu";
import { cameraFar, cameraNear, cameraWorldMatrix, float, instancedBufferAttribute, mix, perspectiveDepthToViewZ, positionGeometry, positionView, screenUV, smoothstep, sqrt, texture, uv, varying, vec2, vec3, vec4 } from "three/tsl";
import { type Vec3 } from "./entities";
import { cloudGrain } from "./steamPipes";

// The fireball of a blast. It is a dozen round pieces of fire that fly apart from the burst, slow
// quickly and burn out. Every piece is one copy of one mesh, a square that faces the eye, drawn in
// the clouds' scene and added to the picture as light. Its shape is made in the shader, not
// painted: a round with an uneven rim, eaten into by noise as it ages, so no two pieces look the
// same. Its colour follows its heat: white-yellow in the core, orange, then deep red at the rim and
// as it burns out. It fades against the world's depth, so it cuts no hard line into the ground.
//
// The flames of things that burn are not drawn here: flames made this way lost a blind test to
// the painted flame cards of worldEffects.ts (they read as glowing blobs, not as tongues).

// How the fireball looks. One table, so the look is tuned in one place.
export const FIRE = {
  // Brightness of the hottest part of one piece, as light added to the picture. Pieces overlap,
  // so the middle of the ball is several times this; much above 1.5 burns it all to white.
  bright: 1.05,
  // How many pieces, their size (metres), how fast they fly apart (m/s), how long they burn
  // (seconds), and how many of them climb as the head of the fireball.
  ball: { pieces: 12, size: [2.4, 3.8], speed: [1.5, 4.5], life: [0.4, 0.56], climbers: 4 },
};

// The most pieces drawn at once: two fireballs.
const PIECES = FIRE.ball.pieces * 2;
interface Piece { position: Vector3; velocity: Vector3; age: number; life: number; size: number; seed: number }

const between = ([low, high]: number[]): number => low + Math.random() * (high - low);

export class Blaze {
  private pieces: Piece[] = [];
  // For each copy: its middle and size; and its age (0 new to 1 burnt out), own number and brightness.
  private places = new InstancedBufferAttribute(new Float32Array(PIECES * 4), 4);
  private forms = new InstancedBufferAttribute(new Float32Array(PIECES * 4), 4);
  private mesh: InstancedMesh;

  constructor(parent: Object3D, worldDepth: TextureNode) {
    for (const attribute of [this.places, this.forms]) attribute.setUsage(DynamicDrawUsage);
    const place = instancedBufferAttribute(this.places) as unknown as Node<"vec4">;
    const form = instancedBufferAttribute(this.forms) as unknown as Node<"vec4">;
    const corner = positionGeometry.xy;
    const right = cameraWorldMatrix.mul(vec4(1, 0, 0, 0)).xyz, up = cameraWorldMatrix.mul(vec4(0, 1, 0, 0)).xyz;
    // Light added to what is behind it. The clouds' coverage is left alone, so fire never darkens
    // the world under it when the clouds' layer is laid over the world.
    const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, depthTest: false });
    material.blending = CustomBlending;
    material.blendEquation = AddEquation;
    material.blendSrc = SrcAlphaFactor;
    material.blendDst = OneFactor;
    material.blendSrcAlpha = ZeroFactor;
    material.blendDstAlpha = OneFactor;
    material.positionNode = place.xyz.add(right.mul(corner.x.mul(place.w))).add(up.mul(corner.y.mul(place.w)));

    const age = varying(form.x), bright = varying(form.z);
    const grainAt = varying(uv().mul(0.55).add(vec2(form.y.mul(3.7), form.y.mul(1.3))));
    const grain = texture(cloudGrain(), grainAt), eat = grain.r.sub(0.2).div(0.6), lobes = grain.g;
    // Where the pixel is in the piece: -1 to 1 each way. How much fire is left there: most in the
    // middle, none past the uneven rim, less where the noise eats it and as the piece burns out.
    const at = uv().mul(2).sub(1), out = sqrt(at.x.mul(at.x).add(at.y.mul(at.y)));
    const left = float(1).sub(out.mul(lobes.mul(0.4).add(0.85))).sub(eat.mul(age.mul(1.7).add(0.15)));
    // It fades through the second half of its life: a piece that is nearly eaten away shows as a
    // red disc with holes, which must not be seen.
    const shape = smoothstep(0, 0.2, left).mul(smoothstep(0.95, 0.5, age));
    const heat = left.mul(2.2).add(0.25).sub(age.mul(0.9)).clamp(0, 1);
    // Strong colours: the pieces add up, and the sum of pale pieces is white.
    material.colorNode = mix(mix(vec3(0.55, 0.035, 0), vec3(1, 0.24, 0.02), smoothstep(0, 0.45, heat)), vec3(1, 0.7, 0.24), smoothstep(0.45, 1, heat)).mul(bright);
    const soft = smoothstep(0, 0.35, positionView.z.sub(perspectiveDepthToViewZ(worldDepth.sample(screenUV), cameraNear, cameraFar)));
    material.opacityNode = shape.mul(soft);

    // One copy at no size is drawn from the first frame, so the shader is built as the map loads.
    this.mesh = new InstancedMesh(new PlaneGeometry(1, 1), material, PIECES);
    this.mesh.count = 1;
    this.mesh.frustumCulled = false;
    // After the smoke (9.5), so a fireball shows on its own smoke, and before the rain (10).
    this.mesh.renderOrder = 9.7;
    this.mesh.name = "fireball";
    this.mesh.geometry.setAttribute("place", this.places);
    this.mesh.geometry.setAttribute("form", this.forms);
    parent.add(this.mesh);
  }

  // The fireball of a blast at a point.
  fireball(at: Vec3, power = 1): void {
    const ball = FIRE.ball;
    for (let i = 0; i < ball.pieces; i += 1) {
      const climbs = i < ball.climbers, turn = Math.random() * Math.PI * 2, tilt = climbs ? 1.2 + Math.random() * 0.3 : Math.random() * 0.9, speed = between(ball.speed) * power * (climbs ? 0.75 : 1);
      this.pieces.push({
        position: new Vector3(at.x + Math.cos(turn) * 0.2, at.y + 0.35, at.z + Math.sin(turn) * 0.2),
        velocity: new Vector3(Math.cos(turn) * Math.cos(tilt) * speed, Math.sin(tilt) * speed, Math.sin(turn) * Math.cos(tilt) * speed),
        age: 0, life: between(ball.life) * (climbs ? 1.15 : 1), size: between(ball.size) * power, seed: Math.random(),
      });
    }
    // Two blasts at once at most: older pieces go first.
    if (this.pieces.length > PIECES) this.pieces.splice(0, this.pieces.length - PIECES);
  }

  update(seconds: number): void {
    if (!this.pieces.length && this.mesh.count === 1 && this.places.array[3] === 0) return;
    const places = this.places.array as Float32Array, forms = this.forms.array as Float32Array;
    let drawn = 0;
    this.pieces = this.pieces.filter((piece) => {
      piece.age += seconds;
      const t = piece.age / piece.life;
      if (t >= 1) return false;
      // The burst slows quickly in the air, and the hot gas climbs.
      piece.velocity.multiplyScalar(Math.exp(-seconds * 4.5));
      piece.velocity.y += seconds * 2.2;
      piece.position.addScaledVector(piece.velocity, seconds);
      const i = drawn * 4;
      places[i] = piece.position.x; places[i + 1] = piece.position.y; places[i + 2] = piece.position.z; places[i + 3] = piece.size * (0.45 + 0.55 * Math.sqrt(t));
      // Brightest in its first moments.
      forms[i] = t; forms[i + 1] = piece.seed; forms[i + 2] = FIRE.bright * (1.6 - 0.9 * t);
      drawn += 1;
      return true;
    });
    if (!drawn) places[3] = 0;
    this.mesh.count = Math.max(1, drawn);
    this.places.needsUpdate = this.forms.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshBasicNodeMaterial).dispose();
  }
}
