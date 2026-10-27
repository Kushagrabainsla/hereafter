import { Cartesian3, Math as CesiumMath, Viewer } from "cesium";
import type { Arena } from "./arena";

export interface CameraPose {
  latitude: number;
  longitude: number;
  height: number;
}

export class CameraControls {
  private arena: Arena;
  private east = 0;
  private north = 0;
  private height = 180;
  private heading = 0;
  private pitch = -35;
  private keys = new Set<string>();
  private frame = 0;
  private previousTime = 0;

  constructor(private viewer: Viewer, arena: Arena) {
    this.arena = arena;
    viewer.scene.screenSpaceCameraController.enableInputs = false;
    viewer.canvas.addEventListener("click", this.requestLook);
    document.addEventListener("mousemove", this.onMouseMove);
    document.addEventListener("keydown", this.onKeyDown);
    document.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.clearKeys);
    this.reset(arena);
    this.frame = requestAnimationFrame(this.tick);
  }

  reset(arena: Arena): void {
    this.arena = arena;
    this.east = 0;
    this.north = 0;
    this.height = 180;
    this.heading = 0;
    this.pitch = -35;
    this.applyPose();
  }

  pose(): CameraPose {
    const latitude = this.arena.latitude + this.north / 111_320;
    const longitude = this.arena.longitude + this.east / (111_320 * Math.cos(CesiumMath.toRadians(this.arena.latitude)));
    return { latitude, longitude, height: this.height };
  }

  destroy(): void {
    cancelAnimationFrame(this.frame);
    this.viewer.canvas.removeEventListener("click", this.requestLook);
    document.removeEventListener("mousemove", this.onMouseMove);
    document.removeEventListener("keydown", this.onKeyDown);
    document.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.clearKeys);
    if (document.pointerLockElement === this.viewer.canvas) document.exitPointerLock();
  }

  private requestLook = (): void => {
    void this.viewer.canvas.requestPointerLock();
  };

  private onMouseMove = (event: MouseEvent): void => {
    if (document.pointerLockElement !== this.viewer.canvas) return;
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

  private tick = (time: number): void => {
    const seconds = this.previousTime ? Math.min((time - this.previousTime) / 1000, 0.05) : 0;
    this.previousTime = time;
    const speed = (this.keys.has("shift") ? 120 : 40) * seconds;
    const forward = Number(this.keys.has("w")) - Number(this.keys.has("s"));
    const strafe = Number(this.keys.has("d")) - Number(this.keys.has("a"));
    const vertical = Number(this.keys.has("e")) - Number(this.keys.has("q"));
    if (forward || strafe || vertical) {
      const heading = CesiumMath.toRadians(this.heading);
      const scale = Math.max(1, Math.hypot(forward, strafe));
      this.east += (Math.sin(heading) * forward + Math.cos(heading) * strafe) * speed / scale;
      this.north += (Math.cos(heading) * forward - Math.sin(heading) * strafe) * speed / scale;
      const half = this.arena.sizeMeters / 2;
      this.east = Math.max(-half, Math.min(half, this.east));
      this.north = Math.max(-half, Math.min(half, this.north));
      this.height = Math.max(10, Math.min(400, this.height + vertical * speed));
      this.applyPose();
    }
    this.frame = requestAnimationFrame(this.tick);
  };

  private applyPose(): void {
    const { latitude, longitude, height } = this.pose();
    this.viewer.camera.setView({
      destination: Cartesian3.fromDegrees(longitude, latitude, height),
      orientation: {
        heading: CesiumMath.toRadians(this.heading),
        pitch: CesiumMath.toRadians(this.pitch),
        roll: 0,
      },
    });
  }
}
