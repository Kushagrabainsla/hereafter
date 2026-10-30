import { PerspectiveCamera } from "three/webgpu";
import { type Arena, type ArenaData, terrainHeight } from "../world/arena";
import { spawnPoint } from "../world/collision";
import { PhysicsWorld, type Ledge } from "../world/physics";
import { LEAN_OFFSET } from "./combatRules";
import { type Ladder } from "../world/climbing";

export interface PlayerMotion {
  moving: boolean;
  running: boolean;
  crouching: boolean;
  airborne: boolean;
  sliding: boolean;
  mantling: boolean;
  climbing: boolean;
  speed: number;
}

// Footstep and landing cues: stride advances with the head bob, and jumps and landings
// count up so listeners can tell when one happened since they last looked.
export interface PlayerGait {
  stride: number;
  grounded: boolean;
  aboveGround: number;
  jumps: number;
  landings: number;
  landingSpeed: number;
  slides: number;
  mantles: number;
  rungs: number;
}

export interface PlayerPose {
  east: number;
  north: number;
  heading: number;
  pitch: number;
  jumpHeight: number;
  moving: boolean;
  running: boolean;
  crouching: boolean;
  sliding?: boolean;
  airborne?: boolean;
  // -1 leaning fully left to 1 fully right.
  lean?: number;
}

const EYE_HEIGHT = 1.72;
const STEP_SECONDS = 1 / 60;
// A slide starts from a sprint with a burst of speed and bleeds it off over about 0.8 s
// and 5 m, then waits briefly before another slide can start.
const SLIDE_BOOST = 1.8;
const SLIDE_MAX = 10.5;
const SLIDE_FRICTION = 8.5;
const SLIDE_END_SPEED = 3.2;
const SLIDE_LONGEST = 1.3;
const SLIDE_COOLDOWN = 0.6;
const SLIDE_ROLL = -0.06;
// Leaning tilts the view this far (radians) at full lean and slows walking.
const LEAN_ROLL = 0.14;
const LEAN_SPEED = 0.7;
// Being hit jolts the aim and slows movement briefly ("tagging").
const TAG_SECONDS = 0.55;
const TAG_SLOW = 0.45;

