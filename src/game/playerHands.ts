import { CapsuleGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, PerspectiveCamera } from "three/webgpu";
import { type PlayerMotion } from "./playerController";

function part(geometry: CapsuleGeometry | CylinderGeometry, material: MeshStandardMaterial): Mesh {
  const mesh = new Mesh(geometry, material);
  mesh.renderOrder = 50;
  return mesh;
}

export class PlayerHands {
  private left: Group;
  private right: Group;
  private stride = 0;
  private sway = 0;
  private breath = 0;
  private airborneBlend = 0;
  private landing = 0;
  private wasAirborne = false;

  constructor(camera: PerspectiveCamera) {
    const sleeve = new MeshStandardMaterial({ color: 0x294958, roughness: 0.95, depthTest: false, depthWrite: false });
    const cuff = new MeshStandardMaterial({ color: 0x192f3a, roughness: 0.88, depthTest: false, depthWrite: false });
    const skin = new MeshStandardMaterial({ color: 0xb98666, roughness: 0.92, depthTest: false, depthWrite: false });
    const makeArm = (side: -1 | 1): Group => {
      const arm = new Group();
      arm.position.set(side * 0.42, -0.61, -0.86);
      arm.scale.setScalar(0.86);

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

      return arm;
    };
    this.left = makeArm(-1);
    this.right = makeArm(1);
    camera.add(this.left, this.right);
  }

  update(seconds: number, motion: PlayerMotion): void {
    const delta = Math.min(seconds, 0.1);
    this.breath += delta;
    const target = motion.moving && !motion.airborne ? 1 : 0;
    this.sway += (target - this.sway) * Math.min(1, delta * 8);
    if (motion.moving) this.stride += motion.speed * delta * (motion.running ? 1.55 : 1.25);
    if (this.wasAirborne && !motion.airborne) this.landing = 1;
    this.wasAirborne = motion.airborne;
    this.landing = Math.max(0, this.landing - delta * 5);
    this.airborneBlend += ((motion.airborne ? 1 : 0) - this.airborneBlend) * Math.min(1, delta * 10);
    const amplitude = this.sway * (motion.running ? 0.14 : 0.085);
    const swing = Math.sin(this.stride) * amplitude;
    const breathing = Math.sin(this.breath * 1.7) * 0.006;
    const lift = this.airborneBlend * 0.095 - (motion.crouching ? 0.055 : 0) - this.landing * 0.04;
    this.left.position.set(-0.42 - swing * 0.08, -0.61 + lift + swing * 0.25 + breathing, -0.86 + swing * 0.7 + this.airborneBlend * 0.045);
    this.right.position.set(0.42 - swing * 0.08, -0.61 + lift - swing * 0.25 + breathing, -0.86 - swing * 0.7 + this.airborneBlend * 0.045);
    this.left.rotation.set(-0.08 + swing * 1.3 - this.airborneBlend * 0.2, swing * 0.22, -0.035 - swing * 0.35);
    this.right.rotation.set(-0.08 - swing * 1.3 - this.airborneBlend * 0.2, -swing * 0.22, 0.035 + swing * 0.35);
  }
}
