import { type WeaponKind } from "./combatRules";

// Gun feel. Every number that shapes how the guns handle is in the table below, so the feel
// can be tuned in one place. The classes under the table turn those numbers into motion; none
// of them knows about the renderer or the network. docs/movement.md says how each part was
// measured.

export interface RecoilFeel {
  // What each shot of a burst adds to the view, in degrees: [up, right]. When a burst is longer
  // than the list, it goes round again from row `loop`.
  pattern: [number, number][];
  loop: number;
  // A random amount added to each shot, in degrees to either side.
  pitchJitter: number;
  yawJitter: number;
  // How fast the view goes to each new kick, in 1/s. The kick is 95% there after 3 / attack s.
  attack: number;
  // The view starts to return this long after the last shot (s), at this rate (1/s). It is
  // 95% back after 3 / recovery s.
  rest: number;
  recovery: number;
  // After this long without a shot (s) the next shot starts the pattern again.
  reset: number;
  // The most the view can climb above the aim, and turn to either side of it, in degrees.
  maxPitch: number;
  maxYaw: number;
  // The share of the recoil that is left while the player aims down the sights, and crouches.
  aimed: number;
  crouched: number;
}

export interface KickFeel {
  // How far the gun moves in the hands for one shot: back and up in metres; muzzle up, to a
  // random side, and rolled to a random side, in radians.
  back: number;
  up: number;
  pitch: number;
  yaw: number;
  roll: number;
  // The time from the shot to the peak of the kick, in milliseconds. The gun is back to rest
  // after about 6 times this.
  peakMs: number;
  // How much each shot differs from the last: 0.2 is 20% more or less.
  vary: number;
  // The share of the kick that is left while the player aims down the sights.
  aimed: number;
}

export interface FlashFeel {
  // How long the flash shows, in milliseconds. It always shows for one whole frame, so at 60
  // frames a second 30 ms is two frames.
  ms: number;
  // The flash is drawn between these sizes (1 is the modelled size), at a random roll about the
  // barrel, and stretched along the barrel by up to `stretch` more or less.
  size: [number, number];
  stretch: number;
  // The puff of smoke left at the muzzle: how long it lasts (s), how wide it grows (m), how far
  // it drifts forward and up (m), and how dense it starts (0 to 1).
  smokeSeconds: number;
  smokeSize: number;
  smokeDrift: number;
  smokeOpacity: number;
}

export interface WeaponFeel {
  recoil: RecoilFeel;
  kick: KickFeel;
  flash: FlashFeel;
  // The camera trauma one shot adds (see SHAKE).
  shake: number;
  // The time to bring the sights up, or to take them down, in seconds.
  aimSeconds: number;
}

export const GUN_FEEL: Record<WeaponKind, WeaponFeel> = {
  pistol: {
    recoil: {
      pattern: [[1.5, 0.1], [1.35, -0.2], [1.25, 0.25], [1.15, -0.15]],
      loop: 1,
      pitchJitter: 0.15,
      yawJitter: 0.4,
      attack: 40,
      rest: 0.1,
      recovery: 10,
      reset: 0.45,
      maxPitch: 8,
      maxYaw: 2.5,
      aimed: 0.7,
      crouched: 0.8,
    },
    kick: { back: 0.035, up: 0.012, pitch: 0.09, yaw: 0.02, roll: 0.035, peakMs: 28, vary: 0.2, aimed: 0.3 },
    flash: { ms: 30, size: [0.8, 1.3], stretch: 0.3, smokeSeconds: 0.45, smokeSize: 0.2, smokeDrift: 0.1, smokeOpacity: 0.85 },
    shake: 0.3,
    aimSeconds: 0.17,
  },
  rifle: {
    recoil: {
      // A carbine on automatic: it climbs hard for four shots, then wanders right and back left.
      pattern: [
        [0.95, 0.05], [0.9, -0.1], [0.85, 0.15], [0.75, 0.25], [0.6, 0.35], [0.45, 0.3], [0.35, 0.1], [0.3, -0.2],
        [0.3, -0.4], [0.25, -0.45], [0.25, -0.3], [0.3, -0.05], [0.3, 0.25], [0.25, 0.4], [0.25, 0.3], [0.3, 0.0],
      ],
      loop: 6,
      pitchJitter: 0.1,
      yawJitter: 0.22,
      attack: 34,
      rest: 0.16,
      recovery: 8,
      reset: 0.4,
      maxPitch: 7,
      maxYaw: 3,
      aimed: 0.75,
      crouched: 0.8,
    },
    kick: { back: 0.028, up: 0.008, pitch: 0.07, yaw: 0.012, roll: 0.03, peakMs: 26, vary: 0.25, aimed: 0.3 },
    flash: { ms: 28, size: [0.85, 1.35], stretch: 0.3, smokeSeconds: 0.55, smokeSize: 0.26, smokeDrift: 0.14, smokeOpacity: 0.9 },
    shake: 0.26,
    aimSeconds: 0.24,
  },
};

