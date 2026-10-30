import { Color, DirectionalLight, HemisphereLight, PerspectiveCamera, PointLight, Scene, Vector3 } from "three/webgpu";

// [x, y, z, colour, intensity, distance] of a lamp in the world (see BuiltMap.lightSources).
export type LightSource = [number, number, number, number, number, number];
export interface Vec3 { x: number; y: number; z: number }
// Whether nothing solid lies between two points.
export type LineOfSight = (from: Vec3, to: Vec3) => boolean;

const SLOTS = 4;
const CHECKED = 8;
const CHECK_SECONDS = 0.12;

// The first-person arms and weapon draw in their own scene so they never sink into walls,
// so the world's lights cannot reach them. This lights them like the spot the player is
// in. The lamps that light that spot most become lights placed where they are relative to
// the camera, dimmed when something stands between them and the player; the strongest
// casts shadows across the fingers and the weapon; the rest join the ambient light, which
// otherwise matches the world's sky and ground; and the low sun counts only where it
// reaches the player. Muzzle flashes light the hands too.
export class ViewLighting {
  private slots: PointLight[] = [];
  private key = new DirectionalLight(0xffffff, 0);
  private sun = new DirectionalLight(0xff9452, 0);
  private ambient = new HemisphereLight(0x7c88b8, 0x2a2026, 0.85);
  private flashLight = new PointLight(0xffc27a, 0, 3, 2);
  private visibility: number[];
  private visible: number[];
  private sunVisible = 0;
  private sunTarget = 0;
  private sinceCheck = CHECK_SECONDS;
  private flash = 0;
  private eye = new Vector3();
  private scratch = new Vector3();
  private color = new Color();
  private extra = new Color();

  constructor(scene: Scene, private sources: LightSource[], private sunDirection: Vector3, private sunIntensity: number, private clear: LineOfSight) {
    this.visibility = sources.map(() => 1);
    this.visible = sources.map(() => 1);
    for (let index = 0; index < SLOTS; index += 1) {
      const light = new PointLight(0xffffff, 0, 8, 2);
      this.slots.push(light);
      scene.add(light);
    }
    // A tight shadow camera around the arms and weapon, a metre in front of the eye.
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(1024, 1024);
    Object.assign(this.key.shadow.camera, { left: -0.7, right: 0.7, top: 0.7, bottom: -0.7, near: 0.05, far: 4 });
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.012;
    this.key.target.position.set(0.12, -0.18, -0.45);
    scene.add(this.key, this.key.target, this.sun, this.sun.target, this.ambient, this.flashLight);
  }

  // A shot lights the hands for a moment from the muzzle, given in view-space metres.
  muzzleFlash(at: Vector3 | undefined, strength = 1): void {
    if (at) this.flashLight.position.copy(at);
    else this.flashLight.position.set(0.15, -0.1, -0.7);
    this.flash = strength;
  }

  update(seconds: number, camera: PerspectiveCamera): void {
    const eye = this.eye.copy(camera.position);
    // The hands sit below and ahead of the eyes.
    const hands = { x: eye.x, y: eye.y - 0.3, z: eye.z };
    const contribution = this.sources.map(([x, y, z, , intensity, distance]) => {
      const d = Math.max(0.3, Math.hypot(x - hands.x, y - hands.y, z - hands.z));
      const window = Math.max(0, 1 - (d / distance) ** 4) ** 2;
      return intensity * window / (d * d);
    });
    this.sinceCheck += seconds;
    if (this.sinceCheck >= CHECK_SECONDS) {
      this.sinceCheck = 0;
      const ranked = contribution.map((value, index) => ({ value, index })).filter((entry) => entry.value > 0.02).sort((a, b) => b.value - a.value).slice(0, CHECKED);
      for (const { index } of ranked) {
        const [x, y, z] = this.sources[index];
        this.visible[index] = this.clear(hands, { x, y, z }) ? 1 : 0.12;
      }
      const toSun = { x: hands.x + this.sunDirection.x * 150, y: hands.y + this.sunDirection.y * 150, z: hands.z + this.sunDirection.z * 150 };
      this.sunTarget = this.clear(hands, toSun) ? 1 : 0;
    }
    const ease = 1 - Math.exp(-seconds * 6);
    for (let index = 0; index < this.sources.length; index += 1) this.visibility[index] += (this.visible[index] - this.visibility[index]) * ease;
    this.sunVisible += (this.sunTarget - this.sunVisible) * ease;
    const order = contribution.map((value, index) => ({ value: value * this.visibility[index], index })).sort((a, b) => b.value - a.value);
    // The strongest lamp is the shadow-casting key, as a directional light carrying the
    // irradiance it puts on the hands; the next become point lights in view space.
    const toView = camera.matrixWorldInverse;
    const strongest = order[0];
    if (strongest && strongest.value > 0) {
      const [x, y, z, color] = this.sources[strongest.index];
      const local = this.scratch.set(x, y, z).applyMatrix4(toView);
      this.key.position.copy(local).sub(this.key.target.position).normalize().multiplyScalar(2).add(this.key.target.position);
      this.key.color.setHex(color);
      this.key.intensity = strongest.value;
    } else this.key.intensity = 0;
    for (let slot = 0; slot < SLOTS; slot += 1) {
      const entry = order[slot + 1], light = this.slots[slot];
      if (!entry || entry.value <= 0) { light.intensity = 0; continue; }
      const [x, y, z, color, intensity, distance] = this.sources[entry.index];
      light.position.set(x, y, z).applyMatrix4(toView);
      light.color.setHex(color);
      light.intensity = intensity * this.visibility[entry.index];
      light.distance = distance;
    }
    // Every other lamp adds to the ambient light in its own colour.
    let rest = 0;
    this.extra.setRGB(0, 0, 0);
    for (let rank = SLOTS + 1; rank < order.length && order[rank].value > 0.01; rank += 1) {
      const value = order[rank].value;
      rest += value;
      this.extra.add(this.color.setHex(this.sources[order[rank].index][3]).multiplyScalar(value));
    }
    if (rest > 0) this.extra.multiplyScalar(1 / rest);
    // Only a little: lamps further off light the hands from above and the sides, not evenly.
    this.ambient.color.setHex(0x7c88b8).lerp(this.extra, Math.min(0.5, rest * 0.3));
    this.ambient.intensity = 0.85 + Math.min(0.4, rest * 0.2);
    const sun = this.scratch.copy(this.sunDirection).transformDirection(toView);
    this.sun.position.copy(sun).multiplyScalar(5);
    this.sun.intensity = this.sunIntensity * this.sunVisible;
    this.flashLight.intensity = this.flash * 6;
    this.flash *= Math.exp(-seconds * 45);
  }
}
