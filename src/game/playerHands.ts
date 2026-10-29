import { BoxGeometry, BufferGeometry, CapsuleGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, PerspectiveCamera, Vector3 } from "three/webgpu";
import { type PlayerMotion } from "./playerController";

function part(geometry: BufferGeometry, material: MeshStandardMaterial): Mesh {
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
  private view = new Vector3();
  private previousHeading: number | null = null;
  private previousPitch = 0;
  private turnLag = 0;
  private pitchLag = 0;

  constructor(private camera: PerspectiveCamera) {
    const sleeve = new MeshStandardMaterial({ color: 0x354751, roughness: 0.96, depthTest: false, depthWrite: false });
    const cuff = new MeshStandardMaterial({ color: 0x19242a, roughness: 0.92, depthTest: false, depthWrite: false });
    const glove = new MeshStandardMaterial({ color: 0x414849, roughness: 0.89, depthTest: false, depthWrite: false });
    const padding = new MeshStandardMaterial({ color: 0x272f32, roughness: 0.81, depthTest: false, depthWrite: false });
    const makeArm = (side: -1 | 1): Group => {
      const arm = new Group();
      arm.position.set(side * 0.45, -0.67, -0.86);
      arm.scale.setScalar(0.76);

      const forearm = part(new CylinderGeometry(0.105, 0.16, 0.58, 9), sleeve);
      forearm.position.set(side * 0.11, -0.22, 0.13);
      forearm.rotation.z = side * 0.47;
      arm.add(forearm);

      const wrist = part(new CylinderGeometry(0.115, 0.115, 0.09, 9), cuff);
      wrist.position.set(side * -0.035, 0.015, -0.015);
      wrist.rotation.z = side * 0.27;
      arm.add(wrist);

      const palm = part(new CapsuleGeometry(0.11, 0.1, 5, 10), glove);
      palm.position.set(side * -0.09, 0.11, -0.105);
      palm.rotation.x = -0.35;
      palm.rotation.z = side * 0.19;
      arm.add(palm);

      const backPlate = part(new BoxGeometry(0.18, 0.025, 0.17), padding);
      backPlate.position.set(side * -0.09, 0.16, -0.17);
      backPlate.rotation.z = side * 0.19;
      arm.add(backPlate);

      for (let finger = 0; finger < 4; finger += 1) {
        const digit = part(new CapsuleGeometry(0.023, 0.09 - Math.abs(finger - 1.5) * 0.012, 4, 8), glove);
        digit.position.set(side * -0.09 + (finger - 1.5) * 0.05, 0.245 - Math.abs(finger - 1.5) * 0.015, -0.16);
        digit.rotation.x = -0.5;
        arm.add(digit);
        const knuckle = part(new BoxGeometry(0.039, 0.018, 0.05), padding);
        knuckle.position.set(side * -0.09 + (finger - 1.5) * 0.05, 0.225, -0.205);
        arm.add(knuckle);
      }
      const thumb = part(new CapsuleGeometry(0.03, 0.065, 4, 8), glove);
      thumb.position.set(side * -0.22, 0.14, -0.08);
      thumb.rotation.z = side * 0.7;
      arm.add(thumb);

      return arm;
    };
    this.left = makeArm(-1);
    this.right = makeArm(1);
    camera.add(this.left, this.right);
  }

  setVisible(visible: boolean): void { this.left.visible = visible; this.right.visible = visible; }

  update(seconds: number, motion: PlayerMotion): void {
    const delta = Math.min(seconds, 0.1);
    this.camera.getWorldDirection(this.view);
    const heading = Math.atan2(this.view.x, this.view.z);
    const pitch = Math.asin(Math.max(-1, Math.min(1, this.view.y)));
    if (this.previousHeading !== null) {
      const headingChange = Math.atan2(Math.sin(heading - this.previousHeading), Math.cos(heading - this.previousHeading));
      const pitchChange = pitch - this.previousPitch;
      this.turnLag = Math.max(-0.08, Math.min(0.08, this.turnLag - headingChange * 0.5));
      this.pitchLag = Math.max(-0.055, Math.min(0.055, this.pitchLag - pitchChange * 0.45));
    }
    this.previousHeading = heading;
    this.previousPitch = pitch;
    const settle = Math.exp(-delta * 8);
    this.turnLag *= settle;
    this.pitchLag *= settle;
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
    this.left.position.set(-0.45 - swing * 0.08 + this.turnLag, -0.67 + lift + swing * 0.25 + breathing + this.pitchLag, -0.86 + swing * 0.7 + this.airborneBlend * 0.045);
    this.right.position.set(0.45 - swing * 0.08 + this.turnLag, -0.67 + lift - swing * 0.25 + breathing + this.pitchLag, -0.86 - swing * 0.7 + this.airborneBlend * 0.045);
    this.left.rotation.set(-0.08 + swing * 1.3 - this.airborneBlend * 0.2, swing * 0.22 - this.turnLag * 0.6, -0.035 - swing * 0.35);
    this.right.rotation.set(-0.08 - swing * 1.3 - this.airborneBlend * 0.2, -swing * 0.22 - this.turnLag * 0.6, 0.035 + swing * 0.35);
  }
}
