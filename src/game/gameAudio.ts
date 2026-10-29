import { type WeaponKind } from "./combatRules";
import { type Material } from "../world/materials";

// Sound effects for the local player, other players and the HUD. Recorded CC0 samples
// (public/audio, built by scripts/audio/build.sh) cover guns, reloads, footsteps and
// impacts; hit confirmation, the knife swing and near-miss cracks are synthesised.
// Samples are fetched and decoded at start-up on an offline context, so nothing waits
// on the first click; the playing context starts on the first user gesture, as browsers
// require. Other players' sounds are positioned with HRTF panners, dulled with distance
// and behind walls, and share a synthetic street reverb.

export interface Vec3 { x: number; y: number; z: number }
export type Surface = "hard" | "soft";
export type Gait = "walk" | "run" | "crouch";

const BANK = {
  "pistol-near": 3, "pistol-far": 2, "rifle-near": 4, "rifle-far": 2,
  "reload-pistol": 1, "reload-rifle": 1, "dry-fire": 1, "latch": 1, "mag-in": 1,
  "draw-knife": 3, "cloth": 4, "grab": 2, "knife-hit": 2,
  "step-hard": 5, "step-soft": 5, "land": 3,
  "body-hit": 5, "hurt": 3, "bullet-impact": 4,
  "impact-metal": 3, "impact-wood": 3, "impact-glass": 3, "impact-soft": 3, "glass-break": 3, "wood-break": 2,
} as const;

const IMPACT_SOUND: Record<Material, SoundName | null> = {
  glass: "impact-glass", wood: "impact-wood", timber: "impact-wood", "metal-thin": "impact-metal", "metal-solid": "impact-metal",
  plastic: "impact-soft", cardboard: "impact-soft", concrete: "bullet-impact", brick: "bullet-impact", ground: "bullet-impact", flesh: null, boundary: null,
};
type SoundName = keyof typeof BANK;

interface Sample { buffer: AudioBuffer; offset: number }
interface PlayOptions { gain?: number; rate?: number; when?: number; pan?: number; reverb?: number; bus?: AudioNode }
interface SpatialOptions extends PlayOptions { ref?: number; rolloff?: number; occluded?: boolean; priority?: "high" | "low" }

const STORAGE_KEY = "hereafter.muted";
const SAMPLE_RATE = 48000;
const MAX_SPATIAL_VOICES = 40;
const MASTER = 0.85;

function readMuted(): boolean {
  try { return window.localStorage.getItem(STORAGE_KEY) === "1"; } catch { return false; }
}

// A street canyon: early slapback from facades, then a darkening one-second tail.
function streetImpulse(context: BaseAudioContext): AudioBuffer {
  const length = Math.round(context.sampleRate * 1.25);
  const impulse = context.createBuffer(2, length, context.sampleRate);
  const reflections = [[0.019, 0.5], [0.034, 0.38], [0.052, 0.3], [0.077, 0.22], [0.108, 0.16], [0.151, 0.11]];
  for (let channel = 0; channel < 2; channel += 1) {
    const data = impulse.getChannelData(channel);
    let low = 0;
    for (let i = 0; i < length; i += 1) {
      const t = i / context.sampleRate;
      const noise = (Math.random() * 2 - 1) * Math.exp(-t / 0.16) * 0.32;
      const damping = Math.min(0.92, 0.25 + t * 1.4);
      low += (noise - low) * (1 - damping);
      data[i] = low;
    }
    for (const [time, gain] of reflections) {
      const index = Math.round((time + (channel ? 0.0031 : 0)) * context.sampleRate);
      data[index] += gain * (Math.random() < 0.5 ? -1 : 1);
    }
  }
  return impulse;
}

