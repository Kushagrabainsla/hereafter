import {
  BoxGeometry, CapsuleGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial,
  PerspectiveCamera,
} from "three/webgpu";
import { type PlayerMotion } from "./playerController";

function part(geometry: BoxGeometry | CapsuleGeometry | CylinderGeometry, material: MeshStandardMaterial): Mesh {
  const mesh = new Mesh(geometry, material);
  mesh.renderOrder = 50;
  return mesh;
}

export class PlayerHands {
  private left: Group;
  private right: Group;
  private stride = 0;
  private sway = 0;

  constructor(camera: PerspectiveCamera) {
    const sleeve = new MeshStandardMaterial({ color: 0x294958, roughness: 0.95, depthTest: false, depthWrite: false });
    const cuff = new MeshStandardMaterial({ color: 0x192f3a, roughness: 0.88, depthTest: false, depthWrite: false });
    const skin = new MeshStandardMaterial({ color: 0xb98666, roughness: 0.92, depthTest: false, depthWrite: false });
    const details = new MeshStandardMaterial({ color: 0x9e6e54, roughness: 1, depthTest: false, depthWrite: false });
    const makeArm = (side: -1 | 1): Group => {
      const arm = new Group();
      arm.position.set(side * 0.45, -0.52, -0.72);

      const forearm = part(new CylinderGeometry(0.105, 0.16, 0.58, 9), sleeve);
      forearm.position.set(side * 0.11, -0.22, 0.13);
      forearm.rotation.z = side * 0.47;
      arm.add(forearm);

      const wrist = part(new CylinderGeometry(0.115, 0.115, 0.09, 9), cuff);
      wrist.position.set(side * -0.035, 0.015, -0.015);
      wrist.rotation.z = side * 0.27;
      arm.add(wrist);

      const palm = part(new CapsuleGeometry(0.115, 0.08, 4, 8), skin);
      palm.position.set(side * -0.09, 0.11, -0.105);
      palm.rotation.x = -0.35;
      palm.rotation.z = side * 0.19;
      arm.add(palm);

      for (let finger = 0; finger < 4; finger += 1) {
        const digit = part(new CapsuleGeometry(0.027, 0.075 - Math.abs(finger - 1.5) * 0.012, 3, 6), skin);
        digit.position.set(side * -0.09 + (finger - 1.5) * 0.05, 0.245 - Math.abs(finger - 1.5) * 0.015, -0.16);
        digit.rotation.x = -0.5;
        arm.add(digit);
      }
      const thumb = part(new CapsuleGeometry(0.035, 0.06, 3, 6), skin);
      thumb.position.set(side * -0.22, 0.14, -0.08);
      thumb.rotation.z = side * 0.7;
      arm.add(thumb);

      const seam = part(new BoxGeometry(0.1, 0.018, 0.012), details);
      seam.position.set(side * -0.09, 0.075, -0.22);
      arm.add(seam);
      return arm;
    };
    this.left = makeArm(-1);
    this.right = makeArm(1);
    camera.add(this.left, this.right);
  }

  update(seconds: number, motion: PlayerMotion): void {
    const delta = Math.min(seconds, 0.1);
    const target = motion.moving && !motion.airborne ? 1 : 0;
    this.sway += (target - this.sway) * Math.min(1, delta * 8);
    if (motion.moving) this.stride += motion.speed * delta * (motion.running ? 2.1 : 1.7);
    const amplitude = this.sway * (motion.running ? 0.10 : 0.055);
    const lift = motion.airborne ? 0.075 : motion.crouching ? -0.035 : 0;
    this.left.position.y = -0.52 + lift + Math.sin(this.stride) * amplitude;
    this.right.position.y = -0.52 + lift - Math.sin(this.stride) * amplitude;
    this.left.rotation.z = -0.035 - Math.sin(this.stride) * amplitude * 0.5;
    this.right.rotation.z = 0.035 + Math.sin(this.stride) * amplitude * 0.5;
  }
}
