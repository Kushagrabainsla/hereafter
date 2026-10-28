import { PerspectiveCamera } from "three/webgpu";
import { type Arena, type ArenaData, terrainHeight, toCoordinates, toLocal } from "./arena";

export interface CameraPose {
  latitude: number;
  longitude: number;
  heightAboveGround: number;
}

export class CameraControls {
  private arena: Arena;
  private east = 0;
  private north = 0;
  private heightAboveGround = 110;
  private heading = 0;
  private pitch = -48;
  private keys = new Set<string>();

  constructor(private camera: PerspectiveCamera, private canvas: HTMLCanvasElement, private data: ArenaData, arena: Arena) {
    this.arena = arena;
    canvas.addEventListener("click", this.requestLook);
    document.addEventListener("mousemove", this.onMouseMove);
    document.addEventListener("keydown", this.onKeyDown);
    document.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.clearKeys);
    this.reset(arena);
  }

  reset(arena: Arena): void {
    this.arena = arena;
    [this.east, this.north] = toLocal(arena.latitude, arena.longitude);
    this.heightAboveGround = 110;
    this.heading = 0;
    this.pitch = -48;
    this.applyPose();
  }

  pose(): CameraPose {
    return { ...toCoordinates(this.east, this.north), heightAboveGround: this.heightAboveGround };
  }

  update(seconds: number): void {
    const speed = (this.keys.has("shift") ? 105 : 36) * Math.min(seconds, 0.05);
    const forward = Number(this.keys.has("w")) - Number(this.keys.has("s"));
    const strafe = Number(this.keys.has("d")) - Number(this.keys.has("a"));
    const vertical = Number(this.keys.has("e")) - Number(this.keys.has("q"));
    if (!forward && !strafe && !vertical) return;
    const heading = this.heading * Math.PI / 180;
    const scale = Math.max(1, Math.hypot(forward, strafe));
    this.east += (Math.sin(heading) * forward + Math.cos(heading) * strafe) * speed / scale;
    this.north += (Math.cos(heading) * forward - Math.sin(heading) * strafe) * speed / scale;
    const [centerEast, centerNorth] = toLocal(this.arena.latitude, this.arena.longitude);
    const half = this.arena.sizeMeters / 2;
    this.east = Math.max(centerEast - half, Math.min(centerEast + half, this.east));
    this.north = Math.max(centerNorth - half, Math.min(centerNorth + half, this.north));
    this.heightAboveGround = Math.max(3, Math.min(260, this.heightAboveGround + vertical * speed));
    this.applyPose();
  }

  destroy(): void {
    this.canvas.removeEventListener("click", this.requestLook);
    document.removeEventListener("mousemove", this.onMouseMove);
    document.removeEventListener("keydown", this.onKeyDown);
    document.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.clearKeys);
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  private requestLook = (): void => {
    void this.canvas.requestPointerLock().catch(() => undefined);
  };

  private onMouseMove = (event: MouseEvent): void => {
    if (document.pointerLockElement !== this.canvas) return;
    this.heading = (this.heading + event.movementX * 0.11 + 360) % 360;
    this.pitch = Math.max(-89, Math.min(60, this.pitch - event.movementY * 0.11));
    this.applyPose();
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    const key = event.key.toLowerCase();
    if (!["w", "a", "s", "d", "q", "e", "shift"].includes(key)) return;
    if (document.activeElement instanceof HTMLInputElement) return;
    event.preventDefault();
    this.keys.add(key);
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.key.toLowerCase());
  };

  private clearKeys = (): void => {
    this.keys.clear();
  };

  private applyPose(): void {
    const heading = this.heading * Math.PI / 180;
    const pitch = this.pitch * Math.PI / 180;
    this.camera.position.set(this.east, terrainHeight(this.data, this.east, this.north) + this.heightAboveGround, this.north);
    this.camera.lookAt(
      this.east + Math.sin(heading) * Math.cos(pitch),
      this.camera.position.y + Math.sin(pitch),
      this.north + Math.cos(heading) * Math.cos(pitch),
    );
  }
}