export class GameAudio {
  private context: AudioContext | null = null;
  private samples = new Map<SoundName, Sample[]>();
  private lastVariant = new Map<SoundName, number>();
  private loading: Promise<void>;
  private noise: AudioBuffer | null = null;
  private master!: GainNode;
  private muffle!: BiquadFilterNode;
  private mix!: GainNode;
  private ui!: GainNode;
  private reverb!: GainNode;
  private listenerAt: Vec3 = { x: 0, y: 0, z: 0 };
  private spatialVoices: { source: AudioBufferSourceNode; priority: "high" | "low" }[] = [];
  private localReload: AudioBufferSourceNode | null = null;
  private slideVoice: { source: AudioBufferSourceNode; gain: GainNode } | null = null;
  private down = false;
  private muted = readMuted();
  occlusion: (from: Vec3, to: Vec3) => boolean = () => false;

  constructor() {
    this.loading = this.load();
  }

  isMuted(): boolean { return this.muted; }

  setMuted(muted: boolean): void {
    this.muted = muted;
    try { window.localStorage.setItem(STORAGE_KEY, muted ? "1" : "0"); } catch { /* storage unavailable */ }
    if (this.context) this.master.gain.setTargetAtTime(muted ? 0 : MASTER, this.context.currentTime, 0.02);
  }

