import RAPIER from "@dimforge/rapier3d";
import { terrainHeight, toLocal, type Arena, type ArenaData } from "./arena";
import { CollisionWorld } from "./collision";

const RADIUS = 0.3;
const STANDING_HALF_HEIGHT = 0.58;
const CROUCHED_HALF_HEIGHT = 0.28;
const STEP_SECONDS = 1 / 60;
// Ledges between these heights above the feet can be mantled. Lower ones are stepped over
// or jumped; the 1.12 m concrete cover is above the 0.97 m jump apex, so it needs a mantle.
const MIN_MANTLE = 0.45;
const MAX_MANTLE = 1.6;
const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };

export interface CharacterStep {
  east: number;
  north: number;
  feet: number;
  grounded: boolean;
}

export interface Ledge {
  east: number;
  north: number;
  feet: number;
}

export interface ShotRay {
  origin: { x: number; y: number; z: number };
  direction: { x: number; y: number; z: number };
  distance: number;
}

export class PhysicsWorld {
  private readonly world: RAPIER.World;
  private controller: RAPIER.KinematicCharacterController;
  private body: RAPIER.RigidBody;
  private collider: RAPIER.Collider;
  private terrainCollider!: RAPIER.Collider;
  private boundary: RAPIER.Collider[] = [];
  private halfHeight = STANDING_HALF_HEIGHT;
  private crouched = false;

  constructor(private data: ArenaData, arena: Arena) {
    this.world = new RAPIER.World({ x: 0, y: -14, z: 0 });
    this.world.integrationParameters.dt = STEP_SECONDS;
    this.addTerrain();
    this.addBuildings();
    this.addObstacles();
    this.setArena(arena);
    this.body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    this.collider = this.world.createCollider(RAPIER.ColliderDesc.capsule(STANDING_HALF_HEIGHT, RADIUS), this.body);
    this.controller = this.world.createCharacterController(0.015);
    this.controller.enableAutostep(0.22, 0.2, false);
    this.controller.enableSnapToGround(0.28);
    this.controller.setMaxSlopeClimbAngle(45 * Math.PI / 180);
    this.world.step();
  }

  private addTerrain(): void {
    const segments = 42;
    const extent = this.data.extentMeters;
    const vertices = new Float32Array((segments + 1) ** 2 * 3);
    const indices = new Uint32Array(segments * segments * 6);
    for (let row = 0; row <= segments; row += 1) {
      for (let column = 0; column <= segments; column += 1) {
        const east = -extent + column * 2 * extent / segments;
        const north = -extent + row * 2 * extent / segments;
        const offset = (row * (segments + 1) + column) * 3;
        vertices.set([east, terrainHeight(this.data, east, north), north], offset);
      }
    }
    let offset = 0;
    for (let row = 0; row < segments; row += 1) {
      for (let column = 0; column < segments; column += 1) {
        const a = row * (segments + 1) + column;
        const b = a + 1;
        const c = a + segments + 1;
        const d = c + 1;
        indices.set([a, c, b, b, c, d], offset);
        offset += 6;
      }
    }
    this.terrainCollider = this.world.createCollider(RAPIER.ColliderDesc.trimesh(vertices, indices));
  }

