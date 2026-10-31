import { CanvasTexture, Matrix4, Object3D, SRGBColorSpace, Sprite, SpriteNodeMaterial, Vector3 } from "three/webgpu";
import { cameraFar, cameraNear, materialOpacity, perspectiveDepthToViewZ, positionView, smoothstep, viewportDepthTexture } from "three/tsl";
import { type WorldEntity } from "./entities";
import { ALONG_SIGN, FACE_YAW, wallMatrix, type Face } from "./facades";
import { type KitPlacer } from "./kit";

// Lagged steam pipes along a few walls, each with a valve. A round through a pipe bursts it:
// a roaring jet and a thick cloud fill the alley around it for about eleven seconds, hiding
// anyone inside, then it thins to a wisp that keeps leaking until the room resets.
//
// The pipes are plain data shared by every client; the view below draws the steam.

interface SteamPipe { id: string; face: Face; at: number; from: number; to: number; y: number; valve: number }
export const STEAM_PIPES: SteamPipe[] = [
  { id: "pipe:service", face: "px", at: 8.5, from: 5.0, to: 9.4, y: 2.7, valve: 7.2 },
  { id: "pipe:laundry", face: "nx", at: 17, from: -17.4, to: -13.0, y: 2.75, valve: -15.2 },
  { id: "pipe:cut-through", face: "nz", at: 4, from: 1.2, to: 7.8, y: 2.8, valve: 4.4 },
  { id: "pipe:market", face: "nx", at: 0.5, from: -5.6, to: -2.4, y: 3.0, valve: -4.0 },
];
// How far the pipe's axis stands off the wall.
const STAND_OFF = 0.2;

const NORMAL: Record<Face, [number, number]> = { px: [1, 0], nx: [-1, 0], pz: [0, 1], nz: [0, -1] };
function point(pipe: SteamPipe, along: number, out: number, up = 0): Vector3 {
  const [nx, nz] = NORMAL[pipe.face];
  return nx ? new Vector3(pipe.at + nx * out, pipe.y + up, along) : new Vector3(along, pipe.y + up, pipe.at + nz * out);
}

// The whole run is one thin metal target, so a round anywhere along it bursts it.
export const PIPE_ENTITIES: WorldEntity[] = STEAM_PIPES.map((pipe) => {
  const middle = point(pipe, (pipe.from + pipe.to) / 2, STAND_OFF);
  return { id: pipe.id, kind: "pipe", material: "metal-thin", maxHealth: 10, yaw: FACE_YAW[pipe.face], center: { x: middle.x, y: middle.y, z: middle.z }, shape: { type: "box", half: [(pipe.to - pipe.from) / 2 + 0.1, 0.13, 0.13] } };
});

// Lays the pipes out from kit pieces: an elbow into the wall at each end, lagged runs
// stretched to fit, and the valve.
export function placeSteamPipes(placer: KitPlacer): void {
  for (const pipe of STEAM_PIPES) {
    // Work along the piece's own +X, which runs one way or the other along the wall.
    const sign = ALONG_SIGN[pipe.face];
    const u0 = Math.min(pipe.from * sign, pipe.to * sign), u1 = Math.max(pipe.from * sign, pipe.to * sign), uv = pipe.valve * sign;
    const at = (u: number, stretch = 1): Matrix4 => wallMatrix(pipe.face, pipe.at, u * sign, pipe.y, 0, stretch);
    placer.place("steam_end_l", at(u0));
    placer.place("steam_end_r", at(u1));
    placer.place("steam_valve", at(uv));
    for (const [start, end] of [[u0, uv - 0.22], [uv + 0.22, u1]]) {
      const count = Math.max(1, Math.round(end - start)), length = (end - start) / count;
      for (let k = 0; k < count; k += 1) placer.place("steam_run", at(start + k * length, length));
    }
  }
}

