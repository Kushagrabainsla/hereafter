import { PerspectiveCamera } from "three/webgpu";
import { type Arena, type ArenaData, terrainHeight, toCoordinates } from "../world/arena";
import { CollisionWorld } from "../world/collision";

export interface PlayerPose {
  latitude: number;
  longitude: number;
  heightAboveGround: number;
  heading: number;
}

const EYE_HEIGHT = 1.72;
const PLAYER_RADIUS = 0.55;

export class PlayerController {
  private arena: Arena;
  private east = 0;
  private north = 0;
  private heading = 0;
  private pitch = -4;
  private jumpHeight = 0;
  private verticalSpeed = 0;
  private keys = new Set<string>();
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private collision: CollisionWorld;

  constructor(private camera: PerspectiveCamera, private canvas: HTMLCanvasElement, private data: ArenaData, arena: Arena) {
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
    const spawn = this.collision.findSpawn(arena);
    this.east = spawn.east;
    this.north = spawn.north;
    this.heading = spawn.heading;
    this.pitch = -4;
    this.jumpHeight = 0;
    this.verticalSpeed = 0;
    this.keys.clear();
    this.applyPose();
  }

  pose(): PlayerPose {
    return { ...toCoordinates(this.east, this.north), heightAboveGround: EYE_HEIGHT + this.jumpHeight, heading: this.heading };
  }

  update(seconds: number): void {
    const delta = Math.min(seconds, 0.1);
    const forward = Number(this.keys.has("w") || this.keys.has("arrowup")) - Number(this.keys.has("s") || this.keys.has("arrowdown"));
    const strafe = Number(this.keys.has("d") || this.keys.has("arrowright")) - Number(this.keys.has("a") || this.keys.has("arrowleft"));
    if (forward || strafe) {
      const heading = this.heading * Math.PI / 180;
      const speed = (this.keys.has("shift") ? 7.5 : 4.5) * delta / Math.max(1, Math.hypot(forward, strafe));
      const changeEast = (Math.sin(heading) * forward + Math.cos(heading) * strafe) * speed;
      const changeNorth = (Math.cos(heading) * forward - Math.sin(heading) * strafe) * speed;
      this.move(changeEast, changeNorth);
    }
    if (this.verticalSpeed !== 0 || this.jumpHeight > 0) {
      this.jumpHeight += this.verticalSpeed * delta;
      this.verticalSpeed -= 14 * delta;
      if (this.jumpHeight <= 0) {
        this.jumpHeight = 0;
        this.verticalSpeed = 0;
      }
    }
    this.applyPose();
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

  private move(changeEast: number, changeNorth: number): void {
    const nextEast = this.east + changeEast;
    const nextNorth = this.north + changeNorth;
    if (this.canOccupy(nextEast, nextNorth)) {
      this.east = nextEast;
      this.north = nextNorth;
    } else if (this.canOccupy(nextEast, this.north)) {
      this.east = nextEast;
    } else if (this.canOccupy(this.east, nextNorth)) {
      this.north = nextNorth;
    }
  }

  private canOccupy(east: number, north: number): boolean {
    return this.collision.insideArena(east, north, this.arena, PLAYER_RADIUS) && !this.collision.blocked(east, north, PLAYER_RADIUS);
  }

  private turn(dx: number, dy: number): void {
    this.heading = (this.heading + dx * 0.18 + 360) % 360;
    this.pitch = Math.max(-80, Math.min(80, this.pitch - dy * 0.18));
    this.applyPose();
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || document.pointerLockElement === this.canvas) return;
    this.canvas.focus();
    this.dragging = true;
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    this.canvas.setPointerCapture(event.pointerId);
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.dragging || document.pointerLockElement === this.canvas) return;
    this.turn(event.clientX - this.lastX, event.clientY - this.lastY);
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
    if (document.pointerLockElement === this.canvas) this.turn(event.movementX, event.movementY);
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    const key = event.key.toLowerCase();
    if (!["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", "shift", " ", "r"].includes(key)) return;
    if (document.activeElement instanceof HTMLInputElement) return;
    event.preventDefault();
    if (key === "r") this.reset(this.arena);
    else if (key === " ") {
      if (!this.keys.has(key) && this.jumpHeight === 0) this.verticalSpeed = 5.2;
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
    this.camera.position.set(this.east, terrainHeight(this.data, this.east, this.north) + EYE_HEIGHT + this.jumpHeight, this.north);
    this.camera.lookAt(
      this.east + Math.sin(heading) * Math.cos(pitch),
      this.camera.position.y + Math.sin(pitch),
      this.north + Math.cos(heading) * Math.cos(pitch),
    );
  }
}
