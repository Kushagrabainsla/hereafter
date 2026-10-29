import { PerspectiveCamera } from "three/webgpu";
import { type Arena, type ArenaData, terrainHeight } from "../world/arena";
import { CollisionWorld } from "../world/collision";
import { PhysicsWorld } from "../world/physics";

export interface PlayerMotion {
  moving: boolean;
  running: boolean;
  crouching: boolean;
  airborne: boolean;
  speed: number;
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
}

const EYE_HEIGHT = 1.72;
const STEP_SECONDS = 1 / 60;

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
  private collision: CollisionWorld;
  private spawnSlot = 0;

  constructor(private camera: PerspectiveCamera, private canvas: HTMLCanvasElement, private data: ArenaData, arena: Arena, private physics: PhysicsWorld) {
    this.arena = arena;
    this.collision = new CollisionWorld(data);
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
    const spawn = this.collision.findSpawn(arena, this.spawnSlot);
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

  motion(): PlayerMotion {
    return { moving: this.moving, running: this.running, crouching: this.crouching, airborne: !this.grounded, speed: this.speed };
  }

  pose(): PlayerPose {
    return {
      east: this.east,
      north: this.north,
      heading: this.heading,
      pitch: this.pitch,
      jumpHeight: this.jumpHeight,
      moving: this.moving,
      running: this.running,
      crouching: this.crouching,
    };
  }

  setSpawnSlot(slot: number): void {
    if (slot === this.spawnSlot) return;
    const standingAtSpawn = Array.from({ length: 8 }, (_, index) => this.collision.findSpawn(this.arena, index))
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
    this.eyeHeight += ((this.crouching ? 1.12 : EYE_HEIGHT) - this.eyeHeight) * Math.min(1, delta * 10);
    this.bobAmount += ((this.moving && this.grounded ? 1 : 0) - this.bobAmount) * Math.min(1, delta * 8);
    if (this.moving) this.stride += this.speed * delta * (this.running ? 2.1 : 1.7);
    const targetFov = this.running ? 80 : this.crouching ? 72 : 75;
    if (Math.abs(this.camera.fov - targetFov) > 0.01) {
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, delta * 7);
      this.camera.updateProjectionMatrix();
    }
    this.applyPose();
  }

  private fixedUpdate(delta: number): void {
    const forward = Number(this.keys.has("w") || this.keys.has("arrowup")) - Number(this.keys.has("s") || this.keys.has("arrowdown"));
    const strafe = Number(this.keys.has("d") || this.keys.has("arrowright")) - Number(this.keys.has("a") || this.keys.has("arrowleft"));
    this.crouching = this.physics.setCrouched(this.keys.has("c") || this.keys.has("control"));
    const wantsRun = this.keys.has("shift") && !this.crouching;
    const beforeEast = this.east;
    const beforeNorth = this.north;
    const heading = this.heading * Math.PI / 180;
    const targetSpeed = this.crouching ? 2.3 : wantsRun ? 8.2 : 4.5;
    const scale = targetSpeed / Math.max(1, Math.hypot(forward, strafe));
    const targetEast = (Math.sin(heading) * forward - Math.cos(heading) * strafe) * scale;
    const targetNorth = (Math.cos(heading) * forward + Math.sin(heading) * strafe) * scale;
    const response = 1 - Math.exp(-delta * (this.grounded ? (forward || strafe ? 14 : 19) : 4));
    this.velocityEast += (targetEast - this.velocityEast) * response;
    this.velocityNorth += (targetNorth - this.velocityNorth) * response;
    this.coyote = this.grounded ? 0.11 : Math.max(0, this.coyote - delta);
    this.jumpBuffer = Math.max(0, this.jumpBuffer - delta);
    if (this.jumpBuffer > 0 && this.coyote > 0 && !this.crouching) {
      this.verticalSpeed = 5.2;
      this.grounded = false;
      this.coyote = 0;
      this.jumpBuffer = 0;
    } else this.verticalSpeed = Math.max(-25, this.verticalSpeed - 14 * delta);
    const position = this.physics.move(this.velocityEast * delta, this.velocityNorth * delta, this.verticalSpeed * delta);
    this.east = position.east;
    this.north = position.north;
    this.feet = position.feet;
    this.grounded = position.grounded;
    if (this.grounded && this.verticalSpeed < 0) this.verticalSpeed = 0;
    this.jumpHeight = Math.max(0, this.feet - terrainHeight(this.data, this.east, this.north));
    this.speed = delta > 0 ? Math.hypot(this.east - beforeEast, this.north - beforeNorth) / delta : 0;
    this.moving = this.speed > 0.1;
    this.running = this.moving && wantsRun;
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
    if (!["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", "shift", "control", "c", " "].includes(key)) return;
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
    const heading = this.heading * Math.PI / 180;
    const pitch = this.pitch * Math.PI / 180;
    const bob = Math.sin(this.stride * 2) * this.bobAmount * (this.running ? 0.045 : 0.025);
    this.camera.position.set(this.east, this.feet + this.eyeHeight + bob, this.north);
    this.camera.lookAt(
      this.east + Math.sin(heading) * Math.cos(pitch),
      this.camera.position.y + Math.sin(pitch),
      this.north + Math.cos(heading) * Math.cos(pitch),
    );
  }
}