// Aiming down the sights. The sights come up in the weapon's `aimSeconds`, eased at both ends.
// The view's own field of view (wider in a sprint, narrower in a crouch) eases at `fovRate`, in
// 1/s. The zoom of the sights does not ease on its own: it follows the aim (0 to 1) directly, and
// so does the lens the gun is drawn through, so the gun never changes size on screen while the
// sights come up. The crosshair fades out as the sights come up. The steadier aim, the smaller
// recoil and the "aiming" flag sent to other players start when the sights are `ready` of the
// way up.
export const AIM = {
  fovRate: 7,
  ready: 0.9,
};

// The camera's shake. Anything violent adds "trauma" (0 to 1): a shot, a blast, a hit, a hard
// landing. The shake is the square of the trauma, so small knocks barely show and big ones are
// strong, and the trauma drains away at a steady rate. The motion is smooth noise on pitch, yaw
// and roll, not a new random jolt each frame. It turns the picture only: shots still leave along
// the aim.
export const SHAKE = {
  // The most the view turns at full trauma, in degrees, on each axis.
  pitch: 2.4,
  yaw: 1.8,
  roll: 3,
  // How fast the noise moves, in cycles per second.
  frequency: 5,
  // How much trauma drains each second.
  decay: 1.3,
  // A blast adds this much at its centre, falling to nothing at `blastReach` metres.
  blast: 1,
  blastReach: 24,
  // A hit adds this much for each point of damage, up to `hitMost`.
  hit: 0.012,
  hitMost: 0.55,
};

// The dip of the view when the player lands: the eyes drop, then come back up.
export const LANDING = {
  // A landing slower than this (m/s) does not dip the view.
  from: 2.5,
  // Metres of dip for each m/s above that, up to `most` metres.
  perSpeed: 0.022,
  most: 0.16,
  // The time from the landing to the lowest point, in milliseconds.
  peakMs: 70,
  // Trauma added for each m/s above `from` (see SHAKE).
  shake: 0.04,
};

const signed = (): number => Math.random() * 2 - 1;

// The recoil of the view: an offset in degrees (up and right) on top of where the player aims.
// Shots push a target along the weapon's pattern, the offset chases the target, and the target
// drains back to nothing once the trigger rests. Mouse movement against the recoil uses it up,
// so a player who holds the sights on target through a burst is not thrown downward after it.
export class Recoil {
  pitch = 0;
  yaw = 0;
  private targetPitch = 0;
  private targetYaw = 0;
  private shot = 0;
  private sinceShot = Infinity;
  private feel: RecoilFeel = GUN_FEEL.pistol.recoil;

  fire(weapon: WeaponKind, aiming: boolean, crouching: boolean): void {
    const feel = this.feel = GUN_FEEL[weapon].recoil;
    const index = this.sinceShot > feel.reset ? 0 : this.shot;
    const span = feel.pattern.length - feel.loop;
    const row = feel.pattern[index < feel.pattern.length ? index : feel.loop + (index - feel.pattern.length) % span];
    const scale = (aiming ? feel.aimed : 1) * (crouching ? feel.crouched : 1);
    this.targetPitch = Math.min(feel.maxPitch, this.targetPitch + (row[0] + signed() * feel.pitchJitter) * scale);
    this.targetYaw = Math.max(-feel.maxYaw, Math.min(feel.maxYaw, this.targetYaw + (row[1] + signed() * feel.yawJitter) * scale));
    this.shot = index + 1;
    this.sinceShot = 0;
  }

  update(seconds: number): void {
    const feel = this.feel;
    this.sinceShot += seconds;
    if (this.sinceShot > feel.rest) {
      const keep = Math.exp(-seconds * feel.recovery);
      this.targetPitch *= keep;
      this.targetYaw *= keep;
    }
    const chase = 1 - Math.exp(-seconds * feel.attack);
    this.pitch += (this.targetPitch - this.pitch) * chase;
    this.yaw += (this.targetYaw - this.yaw) * chase;
    if (Math.abs(this.pitch) < 0.001 && Math.abs(this.targetPitch) < 0.001) this.pitch = this.targetPitch = 0;
    if (Math.abs(this.yaw) < 0.001 && Math.abs(this.targetYaw) < 0.001) this.yaw = this.targetYaw = 0;
  }

  // The player turned the view by these degrees (up and right). The part of the turn that goes
  // against the recoil is taken out of the recoil; the rest is returned, to turn the aim.
  absorb(up: number, right: number): { up: number; right: number } {
    if (up < 0 && this.pitch > 0) {
      const used = Math.min(-up, this.pitch);
      this.pitch -= used;
      this.targetPitch = Math.max(0, this.targetPitch - used);
      up += used;
    }
    if (right !== 0 && Math.sign(right) === -Math.sign(this.yaw)) {
      const used = Math.min(Math.abs(right), Math.abs(this.yaw)) * Math.sign(this.yaw);
      this.yaw -= used;
      if (Math.sign(this.targetYaw) === Math.sign(used)) this.targetYaw = Math.sign(used) * Math.max(0, Math.abs(this.targetYaw) - Math.abs(used));
      right += used;
    }
    return { up, right };
  }