  private addBuildings(): void {
    for (const building of this.data.buildings) {
      const outline = building.outline;
      if (outline.length < 3) continue;
      const east = outline.reduce((sum, point) => sum + point[0], 0) / outline.length;
      const north = outline.reduce((sum, point) => sum + point[1], 0) / outline.length;
      const ground = terrainHeight(this.data, east, north);
      for (let index = 0; index < outline.length; index += 1) {
        const a = outline[index];
        const b = outline[(index + 1) % outline.length];
        const dx = b[0] - a[0];
        const dz = b[1] - a[1];
        const length = Math.hypot(dx, dz);
        if (length < 0.1) continue;
        const yaw = Math.atan2(-dz, dx);
        this.world.createCollider(RAPIER.ColliderDesc.cuboid(length / 2, building.height / 2, 0.12)
          .setTranslation((a[0] + b[0]) / 2, ground + building.height / 2, (a[1] + b[1]) / 2)
          .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }));
      }
    }
  }

  private addObstacles(): void {
    for (const [east, north] of this.data.trees) {
      this.world.createCollider(RAPIER.ColliderDesc.cylinder(2.85, 0.35)
        .setTranslation(east, terrainHeight(this.data, east, north) + 2.85, north));
    }
    const collision = new CollisionWorld(this.data);
    for (const item of collision.furniture) {
      const halfHeight = item.kind === "planter" ? 0.55 : 0.48;
      this.world.createCollider(RAPIER.ColliderDesc.cylinder(halfHeight, item.radius)
        .setTranslation(item.east, terrainHeight(this.data, item.east, item.north) + halfHeight, item.north));
    }
    for (const item of collision.cover) {
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(1.56, 0.56, 0.35)
        .setTranslation(item.east, terrainHeight(this.data, item.east, item.north) + 0.56, item.north)
        .setRotation({ x: 0, y: Math.sin(item.yaw / 2), z: 0, w: Math.cos(item.yaw / 2) }));
    }
  }

  setArena(arena: Arena): void {
    for (const collider of this.boundary) this.world.removeCollider(collider, true);
    this.boundary = [];
    const [east, north] = toLocal(arena.latitude, arena.longitude);
    const half = arena.sizeMeters / 2;
    for (const side of [-1, 1]) {
      const northEdge = north + side * (half + 0.2);
      const eastEdge = east + side * (half + 0.2);
      this.boundary.push(this.world.createCollider(RAPIER.ColliderDesc.cuboid(half + 0.5, 10, 0.2)
        .setTranslation(east, terrainHeight(this.data, east, northEdge) + 10, northEdge)));
      this.boundary.push(this.world.createCollider(RAPIER.ColliderDesc.cuboid(0.2, 10, half + 0.5)
        .setTranslation(eastEdge, terrainHeight(this.data, eastEdge, north) + 10, north)));
    }
  }

  reset(east: number, north: number): CharacterStep {
    this.halfHeight = STANDING_HALF_HEIGHT;
    this.crouched = false;
    this.collider.setShape(new RAPIER.Capsule(STANDING_HALF_HEIGHT, RADIUS));
    this.body.setTranslation({ x: east, y: terrainHeight(this.data, east, north) + STANDING_HALF_HEIGHT + RADIUS + 0.03, z: north }, true);
    this.world.step();
    return this.position(true);
  }

  setCrouched(wantsCrouch: boolean): boolean {
    if (wantsCrouch === this.crouched) return this.crouched;
    const current = this.body.translation();
    const feet = current.y - this.halfHeight - RADIUS;
    const nextHalfHeight = wantsCrouch ? CROUCHED_HALF_HEIGHT : STANDING_HALF_HEIGHT;
    const nextPosition = { x: current.x, y: feet + nextHalfHeight + RADIUS, z: current.z };
    const nextShape = new RAPIER.Capsule(nextHalfHeight, RADIUS);
    if (!wantsCrouch && this.world.intersectionWithShape(nextPosition, { x: 0, y: 0, z: 0, w: 1 }, nextShape,
      undefined, undefined, this.collider, undefined, (candidate) => candidate.handle !== this.terrainCollider.handle)) return this.crouched;
    this.collider.setShape(nextShape);
    this.body.setTranslation(nextPosition, true);
    this.world.propagateModifiedBodyPositionsToColliders();
    this.halfHeight = nextHalfHeight;
    this.crouched = wantsCrouch;
    return this.crouched;
  }

  move(east: number, north: number, vertical: number): CharacterStep {
    this.controller.computeColliderMovement(this.collider, { x: east, y: vertical, z: north });
    const movement = this.controller.computedMovement();
    const current = this.body.translation();
    this.body.setNextKinematicTranslation({ x: current.x + movement.x, y: current.y + movement.y, z: current.z + movement.z });
    this.world.step();
    return this.position(this.controller.computedGrounded());
  }

  // A ledge in the given horizontal direction the standing character can climb onto:
  // something blocks the way at knee or waist height within reach, its top lies at mantle
  // height, the standing capsule fits on top, and nothing overhead stops the climb. In the
  // air, minHeight drops so a jump that reaches a ledge's edge can still catch it.
  findLedge(directionEast: number, directionNorth: number, minHeight = MIN_MANTLE): Ledge | null {
    const position = this.body.translation();
    const feet = position.y - this.halfHeight - RADIUS;
    const direction = { x: directionEast, y: 0, z: directionNorth };
    const probe = (height: number) => this.world.castRay(new RAPIER.Ray({ x: position.x, y: feet + height, z: position.z }, direction), RADIUS + 0.65, true, undefined, undefined, this.collider);
    const face = probe(0.25) ?? probe(0.7);
    if (!face) return null;
    const standing = new RAPIER.Capsule(STANDING_HALF_HEIGHT, RADIUS);
    const above = feet + MAX_MANTLE + 0.25;
    for (const extra of [0.32, 0.5, 0.68]) {
      const east = position.x + directionEast * (face.timeOfImpact + extra);
      const north = position.z + directionNorth * (face.timeOfImpact + extra);
      const down = this.world.castRay(new RAPIER.Ray({ x: east, y: above, z: north }, { x: 0, y: -1, z: 0 }), MAX_MANTLE + 0.25 - minHeight, true, undefined, undefined, this.collider);
      // A ray that starts inside a wall or tree hits at once: too tall to climb.
      if (!down || down.timeOfImpact < 0.02) continue;
      const surface = above - down.timeOfImpact;
      if (surface - feet > MAX_MANTLE) continue;
      const top = { x: east, y: surface + STANDING_HALF_HEIGHT + RADIUS + 0.03, z: north };
      const raised = { x: position.x, y: top.y, z: position.z };
      if (this.world.intersectionWithShape(top, IDENTITY, standing, undefined, undefined, this.collider)) continue;
      if (this.world.intersectionWithShape(raised, IDENTITY, standing, undefined, undefined, this.collider)) continue;
      if (this.world.castRay(new RAPIER.Ray({ x: position.x, y: surface + 0.3, z: position.z }, direction), face.timeOfImpact + extra, true, undefined, undefined, this.collider)) continue;
      return { east, north, feet: surface };
    }
    return null;
  }

  // Move the character directly, for mantling: no collision response along the way.
  place(east: number, north: number, feet: number): void {
    this.body.setTranslation({ x: east, y: feet + this.halfHeight + RADIUS, z: north }, true);
    this.world.propagateModifiedBodyPositionsToColliders();
  }

  traceShot({ origin, direction, distance }: ShotRay): number {
    return this.world.castRay(new RAPIER.Ray(origin, direction), distance, true, undefined, undefined, this.collider)?.timeOfImpact ?? distance;
  }

  clearShot({ origin, direction, distance }: ShotRay): boolean {
    if (distance <= 0) return true;
    const ray = new RAPIER.Ray(origin, direction);
    return this.world.castRay(ray, distance, true, undefined, undefined, this.collider) === null;
  }

  private position(grounded: boolean): CharacterStep {
    const position = this.body.translation();
    return { east: position.x, north: position.z, feet: position.y - this.halfHeight - RADIUS, grounded };
  }

  dispose(): void {
    this.world.free();
  }
}