interface Mantle { fromEast: number; fromNorth: number; fromFeet: number; to: Ledge; elapsed: number; duration: number }

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export class PlayerController {
  private arena: Arena;
  private east = 0;
  private north = 0;
  private heading = 0;
  private pitch = -4;
  private jumpHeight = 0;
  private verticalSpeed = 0;
  private velocityEast = 0;
  private velocityNorth = 0;
  private feet = 0;
  private grounded = true;
  private coyote = 0;
  private jumpBuffer = 0;
  private airTime = 0;
  private jumps = 0;
  private landings = 0;
  private landingSpeed = 0;
  private sliding = false;
  private slideTime = 0;
  private slideSpeed = 0;
  private slideEast = 0;
  private slideNorth = 0;
  private slideCooldown = 0;
  private slides = 0;
  private crouchHeld = false;
  private sprintHold = 0;
  private mantle: Mantle | null = null;
  private mantles = 0;
  private ladders: Ladder[] = [];
  private climbing: Ladder | null = null;
  private climbed = 0;
  private rungs = 0;
  private roll = 0;
  private lean = 0;
  private punchPitch = 0;
  private punchYaw = 0;
  private tagged = 0;
  private accumulator = 0;
  private eyeHeight = EYE_HEIGHT;
  private stride = 0;
  private bobAmount = 0;
  private speed = 0;
  private moving = false;
  private running = false;
  private crouching = false;
  private paused = false;
  private keys = new Set<string>();
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private spawnSlot = 0;

  constructor(private camera: PerspectiveCamera, private canvas: HTMLCanvasElement, private data: ArenaData, arena: Arena, private physics: PhysicsWorld) {
    this.arena = arena;
    canvas.tabIndex = 0;
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointercancel", this.onPointerUp);
    canvas.addEventListener("dblclick", this.requestPointerLock);
    document.addEventListener("mousemove", this.onLockedMouseMove);
    document.addEventListener("keydown", this.onKeyDown);
    document.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.clearKeys);
    this.reset(arena);
  }

  reset(arena: Arena): void {
    this.arena = arena;
    this.physics.setArena(arena);
    const spawn = spawnPoint(this.data, this.spawnSlot);
    const position = this.physics.reset(spawn.east, spawn.north);
    this.east = position.east;
    this.north = position.north;
    this.feet = position.feet;
    this.grounded = true;
    this.heading = spawn.heading;
    this.pitch = -4;
    this.jumpHeight = 0;
    this.verticalSpeed = 0;
    this.velocityEast = 0;
    this.velocityNorth = 0;
    this.coyote = 0.1;
    this.jumpBuffer = 0;
    this.airTime = 0;
    this.sliding = false;
    this.slideCooldown = 0;
    this.sprintHold = 0;
    this.mantle = null;
    this.climbing = null;
    this.roll = 0;
    this.lean = 0;
    this.punchPitch = 0;
    this.punchYaw = 0;
    this.tagged = 0;
    this.accumulator = 0;
    this.eyeHeight = EYE_HEIGHT;
    this.stride = 0;
    this.bobAmount = 0;
    this.speed = 0;
    this.moving = false;
    this.running = false;
    this.crouching = false;
    this.keys.clear();
    this.applyPose();
  }

  kickRecoil(degrees: number): void {
    this.pitch = Math.min(80, this.pitch + degrees);
    this.applyPose();
  }

  motion(): PlayerMotion {
    return { moving: this.moving, running: this.running, crouching: this.crouching, airborne: !this.grounded && !this.mantle && !this.climbing, sliding: this.sliding, mantling: this.mantle !== null, climbing: this.climbing !== null, speed: this.speed };
  }

  setLadders(ladders: Ladder[]): void { this.ladders = ladders; }

  // Taking a hit kicks the view up and to one side, by more for heavier hits, and slows
  // movement for a moment. The kick also moves where shots go until it settles.
  flinch(damage: number): void {
    this.punchPitch = Math.min(6, this.punchPitch + Math.min(3.5, 0.8 + damage * 0.05));
    this.punchYaw += (Math.random() < 0.5 ? -1 : 1) * (0.4 + Math.random() * 0.8);
    this.tagged = TAG_SECONDS;
  }

  // Firing drops a sprint; it resumes on its own once the trigger has rested this long.
  holdSprint(seconds: number): void {
    this.sprintHold = Math.max(this.sprintHold, seconds);
    if (this.running) this.running = false;
  }

  gait(): PlayerGait {
    return { stride: this.stride, grounded: this.grounded, aboveGround: this.jumpHeight, jumps: this.jumps, landings: this.landings, landingSpeed: this.landingSpeed, slides: this.slides, mantles: this.mantles, rungs: this.rungs };
  }

  pose(): PlayerPose {
    return {
      east: this.east,
      north: this.north,
      heading: (this.heading + this.punchYaw + 360) % 360,
      pitch: Math.max(-80, Math.min(80, this.pitch + this.punchPitch)),
      jumpHeight: this.jumpHeight,
      moving: this.moving,
      running: this.running,
      crouching: this.crouching,
      sliding: this.sliding,
      airborne: !this.grounded && !this.mantle,
      lean: Math.round(this.lean * 100) / 100,
    };
  }

  setSpawnSlot(slot: number): void {
    if (slot === this.spawnSlot) return;
    const standingAtSpawn = Array.from({ length: 8 }, (_, index) => spawnPoint(this.data, index))
      .some((spawn) => Math.hypot(this.east - spawn.east, this.north - spawn.north) < 1.5);
    this.spawnSlot = slot;
    if (standingAtSpawn) this.reset(this.arena);
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) {
      this.keys.clear();
      this.dragging = false;
      this.speed = 0;
      this.velocityEast = 0;
      this.velocityNorth = 0;
      this.accumulator = 0;
      this.jumpBuffer = 0;
      this.moving = false;
      this.running = false;
      this.crouching = false;
      this.sliding = false;
      if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    }
  }

  update(seconds: number): void {
    if (this.paused) return;
    const delta = Math.min(seconds, 0.1);
    this.accumulator = Math.min(0.15, this.accumulator + delta);
    while (this.accumulator >= STEP_SECONDS) {
      this.fixedUpdate(STEP_SECONDS);
      this.accumulator -= STEP_SECONDS;
    }
    const eyeTarget = this.sliding ? 0.98 : this.crouching ? 1.12 : this.mantle ? 1.5 : EYE_HEIGHT;
    this.eyeHeight += (eyeTarget - this.eyeHeight) * Math.min(1, delta * (this.sliding ? 14 : 10));
    this.bobAmount += ((this.moving && this.grounded && !this.sliding ? 1 : 0) - this.bobAmount) * Math.min(1, delta * 8);
    if (this.moving && !this.sliding) this.stride += this.speed * delta * (this.running ? 2.1 : 1.7);
    this.roll += ((this.sliding ? SLIDE_ROLL : 0) - this.roll) * Math.min(1, delta * 9);
    const settle = Math.exp(-delta * 8);
    this.punchPitch *= settle;
    this.punchYaw *= settle;
    this.tagged = Math.max(0, this.tagged - delta);
    const targetFov = this.sliding ? 82 : this.running ? 80 : this.crouching ? 72 : 75;
    if (Math.abs(this.camera.fov - targetFov) > 0.01) {
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, delta * 7);
      this.camera.updateProjectionMatrix();
    }
    this.applyPose();
  }

  private fixedUpdate(delta: number): void {
    this.slideCooldown = Math.max(0, this.slideCooldown - delta);
    this.sprintHold = Math.max(0, this.sprintHold - delta);
    this.jumpBuffer = Math.max(0, this.jumpBuffer - delta);
    if (this.mantle) { this.stepMantle(delta); return; }
    const forward = Number(this.keys.has("w") || this.keys.has("arrowup")) - Number(this.keys.has("s") || this.keys.has("arrowdown"));
    const strafe = Number(this.keys.has("d") || this.keys.has("arrowright")) - Number(this.keys.has("a") || this.keys.has("arrowleft"));
    const crouchKey = this.keys.has("c") || this.keys.has("control");
    const crouchPressed = crouchKey && !this.crouchHeld;
    this.crouchHeld = crouchKey;
    const heading = this.heading * Math.PI / 180;
    if (this.climbing) { this.stepLadder(delta, forward); return; }
    // Walking into a ladder while facing the wall takes hold of it.
    if (forward > 0 && !this.sliding && !crouchKey) {
      const ladder = this.ladderInReach(heading);
      if (ladder && !this.physics.setCrouched(false)) {
        this.climbing = ladder;
        this.crouching = false;
        this.velocityEast = this.velocityNorth = this.verticalSpeed = 0;
        return;
      }
    }
    // Mantle when jumping at a ledge, or when pushing forward into one in the air.
    if ((this.jumpBuffer > 0 || (!this.grounded && forward > 0 && this.verticalSpeed < 3)) && !this.sliding && this.tryMantle(heading)) return;
    // Crouching during a sprint starts a slide; letting go, leaving the ground, slowing
    // down or jumping ends it. A jump keeps the slide's speed.
    if (crouchPressed && this.running && this.grounded && this.slideCooldown <= 0 && this.speed > 6) this.startSlide();
    const jumpFromSlide = this.sliding && this.jumpBuffer > 0;
    if (this.sliding) {
      this.slideTime += delta;
      this.slideSpeed = Math.max(0, this.slideSpeed - SLIDE_FRICTION * delta);
      if (!crouchKey || !this.grounded || this.slideSpeed < SLIDE_END_SPEED || this.slideTime > SLIDE_LONGEST || jumpFromSlide) this.endSlide();
    }
    this.crouching = this.physics.setCrouched((crouchKey && !jumpFromSlide) || this.sliding);
    const wantsRun = this.keys.has("shift") && !this.crouching && this.sprintHold <= 0;
    // Q and E lean while walking or standing; a wall at the side limits how far.
    const leanInput = this.running || this.sliding || !this.grounded ? 0 : Number(this.keys.has("e")) - Number(this.keys.has("q"));
    this.lean += (leanInput - this.lean) * Math.min(1, delta * 8);
    if (Math.abs(this.lean) > 0.01) {
      const side = Math.sign(this.lean);
      const head = { x: this.east, y: this.feet + this.eyeHeight, z: this.north };
      const reach = this.physics.traceShot({ origin: head, direction: { x: -Math.cos(heading) * side, y: 0, z: Math.sin(heading) * side }, distance: LEAN_OFFSET + 0.25 });
      this.lean = side * Math.min(Math.abs(this.lean), Math.max(0, (reach - 0.2) / LEAN_OFFSET));
    } else this.lean = 0;
    const slow = (1 - TAG_SLOW * this.tagged / TAG_SECONDS) * (1 - (1 - LEAN_SPEED) * Math.abs(this.lean));
    const beforeEast = this.east;
    const beforeNorth = this.north;
    if (this.sliding) {
      // The slide keeps its direction; strafe keys steer it a little.
      this.velocityEast = this.slideEast * this.slideSpeed - Math.cos(heading) * strafe * 1.2;
      this.velocityNorth = this.slideNorth * this.slideSpeed + Math.sin(heading) * strafe * 1.2;
    } else if (!jumpFromSlide) {
      const targetSpeed = (this.crouching ? 2.3 : wantsRun ? 8.2 : 4.5) * slow;
      const scale = targetSpeed / Math.max(1, Math.hypot(forward, strafe));
      const targetEast = (Math.sin(heading) * forward - Math.cos(heading) * strafe) * scale;
      const targetNorth = (Math.cos(heading) * forward + Math.sin(heading) * strafe) * scale;
      // In the air, faster-than-input momentum from a sprint or slide jump is kept.
      const carrying = !this.grounded && Math.hypot(this.velocityEast, this.velocityNorth) > Math.hypot(targetEast, targetNorth) + 0.5;
      const response = 1 - Math.exp(-delta * (this.grounded ? (forward || strafe ? 14 : 19) : carrying ? 0.8 : 4));
      this.velocityEast += (targetEast - this.velocityEast) * response;
      this.velocityNorth += (targetNorth - this.velocityNorth) * response;
    }
    this.coyote = this.grounded ? 0.11 : Math.max(0, this.coyote - delta);
    if (this.jumpBuffer > 0 && this.coyote > 0 && !this.crouching) {
      this.verticalSpeed = 5.2;
      this.grounded = false;
      this.coyote = 0;
      this.jumpBuffer = 0;
      this.jumps += 1;
    } else this.verticalSpeed = Math.max(-25, this.verticalSpeed - 14 * delta);
    const falling = -this.verticalSpeed;
    const position = this.physics.move(this.velocityEast * delta, this.velocityNorth * delta, this.verticalSpeed * delta);
    this.east = position.east;
    this.north = position.north;
    this.feet = position.feet;
    // Short airborne blips on steps and slopes are not landings.
    if (!this.grounded && position.grounded && this.airTime > 0.18) {
      this.landings += 1;
      this.landingSpeed = falling;
    }
    this.airTime = position.grounded ? 0 : this.airTime + delta;
    this.grounded = position.grounded;
    if (this.grounded && this.verticalSpeed < 0) this.verticalSpeed = 0;
    this.jumpHeight = Math.max(0, this.feet - terrainHeight(this.data, this.east, this.north));
    this.speed = delta > 0 ? Math.hypot(this.east - beforeEast, this.north - beforeNorth) / delta : 0;
    this.moving = this.speed > 0.1;
    this.running = this.moving && wantsRun && !this.sliding;
    // A slide that runs into a wall stops.
    if (this.sliding && this.speed < SLIDE_END_SPEED * 0.6 && this.slideTime > 0.1) this.endSlide();
  }

  private startSlide(): void {
    const speed = Math.max(0.01, Math.hypot(this.velocityEast, this.velocityNorth));
    this.slideEast = this.velocityEast / speed;
    this.slideNorth = this.velocityNorth / speed;
    this.slideSpeed = Math.min(SLIDE_MAX, Math.max(speed, 8.2) + SLIDE_BOOST);
    this.slideTime = 0;
    this.sliding = true;
    this.slides += 1;
  }

  private endSlide(): void {
    this.sliding = false;
    this.slideCooldown = SLIDE_COOLDOWN;
  }

  private tryMantle(heading: number): boolean {
    const ledge = this.physics.findLedge(Math.sin(heading), Math.cos(heading), this.grounded ? undefined : 0.05);
    // Climbing needs room to stand up first.
    if (!ledge || this.physics.setCrouched(false)) return false;
    this.crouching = false;
    const height = ledge.feet - this.feet;
    this.mantle = { fromEast: this.east, fromNorth: this.north, fromFeet: this.feet, to: ledge, elapsed: 0, duration: 0.3 + 0.18 * height };
    this.jumpBuffer = 0;
    this.velocityEast = 0;
    this.velocityNorth = 0;
    this.verticalSpeed = 0;
    this.mantles += 1;
    return true;
  }

  private ladderInReach(heading: number): Ladder | null {
    for (const ladder of this.ladders) {
      const dx = this.east - ladder.foot.x, dz = this.north - ladder.foot.z;
      const along = dx * ladder.along.x + dz * ladder.along.z, out = dx * ladder.normal.x + dz * ladder.normal.z;
      const facing = -(Math.sin(heading) * ladder.normal.x + Math.cos(heading) * ladder.normal.z);
      if (Math.abs(along) < 0.45 && out > 0.1 && out < 0.95 && facing > 0.35 && this.feet < ladder.top - 0.5 && this.feet > ladder.foot.y - 0.5) return ladder;
    }
    return null;
  }

  // On a ladder: W climbs, S descends, Space lets go backward. At the top the player climbs
  // over the edge onto the platform; at the bottom, stepping down lets go.
  private stepLadder(delta: number, input: number): void {
    const ladder = this.climbing!;
    const climb = input * 2.6 * delta;
    this.east = ladder.foot.x + ladder.normal.x * 0.48;
    this.north = ladder.foot.z + ladder.normal.z * 0.48;
    this.feet = Math.max(ladder.foot.y, Math.min(ladder.top + 0.05, this.feet + climb));
    this.climbed += Math.abs(climb);
    if (this.climbed >= 0.3) { this.climbed = 0; this.rungs += 1; }
    this.physics.place(this.east, this.north, this.feet);
    this.jumpHeight = Math.max(0, this.feet - terrainHeight(this.data, this.east, this.north));
    this.moving = input !== 0;
    this.speed = Math.abs(input) * 2.6;
    this.running = false;
    this.grounded = false;
    this.airTime = 0;
    if (this.jumpBuffer > 0) {
      this.climbing = null;
      this.jumpBuffer = 0;
      this.velocityEast = ladder.normal.x * 3.5;
      this.velocityNorth = ladder.normal.z * 3.5;
      this.verticalSpeed = 2.5;
      return;
    }
    if (input < 0 && this.feet <= ladder.foot.y + 0.02) { this.climbing = null; this.grounded = true; return; }
    if (this.feet >= ladder.top - 0.35) {
      this.climbing = null;
      this.mantle = { fromEast: this.east, fromNorth: this.north, fromFeet: this.feet, to: { east: ladder.foot.x - ladder.normal.x * 0.95, north: ladder.foot.z - ladder.normal.z * 0.95, feet: ladder.top }, elapsed: 0, duration: 0.5 };
      this.mantles += 1;
    }
  }

  // Rise beside the ledge first, then move over its top, so the body never cuts the edge.
  private stepMantle(delta: number): void {
    const mantle = this.mantle!;
    mantle.elapsed += delta;
    const progress = Math.min(1, mantle.elapsed / mantle.duration);
    const rise = 1 - (1 - Math.min(1, progress / 0.55)) ** 2;
    const advance = smoothstep(0.45, 1, progress);
    this.east = mantle.fromEast + (mantle.to.east - mantle.fromEast) * advance;
    this.north = mantle.fromNorth + (mantle.to.north - mantle.fromNorth) * advance;
    this.feet = mantle.fromFeet + (mantle.to.feet + 0.03 - mantle.fromFeet) * rise;
    this.physics.place(this.east, this.north, this.feet);
    this.jumpHeight = Math.max(0, this.feet - terrainHeight(this.data, this.east, this.north));
    this.speed = 0;
    this.moving = false;
    this.running = false;
    this.grounded = false;
    if (progress < 1) return;
    this.mantle = null;
    this.grounded = true;
    this.airTime = 0;
    this.coyote = 0.11;
  }

  destroy(): void {
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerUp);
    this.canvas.removeEventListener("dblclick", this.requestPointerLock);
    document.removeEventListener("mousemove", this.onLockedMouseMove);
    document.removeEventListener("keydown", this.onKeyDown);
    document.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.clearKeys);
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  private turn(dx: number, dy: number, mode: "drag" | "locked"): void {
    const direction = mode === "drag" ? 1 : -1;
    this.heading = (this.heading + dx * 0.18 * direction + 360) % 360;
    this.pitch = Math.max(-80, Math.min(80, this.pitch + dy * 0.18 * direction));
    this.applyPose();
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (this.paused || event.button !== 0 || document.pointerLockElement === this.canvas) return;
    this.canvas.focus();
    this.dragging = true;
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    this.canvas.setPointerCapture(event.pointerId);
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.dragging || document.pointerLockElement === this.canvas) return;
    this.turn(event.clientX - this.lastX, event.clientY - this.lastY, "drag");
    this.lastX = event.clientX;
    this.lastY = event.clientY;
  };

  private onPointerUp = (): void => {
    this.dragging = false;
  };

  private requestPointerLock = (): void => {
    void this.canvas.requestPointerLock().catch(() => undefined);
  };

  private onLockedMouseMove = (event: MouseEvent): void => {
    if (!this.paused && document.pointerLockElement === this.canvas) this.turn(event.movementX, event.movementY, "locked");
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    if (this.paused) return;
    const key = event.key.toLowerCase();
    if (!["w", "a", "s", "d", "q", "e", "arrowup", "arrowdown", "arrowleft", "arrowright", "shift", "control", "c", " "].includes(key)) return;
    if (document.activeElement instanceof HTMLInputElement) return;
    event.preventDefault();
    if (key === " ") {
      if (!this.keys.has(key)) this.jumpBuffer = 0.12;
      this.keys.add(key);
    } else this.keys.add(key);
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.key.toLowerCase());
  };

  private clearKeys = (): void => {
    this.keys.clear();
    this.dragging = false;
  };

  private applyPose(): void {
    const heading = (this.heading + this.punchYaw) * Math.PI / 180;
    const pitch = Math.max(-80, Math.min(80, this.pitch + this.punchPitch)) * Math.PI / 180;
    const bob = Math.sin(this.stride * 2) * this.bobAmount * (this.running ? 0.045 : 0.025);
    // Leaning moves the eyes toward screen right, (-cos h, sin h), and a little lower.
    const lean = this.lean * LEAN_OFFSET;
    this.camera.position.set(this.east - Math.cos(heading) * lean, this.feet + this.eyeHeight + bob - Math.abs(this.lean) * 0.04, this.north + Math.sin(heading) * lean);
    this.camera.lookAt(
      this.camera.position.x + Math.sin(heading) * Math.cos(pitch),
      this.camera.position.y + Math.sin(pitch),
      this.camera.position.z + Math.cos(heading) * Math.cos(pitch),
    );
    const roll = this.roll - this.lean * LEAN_ROLL;
    if (roll) this.camera.rotateZ(roll);
  }
}
