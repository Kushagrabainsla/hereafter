import { CapsuleGeometry, Euler, Group, Mesh, MeshStandardMaterial, Vector3 } from "three/webgpu";
import { type WeaponKind } from "./combatRules";

// A grip describes where a hand closes around the held weapon, in weapon-local metres.
// halfWidth is the gripped part's half thickness across x; front is the z offset of its
// front face from the palm centre; rake tilts the whole hand to follow a raked grip.
// wrist moves where the forearm meets the palm (palm-local) for hands that are not
// stacked straight below the weapon, such as the support hand under a fore-end.
interface Grip {
  side: -1 | 1;
  center: [number, number, number];
  halfWidth: number;
  front: number;
  rake?: [number, number, number];
  trigger?: boolean;
  wrist?: [number, number, number];
  elbow: [number, number, number];
}

const GRIPS: Record<WeaponKind, Grip[]> = {
  knife: [
    { side: 1, center: [0, -0.065, 0.015], halfWidth: 0.05, front: -0.05, elbow: [0.6, -0.78, 0.62] },
  ],
  pistol: [
    { side: 1, center: [0, -0.165, 0.012], halfWidth: 0.04, front: -0.052, rake: [-0.28, 0, 0], trigger: true, elbow: [0.56, -0.78, 0.66] },
    { side: -1, center: [-0.028, -0.19, -0.03], halfWidth: 0.058, front: -0.046, rake: [-0.28, 0, 0], elbow: [-0.46, -0.78, 0.66] },
  ],
  rifle: [
    { side: 1, center: [0, -0.165, 0.012], halfWidth: 0.04, front: -0.052, rake: [-0.28, 0, 0], trigger: true, elbow: [0.56, -0.8, 0.62] },
    { side: -1, center: [-0.012, 0, -0.52], halfWidth: 0.058, front: -0.078, rake: [-Math.PI / 2, 0, 0], wrist: [-0.084, -0.03, -0.07], elbow: [-0.52, -0.7, -0.22] },
  ],
};

const UP = new Vector3(0, 1, 0);

// Grip geometry is authored in weapon-local coordinates. Fingers, wrists and arms
// inherit the weapon's transform, so recoil, sway and gait cannot separate the grip.
export class PlayerHands {
  readonly root = new Group();

  constructor(parent: Group, kind: WeaponKind) {
    const glove = new MeshStandardMaterial({ color: 0x424b45, roughness: 0.93 });
    const pads = new MeshStandardMaterial({ color: 0x232c28, roughness: 0.86 });
    const sleeve = new MeshStandardMaterial({ color: 0x38443e, roughness: 0.98 });
    const segment = (group: Group, from: number[], to: number[], radius: number, material: MeshStandardMaterial, flatten = 1): Mesh => {
      const a = new Vector3(...from), b = new Vector3(...to), direction = b.clone().sub(a);
      const mesh = new Mesh(new CapsuleGeometry(radius, Math.max(0.001, direction.length() - radius * 2), 5, 12), material);
      mesh.position.copy(a).add(b).multiplyScalar(0.5);
      mesh.quaternion.setFromUnitVectors(UP, direction.normalize());
      mesh.scale.x = flatten;
      mesh.renderOrder = 50;
      group.add(mesh);
      return mesh;
    };
    for (const grip of GRIPS[kind]) {
      const s = grip.side, w = grip.halfWidth, f = grip.front;
      const palm = new Group();
      palm.position.set(...grip.center);
      if (grip.rake) palm.rotation.set(...grip.rake);
      const px = w + 0.026;
      // Flattened palm against the side of the grip, with a padded knuckle ridge behind it.
      segment(palm, [s * px, -0.06, 0.012], [s * px, 0.05, 0.012], 0.046, glove, 0.6);
      segment(palm, [s * (px + 0.018), -0.045, 0.022], [s * (px + 0.018), 0.04, 0.022], 0.02, pads);
      for (let finger = 0; finger < 4; finger += 1) {
        const y = 0.048 - finger * 0.036;
        // Three phalanges wrap the grip; the index finger reaches the trigger on guns.
        const front = finger === 0 && grip.trigger ? f - 0.042 : f;
        const points = [[s * (w + 0.018), y, 0.008], [s * (w + 0.01), y, front - 0.012], [0, y, front - 0.03], [-s * (w - 0.012), y, front - 0.004]];
        for (let joint = 0; joint < 3; joint += 1) segment(palm, points[joint], points[joint + 1], 0.0165 - joint * 0.0015, glove);
        segment(palm, [s * (w + 0.018), y, -0.014], [s * (w + 0.012), y, front + 0.012], 0.018, pads);
      }
      // Opposing thumb closes over the top of the grip.
      segment(palm, [s * (w + 0.02), 0.035, 0.05], [s * 0.02, 0.07, 0.062], 0.024, glove);
      segment(palm, [s * 0.02, 0.07, 0.062], [-s * (w - 0.01), 0.068, 0.035], 0.021, glove);
      this.root.add(palm);
      // Forearms angle out of the lower frame; wrists meet the palms.
      const wrist = new Vector3(...(grip.wrist ?? [s * px, -0.05, 0.02])).applyEuler(new Euler(...(grip.rake ?? [0, 0, 0]))).add(palm.position);
      const elbow = new Vector3(...grip.elbow);
      segment(this.root, wrist.toArray(), wrist.clone().lerp(elbow, 0.16).toArray(), 0.054, pads);
      segment(this.root, wrist.clone().lerp(elbow, 0.12).toArray(), elbow.toArray(), 0.072, sleeve);
    }
    parent.add(this.root);
  }
}