  reset(): void {
    this.pitch = this.yaw = this.targetPitch = this.targetYaw = 0;
    this.shot = 0;
    this.sinceShot = Infinity;
  }
}

// One axis of a spring that takes a kick and comes back to rest without ringing: critically
// damped, so it peaks 1 / omega seconds after the kick and is back after about 6 / omega.
class KickAxis {
  value = 0;
  private speed = 0;
  // A kick that takes the axis to `peak` at its highest.
  hit(peak: number, omega: number): void { this.speed += peak * omega * Math.E; }
  step(seconds: number, omega: number): void {
    // Small fixed steps keep the spring the same at any frame rate.
    for (let left = seconds; left > 0; left -= 1 / 480) {
      const dt = Math.min(left, 1 / 480);
      this.speed += (-omega * omega * this.value - 2 * omega * this.speed) * dt;
      this.value += this.speed * dt;
    }
  }
  reset(): void { this.value = this.speed = 0; }
}

export interface KickPose { back: number; up: number; pitch: number; yaw: number; roll: number }

// The kick of the gun in the hands: each shot throws it back and up and tips the muzzle, a
// little differently every time, and a spring brings it home. Shots that come faster than the
// spring settles stack, so automatic fire rides back and shudders. In place of the fire clip,
// whose keys were the same for every shot.
export class GunKick {
  private axes = { back: new KickAxis(), up: new KickAxis(), pitch: new KickAxis(), yaw: new KickAxis(), roll: new KickAxis() };
  private omega = 1000 / GUN_FEEL.pistol.kick.peakMs;
  readonly pose: KickPose = { back: 0, up: 0, pitch: 0, yaw: 0, roll: 0 };

  // aim is how far the sights are up, 0 to 1.
  fire(weapon: WeaponKind, aim: number): void {
    const feel = GUN_FEEL[weapon].kick, scale = 1 - (1 - feel.aimed) * aim, vary = (): number => 1 + signed() * feel.vary;
    this.omega = 1000 / feel.peakMs;
    this.axes.back.hit(feel.back * scale * vary(), this.omega);
    this.axes.up.hit(feel.up * scale * vary(), this.omega);
    this.axes.pitch.hit(feel.pitch * scale * vary(), this.omega);
    this.axes.yaw.hit(feel.yaw * scale * signed(), this.omega);
    this.axes.roll.hit(feel.roll * scale * signed(), this.omega);
  }

  update(seconds: number): void {
    const step = Math.min(seconds, 0.1);
    for (const key of ["back", "up", "pitch", "yaw", "roll"] as const) {
      this.axes[key].step(step, this.omega);
      this.pose[key] = this.axes[key].value;
    }
  }

  reset(): void {
    for (const axis of Object.values(this.axes)) axis.reset();
    this.pose.back = this.pose.up = this.pose.pitch = this.pose.yaw = this.pose.roll = 0;
  }
}

// The camera's shake (see SHAKE): turns of the view in degrees, to add after the player's own.
export class ViewShake {
  trauma = 0;
  private time = Math.random() * 100;
  readonly turn = { pitch: 0, yaw: 0, roll: 0 };

  add(amount: number): void { this.trauma = Math.min(1, this.trauma + Math.max(0, amount)); }

  // Smooth noise between -1 and 1: three sine waves that never line up.
  private noise(seed: number): number {
    const t = this.time * SHAKE.frequency * Math.PI * 2;
    return (Math.sin(t + seed) + Math.sin(t * 1.618 + seed * 2.3) * 0.7 + Math.sin(t * 0.437 + seed * 4.1) * 0.5) / 2.2;
  }

  update(seconds: number): void {
    this.time += seconds;
    this.trauma = Math.max(0, this.trauma - SHAKE.decay * seconds);
    const shake = this.trauma * this.trauma;
    this.turn.pitch = SHAKE.pitch * shake * this.noise(1.3);
    this.turn.yaw = SHAKE.yaw * shake * this.noise(7.7);
    this.turn.roll = SHAKE.roll * shake * this.noise(13.1);
  }

  reset(): void { this.trauma = 0; this.turn.pitch = this.turn.yaw = this.turn.roll = 0; }
}

// The dip of the eyes on a landing (see LANDING), in metres below their usual height.
export class LandingDip {
  private axis = new KickAxis();
  get value(): number { return this.axis.value; }
  land(speed: number): void {
    const dip = Math.min(LANDING.most, Math.max(0, speed - LANDING.from) * LANDING.perSpeed);
    if (dip > 0) this.axis.hit(dip, 1000 / LANDING.peakMs);
  }
  update(seconds: number): void { this.axis.step(Math.min(seconds, 0.1), 1000 / LANDING.peakMs); }
  reset(): void { this.axis.reset(); }
}