// A lumpy puff: overlapping soft blobs, so the cloud reads as billows rather than a disc.
function puffTexture(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const g = canvas.getContext("2d")!;
  let seed = 7;
  const random = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 26; i += 1) {
    const angle = random() * Math.PI * 2, distance = random() * 30, x = 64 + Math.cos(angle) * distance, y = 64 + Math.sin(angle) * distance, r = 16 + random() * 22;
    const gradient = g.createRadialGradient(x, y, 0, x, y, r);
    gradient.addColorStop(0, `rgba(255,255,255,${0.2 + random() * 0.18})`);
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gradient;
    g.fillRect(0, 0, 128, 128);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

interface Puff { sprite: Sprite; material: SpriteNodeMaterial; age: number; life: number; velocity: Vector3; size: number; opacity: number }
interface Leak { pipe: SteamPipe; source: Vector3; wall: Vector3; out: Vector3; age: number; spawn: number; puffs: Puff[] }

// How long a burst pipe blows a thick cloud, then how long it takes to thin to a wisp.
const THICK = 11, THIN = 4;
const PUFFS = 72;
// Soft particles: a billow fades over its last 0.9 m in front of whatever is behind it.
// (three's own softParticles helper names a GLSL reserved word, so WebGL cannot compile it.)
const SOFT_OPACITY = materialOpacity.mul(smoothstep(0, 0.9, positionView.z.sub(perspectiveDepthToViewZ(viewportDepthTexture(), cameraNear, cameraFar))));
const scratch = new Vector3();

export class SteamPipes {
  private leaks = new Map<string, Leak>();
  private map = puffTexture();

  constructor(private parent: Object3D) {}

  // A burst seen as it happens blows the full cloud; one that burst before this peer joined
  // only leaks.
  burst(id: string, fresh: boolean): void {
    const pipe = STEAM_PIPES.find((item) => item.id === id);
    if (!pipe || this.leaks.has(id)) return;
    const [nx, nz] = NORMAL[pipe.face];
    const puffs = Array.from({ length: PUFFS }, () => {
      // Grey, so the unlit cloud sits in the dusk instead of glowing.
      // Each billow fades where it nears a wall or the ground rather than being cut off.
      const material = new SpriteNodeMaterial({ map: this.map, color: 0x7d7873, transparent: true, opacity: 0, depthWrite: false });
      material.rotation = Math.random() * Math.PI * 2;
      material.opacityNode = SOFT_OPACITY;
      const sprite = new Sprite(material);
      sprite.visible = false;
      sprite.renderOrder = 3;
      this.parent.add(sprite);
      return { sprite, material, age: 1, life: 1, velocity: new Vector3(), size: 1, opacity: 0 };
    });
    this.leaks.set(id, { pipe, source: point(pipe, pipe.valve, STAND_OFF + 0.15), wall: point(pipe, pipe.valve, 0), out: new Vector3(nx, 0, nz), age: fresh ? 0 : THICK + THIN, spawn: 0, puffs });
  }

  restore(id: string): void {
    const leak = this.leaks.get(id);
    if (!leak) return;
    for (const puff of leak.puffs) { puff.sprite.removeFromParent(); puff.material.dispose(); }
    this.leaks.delete(id);
  }

  update(seconds: number): void {
    for (const leak of this.leaks.values()) {
      leak.age += seconds;
      // Thick: a puff every 0.12 s that billows out to 4 m. Thinning, then a wisp.
      const thick = leak.age < THICK ? 1 : Math.max(0, 1 - (leak.age - THICK) / THIN);
      const interval = thick > 0 ? 0.05 : 0.5;
      leak.spawn -= seconds;
      while (leak.spawn <= 0) {
        leak.spawn += interval;
        const puff = leak.puffs.reduce((oldest, item) => (item.age / item.life > oldest.age / oldest.life ? item : oldest));
        const strength = Math.max(0.12, thick);
        // Some puffs shoot out with the jet, most roll along the wall, so the cloud fills the
        // alley from the pipe outward.
        const spread = new Vector3((Math.random() - 0.5) * 3.2, Math.random() * 0.8, (Math.random() - 0.5) * 3.2);
        puff.velocity.copy(leak.out).multiplyScalar(0.6 + Math.random() * 2.2 * strength).add(spread.multiplyScalar(strength));
        // Steam escapes along a split in the pipe, not from a single point.
        puff.sprite.position.copy(leak.source).add(new Vector3(-leak.out.z, 0, leak.out.x).multiplyScalar((Math.random() - 0.5) * 1.2 * strength));
        puff.sprite.position.y += (Math.random() - 0.5) * 0.3;
        puff.age = 0;
        puff.life = 1.6 + strength * 3.2 + Math.random();
        puff.size = 0.5 + strength * (1.5 + Math.random() * 1.3);
        puff.material.rotation = Math.random() * Math.PI * 2;
        puff.material.color.setScalar(0.17 + Math.random() * 0.09);
        puff.opacity = 0.16 + strength * 0.42;
        puff.sprite.visible = true;
      }
      for (const puff of leak.puffs) {
        if (!puff.sprite.visible) continue;
        puff.age += seconds;
        const t = puff.age / puff.life;
        if (t >= 1) { puff.sprite.visible = false; continue; }
        // The jet slows as it spreads, and the warm cloud drifts upward.
        puff.velocity.multiplyScalar(Math.exp(-seconds * 1.8));
        puff.velocity.y += seconds * 0.35;
        puff.sprite.position.addScaledVector(puff.velocity, seconds);
        puff.sprite.scale.setScalar(puff.size * (0.25 + 0.75 * Math.sqrt(t)));
        // Billows roll along the wall rather than through it.
        const reach = puff.sprite.scale.x * 0.3, depth = scratch.copy(puff.sprite.position).sub(leak.wall).dot(leak.out);
        if (depth < reach) puff.sprite.position.addScaledVector(leak.out, reach - depth);
        puff.material.opacity = puff.opacity * (t < 0.08 ? t / 0.08 : 1 - (t - 0.08) / 0.92);
      }
    }
  }

  dispose(): void {
    for (const id of [...this.leaks.keys()]) this.restore(id);
    this.map.dispose();
  }
}