  // Call from a user gesture. Builds the graph once and resumes a suspended context.
  unlock(): void {
    if (!this.context) {
      const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Context) return;
      this.context = new Context({ latencyHint: "interactive" });
      this.build(this.context);
    }
    if (this.context.state !== "running") void this.context.resume().catch(() => undefined);
  }

  // The master bus, for tests that record the mix.
  output(): AudioNode | null { return this.context ? this.master : null; }
  audioContext(): AudioContext | null { return this.context; }
  ready(): Promise<void> { return this.loading; }

  listen(position: Vec3, forward: Vec3, up: Vec3): void {
    this.listenerAt = { x: position.x, y: position.y, z: position.z };
    const context = this.context;
    if (!context || context.state !== "running") return;
    const listener = context.listener;
    if (listener.positionX) {
      const t = context.currentTime;
      listener.positionX.setValueAtTime(position.x, t);
      listener.positionY.setValueAtTime(position.y, t);
      listener.positionZ.setValueAtTime(position.z, t);
      listener.forwardX.setValueAtTime(forward.x, t);
      listener.forwardY.setValueAtTime(forward.y, t);
      listener.forwardZ.setValueAtTime(forward.z, t);
      listener.upX.setValueAtTime(up.x, t);
      listener.upY.setValueAtTime(up.y, t);
      listener.upZ.setValueAtTime(up.z, t);
    } else {
      listener.setPosition(position.x, position.y, position.z);
      listener.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
    }
  }

  listenerPosition(): Vec3 { return this.listenerAt; }

  distanceTo(point: Vec3): number {
    return Math.hypot(point.x - this.listenerAt.x, point.y - this.listenerAt.y, point.z - this.listenerAt.z);
  }

  // Local player ------------------------------------------------------------------------

  fire(weapon: WeaponKind): void {
    if (!this.live()) return;
    if (weapon === "knife") { this.swing(); return; }
    this.play(weapon === "pistol" ? "pistol-near" : "rifle-near", { gain: weapon === "pistol" ? 0.95 : 0.85, rate: 0.97 + Math.random() * 0.06, reverb: 0.42, bus: this.mix });
    this.thump(weapon === "pistol" ? 0.55 : 0.45);
  }

  dryFire(): void { this.play("dry-fire", { gain: 0.14 }); }

  reload(weapon: WeaponKind): void {
    if (weapon === "knife") return;
    this.localReload?.stop();
    this.localReload = this.play(weapon === "pistol" ? "reload-pistol" : "reload-rifle", { gain: 0.2 });
  }

  cancelReload(): void { this.localReload?.stop(); this.localReload = null; }

  // Holster during the first half of the 560 ms switch, then draw and, for guns, a ready click.
  switchWeapon(weapon: WeaponKind): void {
    const now = this.time();
    this.play("cloth", { gain: 0.13, when: now });
    if (weapon === "knife") this.play("draw-knife", { gain: 0.15, when: now + 0.28 });
    else {
      this.play("grab", { gain: 0.15, when: now + 0.26 });
      this.play("latch", { gain: 0.14, when: now + 0.5, rate: weapon === "pistol" ? 1.12 : 0.95 });
    }
  }

  pickup(): void {
    const now = this.time();
    this.play("grab", { gain: 0.22, when: now });
    this.play("mag-in", { gain: 0.24, when: now + 0.17 });
    this.play("latch", { gain: 0.15, when: now + 0.42 });
  }

  step(surface: Surface, gait: Gait, side: number): void {
    const gain = gait === "run" ? 0.16 : gait === "walk" ? 0.1 : 0.045;
    this.play(surface === "hard" ? "step-hard" : "step-soft", { gain, rate: 0.94 + Math.random() * 0.1, pan: side * 0.14 });
  }

  jump(surface: Surface): void {
    this.play(surface === "hard" ? "step-hard" : "step-soft", { gain: 0.09, rate: 1.08 });
    this.play("cloth", { gain: 0.07, rate: 1.1 });
  }

  land(speed: number, surface: Surface): void {
    const strength = Math.max(0.2, Math.min(1, (speed - 2.5) / 6));
    const now = this.time();
    this.play("land", { gain: 0.4 * strength });
    this.play(surface === "hard" ? "step-hard" : "step-soft", { gain: 0.2 * strength, pan: -0.12, when: now });
    this.play(surface === "hard" ? "step-hard" : "step-soft", { gain: 0.17 * strength, pan: 0.12, when: now + 0.03 });
  }

  // Sliding: a scrape that dulls and fades as the slide bleeds off speed.
  slide(surface: Surface): void {
    this.stopSlide();
    this.play("cloth", { gain: 0.1, rate: 1.1 });
    this.slideVoice = this.scrape(surface, 0.17);
  }

  stopSlide(): void {
    const voice = this.slideVoice, context = this.context;
    this.slideVoice = null;
    if (!voice || !context) return;
    const now = context.currentTime;
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setValueAtTime(Math.max(0.0001, voice.gain.gain.value), now);
    voice.gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
    voice.source.stop(now + 0.1);
  }

  // A boot on a steel rung.
  ladderStep(): void { this.play("impact-metal", { gain: 0.1, rate: 0.75 + Math.random() * 0.1 }); }

  // Mantling: hands grab the ledge, clothing drags, a foot plants on top.
  mantle(): void {
    const now = this.time();
    this.play("grab", { gain: 0.16, when: now });
    this.play("cloth", { gain: 0.12, when: now + 0.1, rate: 0.9 });
    this.play("step-hard", { gain: 0.13, when: now + 0.38, rate: 0.9 });
  }

  // HUD confirmation: a short tick for a hit, a metallic ring for a headshot, and a
  // heavier thunk with a bright ring for an elimination.
  hitConfirm(headshot: boolean, kill: boolean): void {
    if (!this.live()) return;
    this.tick(kill ? 0.32 : 0.36);
    if (headshot) this.ring([2650, 3980, 5370], [0.12, 0.07, 0.04], 0.07, 0.01);
    if (kill) {
      this.tone(170, 58, 0.16, 0.22);
      this.ring([1760, 2640], [0.09, 0.05], 0.11, 0.07);
    }
  }

  hurt(damage: number, fatal: boolean): void {
    const context = this.live();
    if (!context) return;
    this.play("hurt", { gain: Math.min(1, 0.55 + damage / 60), rate: 0.9 + Math.random() * 0.1 });
    this.thump(0.6);
    if (this.down) return;
    const now = context.currentTime;
    this.muffle.frequency.cancelScheduledValues(now);
    this.muffle.frequency.setValueAtTime(fatal ? 900 : 1200, now);
    if (fatal) this.muffle.frequency.exponentialRampToValueAtTime(420, now + 0.4);
    else this.muffle.frequency.exponentialRampToValueAtTime(20000, now + 0.45);
  }

  // Muffle everything while eliminated; clear it on respawn.
  setDown(down: boolean): void {
    if (down === this.down) return;
    this.down = down;
    if (down) this.cancelReload();
    const context = this.context;
    if (!context) return;
    const now = context.currentTime;
    this.muffle.frequency.cancelScheduledValues(now);
    this.muffle.frequency.setValueAtTime(this.muffle.frequency.value, now);
    this.muffle.frequency.exponentialRampToValueAtTime(down ? 420 : 20000, now + (down ? 0.4 : 0.25));
  }

  // Other players -----------------------------------------------------------------------

  remoteFire(weapon: WeaponKind, at: Vec3): void {
    if (!this.live()) return;
    const distance = this.distanceTo(at);
    if (weapon === "knife") { this.swing(at); return; }
    const name: SoundName = weapon === "pistol" ? distance < 14 ? "pistol-near" : "pistol-far" : distance < 14 ? "rifle-near" : "rifle-far";
    this.spatial(name, at, { gain: weapon === "pistol" ? 1 : 0.95, ref: 7, rolloff: 0.95, rate: 0.97 + Math.random() * 0.06, reverb: 0.3 + 0.35 * Math.min(1, distance / 60), priority: "high" });
  }

  remoteStep(at: Vec3, surface: Surface, gait: Gait, occluded: boolean): void {
    const gain = gait === "run" ? 0.45 : gait === "walk" ? 0.3 : 0.08;
    this.spatial(surface === "hard" ? "step-hard" : "step-soft", at, { gain, ref: 2, rolloff: 1.6, rate: 0.94 + Math.random() * 0.1, occluded });
  }

  remoteLand(at: Vec3, surface: Surface): void {
    this.spatial("land", at, { gain: 0.4, ref: 2, rolloff: 1.5 });
    this.spatial(surface === "hard" ? "step-hard" : "step-soft", at, { gain: 0.3, ref: 2, rolloff: 1.5 });
  }

  remoteSlide(at: Vec3, surface: Surface): void {
    if (this.distanceTo(at) > 35) return;
    this.scrape(surface, 0.4, at);
  }

  remoteReload(weapon: WeaponKind, at: Vec3): void {
    if (weapon === "knife") return;
    this.spatial(weapon === "pistol" ? "reload-pistol" : "reload-rifle", at, { gain: 0.45, ref: 2.5, rolloff: 1.4, priority: "high" });
  }

  remotePickup(at: Vec3): void {
    this.spatial("grab", at, { gain: 0.35, ref: 2, rolloff: 1.5 });
    this.spatial("mag-in", at, { gain: 0.4, ref: 2, rolloff: 1.5, when: this.time() + 0.17 });
  }

  // A bullet striking a body: knife cuts add a slice over the blow.
  bodyHit(at: Vec3, knife: boolean): void {
    this.spatial("body-hit", at, { gain: 0.75, ref: 3, rolloff: 1.3, priority: "high" });
    if (knife) this.spatial("knife-hit", at, { gain: 0.55, ref: 3, rolloff: 1.3, priority: "high" });
  }

  bodyFall(at: Vec3): void {
    this.spatial("land", at, { gain: 0.9, ref: 3, rolloff: 1.3, when: this.time() + 0.45, priority: "high" });
  }

  // A round striking a surface, by what the surface is made of.
  impact(material: Material, at: Vec3): void {
    const name = IMPACT_SOUND[material];
    if (!name || this.distanceTo(at) > 45) return;
    this.spatial(name, at, { gain: name === "bullet-impact" ? 0.55 : 0.5, ref: 2.5, rolloff: 1.4, rate: 0.95 + Math.random() * 0.15 });
  }

  // Objects breaking apart.
  shatter(at: Vec3): void { this.spatial("glass-break", at, { gain: 0.7, ref: 3, rolloff: 1.2, rate: 0.95 + Math.random() * 0.1, priority: "high" }); }
  splinter(at: Vec3): void { this.spatial("wood-break", at, { gain: 0.75, ref: 3, rolloff: 1.2, priority: "high" }); }
  crumble(at: Vec3): void {
    this.spatial("bullet-impact", at, { gain: 0.8, ref: 3, rolloff: 1.2, rate: 0.55, priority: "high" });
    this.spatial("land", at, { gain: 0.8, ref: 3, rolloff: 1.2, rate: 0.8, when: this.time() + 0.05, priority: "high" });
    this.spatial("bullet-impact", at, { gain: 0.5, ref: 3, rolloff: 1.2, rate: 0.7, when: this.time() + 0.18 });
  }

  // Pulling the pin and throwing: a ring click, then cloth as the arm swings.
  throwGrenade(at?: Vec3): void {
    if (at) { this.spatial("latch", at, { gain: 0.3, ref: 2, rolloff: 1.5, rate: 1.4 }); this.spatial("cloth", at, { gain: 0.3, ref: 2, rolloff: 1.5, when: this.time() + 0.12 }); return; }
    this.play("latch", { gain: 0.16, rate: 1.4 });
    this.play("cloth", { gain: 0.16, when: this.time() + 0.12 });
  }

  grenadeBounce(at: Vec3, speed: number): void {
    this.spatial("impact-metal", at, { gain: Math.min(0.5, 0.12 + speed * 0.04), ref: 2, rolloff: 1.4, rate: 1.3 + Math.random() * 0.2 });
  }

  // An explosion: a sharp crack, a roaring low-passed noise body and a sub-bass drop, with
  // a long street echo. Distant blasts lose the crack and keep the rumble.
  explosion(at: Vec3): void {
    const context = this.live();
    if (!context || !this.noise) return;
    const distance = this.distanceTo(at);
    const now = context.currentTime;
    const panner = this.panner(at, 6, 0.7);
    const out = new GainNode(context, { gain: 1 });
    out.connect(panner).connect(this.mix);
    out.connect(new GainNode(context, { gain: 0.6 + Math.min(0.4, distance / 60) })).connect(this.reverb);
    const crack = this.noiseSource(now, 0.05);
    const crackGain = new GainNode(context, { gain: 0 });
    crackGain.gain.setValueAtTime(Math.max(0.05, 1 - distance / 50), now);
    crackGain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
    crack.connect(new BiquadFilterNode(context, { type: "highpass", frequency: 1800 })).connect(crackGain).connect(out);
    const body = new AudioBufferSourceNode(context, { buffer: this.noise, loop: true });
    const bodyFilter = new BiquadFilterNode(context, { type: "lowpass", frequency: 3200, Q: 0.7 });
    bodyFilter.frequency.setValueAtTime(3200 * Math.max(0.3, 1 - distance / 80), now);
    bodyFilter.frequency.exponentialRampToValueAtTime(160, now + 1.6);
    const bodyGain = new GainNode(context, { gain: 0 });
    bodyGain.gain.setValueAtTime(0.0001, now);
    bodyGain.gain.exponentialRampToValueAtTime(1.1, now + 0.012);
    bodyGain.gain.exponentialRampToValueAtTime(0.25, now + 0.35);
    bodyGain.gain.exponentialRampToValueAtTime(0.001, now + 2.2);
    body.connect(bodyFilter).connect(bodyGain).connect(out);
    body.start(now, Math.random() * 0.5);
    body.stop(now + 2.3);
    const sub = new OscillatorNode(context, { type: "sine", frequency: 70 });
    sub.frequency.exponentialRampToValueAtTime(28, now + 0.6);
    const subGain = new GainNode(context, { gain: 0 });
    subGain.gain.setValueAtTime(0.9, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.7);
    sub.connect(subGain).connect(out);
    sub.start(now);
    sub.stop(now + 0.75);
  }

  // A round passing close to the listener: a sharp supersonic crack and a short whiz.
  nearMiss(at: Vec3, missDistance: number): void {
    const context = this.live();
    if (!context || !this.noise) return;
    const strength = Math.max(0.25, 1 - missDistance / 3);
    const panner = this.panner(at, 1, 1);
    panner.connect(this.mix);
    const now = context.currentTime;
    const crack = this.noiseSource(now, 0.012);
    const crackFilter = new BiquadFilterNode(context, { type: "highpass", frequency: 2600 });
    const crackGain = new GainNode(context, { gain: 0 });
    crackGain.gain.setValueAtTime(0.9 * strength, now);
    crackGain.gain.exponentialRampToValueAtTime(0.001, now + 0.012);
    crack.connect(crackFilter).connect(crackGain).connect(panner);
    const whiz = this.noiseSource(now + 0.004, 0.16);
    const whizFilter = new BiquadFilterNode(context, { type: "bandpass", frequency: 4200, Q: 6 });
    whizFilter.frequency.setValueAtTime(4200, now);
    whizFilter.frequency.exponentialRampToValueAtTime(1700, now + 0.16);
    const whizGain = new GainNode(context, { gain: 0 });
    whizGain.gain.setValueAtTime(0.0001, now);
    whizGain.gain.exponentialRampToValueAtTime(0.35 * strength, now + 0.03);
    whizGain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    whiz.connect(whizFilter).connect(whizGain).connect(panner);
  }

  // Internals ---------------------------------------------------------------------------

  private live(): AudioContext | null {
    return this.context && this.context.state === "running" ? this.context : null;
  }

  private time(): number { return this.context?.currentTime ?? 0; }

  private async load(): Promise<void> {
    const OfflineContext = window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
    if (!OfflineContext) return;
    const decoder = new OfflineContext(1, 1, SAMPLE_RATE);
    const base = `${import.meta.env.BASE_URL}audio/`;
    await Promise.all(Object.entries(BANK).map(async ([name, count]) => {
      const variants = await Promise.all(Array.from({ length: count }, async (_, index) => {
        try {
          const response = await fetch(`${base}${name}${count > 1 ? `-${index + 1}` : ""}.mp3`);
          if (!response.ok) return null;
          const buffer = await decoder.decodeAudioData(await response.arrayBuffer());
          return { buffer, offset: this.onset(buffer) };
        } catch {
          return null;
        }
      }));
      const loaded = variants.filter((sample): sample is Sample => sample !== null);
      if (loaded.length) this.samples.set(name as SoundName, loaded);
    }));
  }

  // Skip MP3 encoder padding and leading silence so shots start on their attack.
  private onset(buffer: AudioBuffer): number {
    const data = buffer.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < data.length; i += 1) peak = Math.max(peak, Math.abs(data[i]));
    const threshold = peak * 0.05;
    for (let i = 0; i < data.length; i += 1) if (Math.abs(data[i]) > threshold) return Math.max(0, i / buffer.sampleRate - 0.0015);
    return 0;
  }

  private build(context: AudioContext): void {
    this.master = new GainNode(context, { gain: this.muted ? 0 : MASTER });
    // A fast limiter on the top 8 dB keeps stacked gunfire from clipping. Web Audio adds
    // make-up gain from the curve (about +4.4 dB here), so quiet sounds keep their level
    // relative to each other and MASTER brings the whole mix back down.
    const compressor = new DynamicsCompressorNode(context, { threshold: -8, knee: 6, ratio: 12, attack: 0.001, release: 0.15 });
    this.muffle = new BiquadFilterNode(context, { type: "lowpass", frequency: 20000, Q: 0.5 });
    this.mix = new GainNode(context, { gain: 1 });
    this.ui = new GainNode(context, { gain: 1 });
    this.reverb = new GainNode(context, { gain: 1 });
    const convolver = new ConvolverNode(context, { buffer: streetImpulse(context) });
    const wet = new GainNode(context, { gain: 0.55 });
    this.mix.connect(this.muffle);
    this.reverb.connect(convolver).connect(wet).connect(this.muffle);
    this.muffle.connect(compressor);
    compressor.connect(this.master).connect(context.destination);
    // Hit confirmation joins after the limiter so a loud shot cannot push it down. The
    // limiter keeps gunfire near -4 dBFS, leaving headroom for these short ticks.
    this.ui.connect(this.master);
    const noise = context.createBuffer(1, context.sampleRate, context.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    this.noise = noise;
  }

  private pick(name: SoundName): Sample | null {
    const variants = this.samples.get(name);
    if (!variants?.length) return null;
    const last = this.lastVariant.get(name) ?? -1;
    let index = Math.floor(Math.random() * variants.length);
    if (variants.length > 1 && index === last) index = (index + 1) % variants.length;
    this.lastVariant.set(name, index);
    return variants[index];
  }

  private source(name: SoundName, options: PlayOptions): { source: AudioBufferSourceNode; gain: GainNode } | null {
    const context = this.live();
    const sample = this.pick(name);
    if (!context || !sample) return null;
    const source = new AudioBufferSourceNode(context, { buffer: sample.buffer, playbackRate: options.rate ?? 1 });
    const gain = new GainNode(context, { gain: options.gain ?? 1 });
    source.connect(gain);
    if (options.reverb) gain.connect(new GainNode(context, { gain: options.reverb })).connect(this.reverb);
    source.start(Math.max(context.currentTime, options.when ?? 0), sample.offset);
    return { source, gain };
  }

  private play(name: SoundName, options: PlayOptions = {}): AudioBufferSourceNode | null {
    const voice = this.source(name, options);
    if (!voice) return null;
    let output: AudioNode = voice.gain;
    if (options.pan) output = output.connect(new StereoPannerNode(this.context!, { pan: options.pan }));
    output.connect(options.bus ?? this.mix);
    return voice.source;
  }

  private panner(at: Vec3, ref: number, rolloff: number): PannerNode {
    return new PannerNode(this.context!, {
      panningModel: "HRTF", distanceModel: "inverse", refDistance: ref, rolloffFactor: rolloff, maxDistance: 400,
      positionX: at.x, positionY: at.y, positionZ: at.z,
    });
  }

  // Positioned one-shot: air absorption with distance and a low-pass behind cover.
  private spatial(name: SoundName, at: Vec3, options: SpatialOptions = {}): void {
    const context = this.live();
    if (!context) return;
    const priority = options.priority ?? "low";
    if (this.spatialVoices.length >= MAX_SPATIAL_VOICES) {
      const oldest = this.spatialVoices.findIndex((voice) => voice.priority === "low" || priority === "high");
      if (oldest < 0) return;
      this.spatialVoices.splice(oldest, 1)[0].source.stop();
    }
    const distance = this.distanceTo(at);
    const occluded = options.occluded ?? this.occlusion(this.listenerAt, at);
    const voice = this.source(name, { ...options, gain: (options.gain ?? 1) * (occluded ? 0.55 : 1) });
    if (!voice) return;
    const air = new BiquadFilterNode(context, { type: "lowpass", frequency: Math.max(2400, 18000 * Math.exp(-distance / 90)), Q: 0.4, channelCount: 1, channelCountMode: "explicit" });
    let chain: AudioNode = voice.gain.connect(air);
    if (occluded) chain = chain.connect(new BiquadFilterNode(context, { type: "lowpass", frequency: 1100, Q: 0.5 }));
    chain.connect(this.panner(at, options.ref ?? 2, options.rolloff ?? 1)).connect(this.mix);
    const entry = { source: voice.source, priority };
    this.spatialVoices.push(entry);
    voice.source.addEventListener("ended", () => {
      const index = this.spatialVoices.indexOf(entry);
      if (index >= 0) this.spatialVoices.splice(index, 1);
    });
  }

  private noiseSource(when: number, duration: number): AudioBufferSourceNode {
    const source = new AudioBufferSourceNode(this.context!, { buffer: this.noise });
    source.start(when, Math.random() * 0.5, duration);
    return source;
  }

  // Low sine drop under the shooter's own shots and under hits taken.
  private thump(level: number): void {
    this.tone(78, 36, 0.13, level, this.mix);
  }

  private tone(from: number, to: number, duration: number, level: number, bus: AudioNode = this.ui): void {
    const context = this.live();
    if (!context) return;
    const now = context.currentTime;
    const oscillator = new OscillatorNode(context, { type: "sine", frequency: from });
    oscillator.frequency.exponentialRampToValueAtTime(to, now + duration);
    const gain = new GainNode(context, { gain: 0 });
    gain.gain.setValueAtTime(level, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    oscillator.connect(gain).connect(bus);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }

  private tick(level: number): void {
    const context = this.live();
    if (!context || !this.noise) return;
    const now = context.currentTime;
    const click = this.noiseSource(now, 0.014);
    const filter = new BiquadFilterNode(context, { type: "highpass", frequency: 2400 });
    const gain = new GainNode(context, { gain: 0 });
    gain.gain.setValueAtTime(level, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.014);
    click.connect(filter).connect(gain).connect(this.ui);
    this.ring([2100], [level * 0.35], 0.018, 0);
  }

  // Decaying sine partials; inharmonic ratios read as metal.
  private ring(frequencies: number[], levels: number[], decay: number, delay: number): void {
    const context = this.live();
    if (!context) return;
    const start = context.currentTime + delay;
    frequencies.forEach((frequency, index) => {
      const oscillator = new OscillatorNode(context, { type: "sine", frequency });
      const gain = new GainNode(context, { gain: 0 });
      gain.gain.setValueAtTime(levels[index], start);
      gain.gain.exponentialRampToValueAtTime(0.0005, start + decay * 6);
      oscillator.connect(gain).connect(this.ui);
      oscillator.start(start);
      oscillator.stop(start + decay * 6 + 0.02);
    });
  }

  // Looping noise, band-passed for concrete grit or low-passed for grass, decaying over
  // the length of a slide. Played at the listener, or positioned for another player.
  private scrape(surface: Surface, level: number, at?: Vec3): { source: AudioBufferSourceNode; gain: GainNode } | null {
    const context = this.live();
    if (!context || !this.noise) return null;
    const now = context.currentTime;
    const source = new AudioBufferSourceNode(context, { buffer: this.noise, loop: true });
    const hard = surface === "hard";
    const filter = new BiquadFilterNode(context, { type: hard ? "bandpass" : "lowpass", frequency: hard ? 1500 : 750, Q: hard ? 0.9 : 0.6 });
    filter.frequency.setValueAtTime(hard ? 1500 : 750, now);
    filter.frequency.exponentialRampToValueAtTime(hard ? 700 : 420, now + 0.85);
    const gain = new GainNode(context, { gain: 0 });
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(level, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(level * 0.25, now + 0.85);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.3);
    source.connect(filter).connect(gain);
    if (at) gain.connect(this.panner(at, 2, 1.6)).connect(this.mix);
    else gain.connect(this.mix);
    source.start(now, Math.random() * 0.5);
    source.stop(now + 1.35);
    return { source, gain };
  }

  // Knife swing: band-passed noise swept up then down, moving right to left for the
  // player's own swing and positioned for other players.
  private swing(at?: Vec3): void {
    const context = this.live();
    if (!context || !this.noise) return;
    const now = context.currentTime;
    const source = this.noiseSource(now, 0.26);
    const filter = new BiquadFilterNode(context, { type: "bandpass", frequency: 500, Q: 1.3 });
    filter.frequency.setValueAtTime(500, now);
    filter.frequency.exponentialRampToValueAtTime(2300, now + 0.09);
    filter.frequency.exponentialRampToValueAtTime(650, now + 0.26);
    const gain = new GainNode(context, { gain: 0 });
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(at ? 0.5 : 0.55, now + 0.07);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.26);
    source.connect(filter).connect(gain);
    if (at) gain.connect(this.panner(at, 2, 1.5)).connect(this.mix);
    else {
      const pan = new StereoPannerNode(context, { pan: 0.35 });
      pan.pan.linearRampToValueAtTime(-0.3, now + 0.24);
      gain.connect(pan).connect(this.mix);
    }
  }
}

export const gameAudio = new GameAudio();
