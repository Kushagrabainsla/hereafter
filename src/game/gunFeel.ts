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

export interface WeaponFeel {
  recoil: RecoilFeel;
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
  },
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
