import RAPIER from "@dimforge/rapier3d";
import { terrainHeight, type Arena, type ArenaData } from "./arena";
import { type WorldEntity } from "./entities";
import { type Material } from "./materials";

const RADIUS = 0.3;
const STANDING_HALF_HEIGHT = 0.58;
const CROUCHED_HALF_HEIGHT = 0.28;
const STEP_SECONDS = 1 / 60;
// Ledges between these heights above the feet can be mantled. Lower ones are stepped over
// or jumped; the 1.12 m concrete cover is above the 0.97 m jump apex, so it needs a mantle.
const MIN_MANTLE = 0.45;
const MAX_MANTLE = 1.6;
const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };
const PLAYER_GROUPS = (0x0002 << 16) | 0xffff;
const RAGDOLL_GROUPS = (0x0004 << 16) | 0x0001;
// Other players' bodies on the coordinating peer take part in no contacts: they reach loose
// props only through their character controller, which pushes with a body's mass rather
// than the unstoppable force of a moving kinematic body.
const PUSHER_GROUPS = 0x0008 << 16;
// The most force a player's body puts into a prop it walks into, in newtons: enough to
// shove a crate or a bin along, not a full drum.
const PUSH_FORCE = 800;

export interface Quat { x: number; y: number; z: number; w: number }
export interface RagdollPart { name: string; position: Vec3; rotation: Quat; shape: { type: "capsule"; halfHeight: number; radius: number; rotation: Quat } | { type: "ball"; radius: number } }
export interface RagdollJoint { a: string; b: string; anchor: Vec3; hinge?: { axis: Vec3; limits: [number, number] } }
export interface Ragdoll { pose(name: string): { position: Vec3; rotation: Quat } | null; remove(): void }

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

export interface Vec3 { x: number; y: number; z: number }

export interface SurfaceHit { distance: number; thickness: number; point: Vec3; normal: Vec3; material: Material; entity?: string }

export interface GrenadePath { points: Vec3[]; bounces: { index: number; speed: number }[]; step: number }

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
  // What each collider is made of and which world entity, if any, it belongs to.
  private tags = new Map<number, { material: Material; entity?: string }>();
  private entityColliders = new Map<string, RAPIER.Collider>();
  private entities = new Map<string, WorldEntity>();
  // Ragdoll parts are cosmetic: they collide with the world but never block players,
  // bullets, ledge checks or grenades.
  private cosmetic = new Set<number>();
  private solid = (collider: RAPIER.Collider): boolean => !this.cosmetic.has(collider.handle);
  private idleTime = 0;
  steps = 0;
  // Loose props: simulated here when this peer coordinates the room, otherwise moved to
  // the coordinator's reported transforms.
  private props = new Map<string, RAPIER.RigidBody>();
  private propHandles = new Set<number>();
  private authority = true;
  // Other players as kinematic capsules, so they shove props on the coordinating peer.
  private pushers = new Map<string, { body: RAPIER.RigidBody; collider: RAPIER.Collider; crouched: boolean }>();
  private pusherController: RAPIER.KinematicCharacterController;
  // Doors and hatches: fixed colliders moved whenever they open or close.
  private movers = new Map<string, RAPIER.Collider>();
  // Shoves the player gave props this peer does not simulate, waiting to be sent.
  private shoves = new Map<string, Vec3>();

  constructor(private data: ArenaData, arena: Arena) {
    this.world = new RAPIER.World({ x: 0, y: -14, z: 0 });
    this.world.integrationParameters.dt = STEP_SECONDS;
    this.addTerrain();
    this.setArena(arena);
    this.body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    // The player belongs to group 2 only, so ragdolls (which collide only with group 1) pass it by.
    this.collider = this.world.createCollider(RAPIER.ColliderDesc.capsule(STANDING_HALF_HEIGHT, RADIUS).setCollisionGroups(PLAYER_GROUPS), this.body);
    this.controller = this.world.createCharacterController(0.015);
    // Steps up to 26 cm are walked up: kerbs, the bar stair and the food truck's bumper step.
    this.controller.enableAutostep(0.26, 0.15, false);
    this.controller.enableSnapToGround(0.28);
    this.controller.setMaxSlopeClimbAngle(45 * Math.PI / 180);
    // Walking into a loose prop shoves it with the force a body of the player's mass can
    // put into it: a cardboard box flies, a full drum barely shifts.
    this.controller.setApplyImpulsesToDynamicBodies(true);
    this.controller.setCharacterMass(80);
    this.pusherController = this.world.createCharacterController(0.015);
    this.pusherController.setApplyImpulsesToDynamicBodies(true);
    this.pusherController.setCharacterMass(80);
    this.world.step();
  }

  setCharacterMass(kilograms: number): void { this.controller.setCharacterMass(kilograms); }

  // Moves another player's body to where they are, shoving any loose prop in the way with
  // their mass. Their own client decides where they go; this only pushes the props.
  movePusher(id: string, east: number, north: number, feet: number, crouched: boolean, kilograms: number): void {
    if (!this.authority) return;
    let pusher = this.pushers.get(id);
    const halfHeight = crouched ? CROUCHED_HALF_HEIGHT : STANDING_HALF_HEIGHT;
    const target = { x: east, y: feet + halfHeight + RADIUS, z: north };
    if (!pusher) {
      const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(target.x, target.y, target.z));
      const collider = this.world.createCollider(RAPIER.ColliderDesc.capsule(halfHeight, RADIUS).setCollisionGroups(PUSHER_GROUPS), body);
      this.cosmetic.add(collider.handle);
      pusher = { body, collider, crouched };
      this.pushers.set(id, pusher);
      return;
    }
    if (pusher.crouched !== crouched) { pusher.collider.setShape(new RAPIER.Capsule(halfHeight, RADIUS)); pusher.crouched = crouched; }
    const current = pusher.body.translation();
    const delta = { x: target.x - current.x, y: target.y - current.y, z: target.z - current.z };
    // Respawns and corrections teleport without sweeping through props.
    if (Math.hypot(delta.x, delta.z) < 1.5) {
      this.pusherController.setCharacterMass(kilograms);
      this.pusherController.computeColliderMovement(pusher.collider, delta, undefined, undefined, (collider) => this.propHandles.has(collider.handle));
    }
    pusher.body.setNextKinematicTranslation(target);
  }

  removePusher(id: string): void {
    const pusher = this.pushers.get(id);
    if (!pusher) return;
    this.cosmetic.delete(pusher.collider.handle);
    this.world.removeRigidBody(pusher.body);
    this.pushers.delete(id);
  }

  pusherIds(): string[] { return [...this.pushers.keys()]; }

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
    this.tags.set(this.terrainCollider.handle, { material: "ground" });
  }

  // Stalls, glass and props are world entities with their own colliders, so a destroyed one
  // can be removed and every bullet knows what it struck.
  addEntity(entity: WorldEntity): void {
    if (!entity.shape || this.entityColliders.has(entity.id)) return;
    const shape = entity.shape;
    const desc = shape.type === "box" ? RAPIER.ColliderDesc.cuboid(...shape.half) : RAPIER.ColliderDesc.cylinder(shape.halfHeight, shape.radius);
    const rotation = { x: 0, y: Math.sin(entity.yaw / 2), z: 0, w: Math.cos(entity.yaw / 2) };
    let collider: RAPIER.Collider;
    if (entity.mass) {
      const volume = shape.type === "box" ? 8 * shape.half[0] * shape.half[1] * shape.half[2] : Math.PI * shape.radius ** 2 * 2 * shape.halfHeight;
      const body = this.world.createRigidBody((this.authority ? RAPIER.RigidBodyDesc.dynamic() : RAPIER.RigidBodyDesc.kinematicPositionBased())
        .setTranslation(entity.center.x, entity.center.y, entity.center.z).setRotation(rotation).setLinearDamping(0.1).setAngularDamping(0.5).setCcdEnabled(true));
      collider = this.world.createCollider(desc.setDensity(entity.mass / volume).setFriction(0.7).setRestitution(0.15), body);
      this.props.set(entity.id, body);
      this.propHandles.add(collider.handle);
    } else {
      collider = this.world.createCollider(desc.setTranslation(entity.center.x, entity.center.y, entity.center.z).setRotation(rotation));
    }
    this.tags.set(collider.handle, { material: entity.material, entity: entity.id });
    this.entityColliders.set(entity.id, collider);
    this.entities.set(entity.id, entity);
  }

  removeEntity(id: string): void {
    const collider = this.entityColliders.get(id);
    if (!collider) return;
    this.tags.delete(collider.handle);
    this.propHandles.delete(collider.handle);
    const body = this.props.get(id);
    if (body) { this.world.removeRigidBody(body); this.props.delete(id); }
    else this.world.removeCollider(collider, true);
    this.entityColliders.delete(id);
  }

  // Where a loose prop is now, or null for fixed and destroyed entities.
  propPose(id: string): { position: Vec3; rotation: Quat } | null {
    const body = this.props.get(id);
    if (!body) return null;
    const t = body.translation(), r = body.rotation();
    return { position: { x: t.x, y: t.y, z: t.z }, rotation: { x: r.x, y: r.y, z: r.z, w: r.w } };
  }

  propIds(): string[] { return [...this.props.keys()]; }

  // Props that are moving, or with all set every prop that has left its starting place.
  propStates(all: boolean): [string, number, number, number, number, number, number, number][] {
    const states: [string, number, number, number, number, number, number, number][] = [];
    for (const [id, body] of this.props) {
      const start = this.entities.get(id)!.center, t = body.translation(), r = body.rotation();
      const moved = Math.hypot(t.x - start.x, t.y - start.y, t.z - start.z) > 0.03 || Math.abs(r.x) + Math.abs(r.z) > 0.02;
      if (all ? moved : !body.isSleeping() && body.isDynamic()) {
        const round = (value: number): number => Math.round(value * 1000) / 1000;
        states.push([id, round(t.x), round(t.y), round(t.z), round(r.x), round(r.y), round(r.z), round(r.w)]);
      }
    }
    return states;
  }

  // Moves props this peer does not simulate to the coordinator's transforms.
  applyPropStates(states: [string, number, number, number, number, number, number, number][]): void {
    if (this.authority) return;
    for (const [id, x, y, z, qx, qy, qz, qw] of states) {
      const body = this.props.get(id);
      if (!body || ![x, y, z, qx, qy, qz, qw].every(Number.isFinite)) continue;
      body.setNextKinematicTranslation({ x, y, z });
      body.setNextKinematicRotation({ x: qx, y: qy, z: qz, w: qw });
    }
  }

  setAuthority(authority: boolean): void {
    if (authority === this.authority) return;
    this.authority = authority;
    for (const body of this.props.values()) body.setBodyType(authority ? RAPIER.RigidBodyType.Dynamic : RAPIER.RigidBodyType.KinematicPositionBased, true);
    if (!authority) for (const id of this.pusherIds()) this.removePusher(id);
  }

  // A bullet or blast pushing a loose prop.
  push(id: string, point: Vec3, impulse: Vec3): void {
    const body = this.props.get(id);
    if (body && body.isDynamic()) body.applyImpulseAtPoint(impulse, point, true);
  }

  // A door or hatch: a thin box of a material, placed and turned with setMover. A door leaf
  // that can be shot off its hinges names its entity, so rounds that strike it wear it down.
  addMover(id: string, half: [number, number, number], material: Material, entity?: string): void {
    const collider = this.world.createCollider(RAPIER.ColliderDesc.cuboid(...half));
    this.tags.set(collider.handle, entity ? { material, entity } : { material });
    this.movers.set(id, collider);
  }

  // Where a door or hatch is now.
  moverCenter(id: string): Vec3 | null {
    const collider = this.movers.get(id);
    if (!collider) return null;
    const t = collider.translation();
    return { x: t.x, y: t.y, z: t.z };
  }

  // A leaf blown off its hinges stops blocking anything until the room resets.
  setMoverEnabled(id: string, enabled: boolean): void {
    this.movers.get(id)?.setEnabled(enabled);
  }

  setMover(id: string, center: Vec3, rotation: Quat): void {
    const collider = this.movers.get(id);
    if (!collider) return;
    collider.setTranslation(center);
    collider.setRotation(rotation);
  }

  // Back to the starting layout, for a new room.
  resetProps(): void {
    for (const [id, body] of this.props) {
      const entity = this.entities.get(id)!;
      body.setTranslation(entity.center, true);
      body.setRotation({ x: 0, y: Math.sin(entity.yaw / 2), z: 0, w: Math.cos(entity.yaw / 2) }, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
  }

  restoreEntity(id: string): void {
    const entity = this.entities.get(id);
    if (entity && !this.entityColliders.has(id)) this.addEntity(entity);
  }

  setArena(arena: Arena): void {
    for (const collider of this.boundary) this.world.removeCollider(collider, true);
    this.boundary = [];
    const east = 0, north = 0, half = arena.sizeMeters / 2;
    for (const side of [-1, 1]) {
      const northEdge = north + side * (half + 0.2);
      const eastEdge = east + side * (half + 0.2);
      this.boundary.push(this.world.createCollider(RAPIER.ColliderDesc.cuboid(half + 0.5, 10, 0.2)
        .setTranslation(east, terrainHeight(this.data, east, northEdge) + 10, northEdge)));
      this.boundary.push(this.world.createCollider(RAPIER.ColliderDesc.cuboid(0.2, 10, half + 0.5)
        .setTranslation(eastEdge, terrainHeight(this.data, eastEdge, north) + 10, north)));
    }
    for (const collider of this.boundary) this.tags.set(collider.handle, { material: "boundary" });
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
      undefined, undefined, this.collider, undefined, (candidate) => candidate.handle !== this.terrainCollider.handle && this.solid(candidate))) return this.crouched;
    this.collider.setShape(nextShape);
    this.body.setTranslation(nextPosition, true);
    this.world.propagateModifiedBodyPositionsToColliders();
    this.halfHeight = nextHalfHeight;
    this.crouched = wantsCrouch;
    return this.crouched;
  }

  move(east: number, north: number, vertical: number): CharacterStep {
    this.controller.computeColliderMovement(this.collider, { x: east, y: vertical, z: north }, undefined, undefined, this.solid);
    if (!this.authority) this.collectShoves(east, north);
    this.steps += 1;
    const movement = this.controller.computedMovement();
    const current = this.body.translation();
    this.body.setNextKinematicTranslation({ x: current.x + movement.x, y: current.y + movement.y, z: current.z + movement.z });
    this.world.step();
    return this.position(this.controller.computedGrounded());
  }

  // Where another peer simulates the props, the local copies cannot move, so the character
  // controller's own push does nothing. Walking into one is recorded instead, as the impulse
  // the player's mass would give it: as much of the walk as the prop blocked, up to a
  // body's pushing force.
  private collectShoves(east: number, north: number): void {
    const mass = this.controller.characterMass() ?? 80;
    for (let index = 0; index < this.controller.numComputedCollisions(); index += 1) {
      const hit = this.controller.computedCollision(index);
      const handle = hit?.collider?.handle;
      if (!hit || handle === undefined || !this.propHandles.has(handle)) continue;
      const id = this.tags.get(handle)?.entity;
      const n = hit.normal1, flat = Math.hypot(n.x, n.z);
      if (!id || flat < 0.3) continue;
      const into = -(east * n.x + north * n.z) / flat / STEP_SECONDS;
      if (into <= 0.05) continue;
      const impulse = Math.min(mass * into, PUSH_FORCE * STEP_SECONDS);
      const total = this.shoves.get(id) ?? { x: 0, y: 0, z: 0 };
      total.x -= n.x / flat * impulse;
      total.z -= n.z / flat * impulse;
      this.shoves.set(id, total);
    }
  }

  takeShoves(): [string, number, number, number][] {
    // A long frame can gather more than a packet may carry; the excess is lost, as a body
    // cannot lean harder than that anyway.
    const shoves = [...this.shoves].map(([id, v]): [string, number, number, number] => {
      const scale = Math.min(1, 100 / (Math.hypot(v.x, v.z) || 1));
      return [id, Math.round(v.x * scale * 100) / 100, 0, Math.round(v.z * scale * 100) / 100];
    });
    this.shoves.clear();
    return shoves;
  }

  // Shoves another player gave props this peer simulates, applied a little above the
  // middle of each prop the way a hip or hand meets it.
  applyShoves(shoves: [string, number, number, number][]): void {
    for (const [id, x, y, z] of shoves) {
      const body = this.props.get(id);
      if (!body || !body.isDynamic()) continue;
      const at = body.translation();
      body.applyImpulseAtPoint({ x, y, z }, { x: at.x, y: at.y + 0.1, z: at.z }, true);
    }
  }

  // A ledge in the given horizontal direction the standing character can climb onto:
  // something blocks the way at knee or waist height within reach, its top lies at mantle
  // height, the standing capsule fits on top, and nothing overhead stops the climb. In the
  // air, minHeight drops so a jump that reaches a ledge's edge can still catch it.
  findLedge(directionEast: number, directionNorth: number, minHeight = MIN_MANTLE): Ledge | null {
    const position = this.body.translation();
    const feet = position.y - this.halfHeight - RADIUS;
    const direction = { x: directionEast, y: 0, z: directionNorth };
    const probe = (height: number) => this.world.castRay(new RAPIER.Ray({ x: position.x, y: feet + height, z: position.z }, direction), RADIUS + 0.65, true, undefined, undefined, this.collider, undefined, this.solid);
    const face = probe(0.25) ?? probe(0.7);
    if (!face) return null;
    const standing = new RAPIER.Capsule(STANDING_HALF_HEIGHT, RADIUS);
    const above = feet + MAX_MANTLE + 0.25;
    for (const extra of [0.32, 0.5, 0.68]) {
      const east = position.x + directionEast * (face.timeOfImpact + extra);
      const north = position.z + directionNorth * (face.timeOfImpact + extra);
      const down = this.world.castRay(new RAPIER.Ray({ x: east, y: above, z: north }, { x: 0, y: -1, z: 0 }), MAX_MANTLE + 0.25 - minHeight, true, undefined, undefined, this.collider, undefined, this.solid);
      // A ray that starts inside a wall or tree hits at once: too tall to climb.
      if (!down || down.timeOfImpact < 0.02) continue;
      const surface = above - down.timeOfImpact;
      if (surface - feet > MAX_MANTLE) continue;
      const top = { x: east, y: surface + STANDING_HALF_HEIGHT + RADIUS + 0.03, z: north };
      const raised = { x: position.x, y: top.y, z: position.z };
      if (this.world.intersectionWithShape(top, IDENTITY, standing, undefined, undefined, this.collider, undefined, this.solid)) continue;
      if (this.world.intersectionWithShape(raised, IDENTITY, standing, undefined, undefined, this.collider, undefined, this.solid)) continue;
      if (this.world.castRay(new RAPIER.Ray({ x: position.x, y: surface + 0.3, z: position.z }, direction), face.timeOfImpact + extra, true, undefined, undefined, this.collider, undefined, this.solid)) continue;
      return { east, north, feet: surface };
    }
    return null;
  }

  // Move the character directly, for mantling: no collision response along the way.
  place(east: number, north: number, feet: number): void {
    this.body.setTranslation({ x: east, y: feet + this.halfHeight + RADIUS, z: north }, true);
    this.world.propagateModifiedBodyPositionsToColliders();
  }

  // Every surface along a ray, nearest first, with how thick each one is where the ray
  // crosses it. A bullet striking a building wall at a window also strikes the glass.
  traceBullet({ origin, direction, distance }: ShotRay, windowAt: (point: Vec3) => string | null = () => null): SurfaceHit[] {
    const hits: SurfaceHit[] = [];
    this.world.intersectionsWithRay(new RAPIER.Ray(origin, direction), distance, true, (hit) => {
      const tag = this.tags.get(hit.collider.handle) ?? { material: "ground" as Material };
      if (tag.material === "boundary") return true;
      const toi = hit.timeOfImpact;
      const point = { x: origin.x + direction.x * toi, y: origin.y + direction.y * toi, z: origin.z + direction.z * toi };
      const inside = new RAPIER.Ray({ x: point.x + direction.x * 0.002, y: point.y + direction.y * 0.002, z: point.z + direction.z * 0.002 }, direction);
      const exit = hit.collider.castRay(inside, 20, false);
      const normal = { x: hit.normal.x, y: hit.normal.y, z: hit.normal.z };
      hits.push({ distance: toi, thickness: exit >= 0 ? exit + 0.002 : 0.02, point, normal, material: tag.material, entity: tag.entity });
      if (tag.material === "brick") {
        const window = windowAt(point);
        if (window) hits.push({ distance: Math.max(0, toi - 0.05), thickness: 0.01, point, normal, material: "glass", entity: window });
      }
      return true;
    }, undefined, undefined, this.collider, undefined, this.solid);
    return hits.sort((a, b) => a.distance - b.distance);
  }

  // A thrown grenade's flight: gravity, bounces that lose energy and skid, then rest.
  // Points are sampled every `step` seconds for drawing; the last one is where it bursts.
  grenadePath(origin: Vec3, velocity: Vec3, seconds: number): GrenadePath {
    const dt = 1 / 120, radius = 0.06, step = 1 / 60;
    const position = { ...origin }, speed = { ...velocity };
    const points: Vec3[] = [{ ...position }], bounces: GrenadePath["bounces"] = [];
    let resting = false;
    for (let tick = 1; tick <= Math.round(seconds / dt); tick += 1) {
      if (!resting) {
        speed.y -= 14 * dt;
        const move = { x: speed.x * dt, y: speed.y * dt, z: speed.z * dt };
        const length = Math.hypot(move.x, move.y, move.z);
        const direction = { x: move.x / length, y: move.y / length, z: move.z / length };
        const hit = length > 1e-6 ? this.world.castRayAndGetNormal(new RAPIER.Ray(position, direction), length + radius, true, undefined, undefined, this.collider, undefined, this.solid) : null;
        if (hit) {
          const travel = Math.max(0, hit.timeOfImpact - radius);
          position.x += direction.x * travel; position.y += direction.y * travel; position.z += direction.z * travel;
          const n = hit.normal, along = speed.x * n.x + speed.y * n.y + speed.z * n.z;
          if (along < 0) {
            const impact = -along;
            // Restitution along the normal, friction across it.
            for (const axis of ["x", "y", "z"] as const) {
              const normalPart = along * n[axis], tangent = speed[axis] - normalPart;
              speed[axis] = -0.38 * normalPart + tangent * 0.72;
            }
            if (impact > 1.2) bounces.push({ index: Math.ceil(tick * dt / step), speed: impact });
          }
          if (Math.hypot(speed.x, speed.y, speed.z) < 0.6 && n.y > 0.6) { resting = true; speed.x = speed.y = speed.z = 0; }
        } else {
          position.x += move.x; position.y += move.y; position.z += move.z;
        }
      }
      if (tick % 2 === 0) points.push({ ...position });
    }
    return { points, bounces, step };
  }

  // The map's fixed solids: walls, floors, counters and stair ramps. Railings use the boundary
  // material, so they stop players but let rounds through.
  addBox(half: [number, number, number], position: Vec3, rotation: Quat, material: Material): void {
    const collider = this.world.createCollider(RAPIER.ColliderDesc.cuboid(...half).setTranslation(position.x, position.y, position.z).setRotation(rotation));
    this.tags.set(collider.handle, { material });
  }

  // Steps the world at 60 Hz when the player is not moving it (paused or eliminated), so
  // ragdolls and loose props keep falling.
  advance(seconds: number): void {
    this.idleTime = Math.min(0.1, this.idleTime + seconds);
    while (this.idleTime >= STEP_SECONDS) { this.world.step(); this.idleTime -= STEP_SECONDS; }
  }

  // Linked bodies for a falling character. Parts start at rest in the given pose with a
  // shared velocity; an impulse can knock one part. Hinges bend about their axis within limits.
  createRagdoll(parts: RagdollPart[], joints: RagdollJoint[], velocity: Vec3, impulse?: { part: string; vector: Vec3 }): Ragdoll {
    const bodies = new Map<string, RAPIER.RigidBody>();
    for (const part of parts) {
      const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(part.position.x, part.position.y, part.position.z)
        .setRotation(part.rotation).setLinvel(velocity.x, velocity.y, velocity.z).setLinearDamping(0.15).setAngularDamping(1.2).setCcdEnabled(true));
      const shape = part.shape;
      const desc = shape.type === "capsule" ? RAPIER.ColliderDesc.capsule(shape.halfHeight, shape.radius).setRotation(shape.rotation) : RAPIER.ColliderDesc.ball(shape.radius);
      const collider = this.world.createCollider(desc.setDensity(985).setFriction(0.9).setRestitution(0.05).setCollisionGroups(RAGDOLL_GROUPS), body);
      this.cosmetic.add(collider.handle);
      bodies.set(part.name, body);
    }
    // A world point in a body's own frame: the offset rotated by the inverse rotation,
    // using v' = v + 2w(u x v) + 2u x (u x v) with u the negated vector part.
    const local = (body: RAPIER.RigidBody, point: Vec3): Vec3 => {
      const t = body.translation(), r = body.rotation();
      const v = { x: point.x - t.x, y: point.y - t.y, z: point.z - t.z }, u = { x: -r.x, y: -r.y, z: -r.z }, w = r.w;
      const c1 = { x: u.y * v.z - u.z * v.y, y: u.z * v.x - u.x * v.z, z: u.x * v.y - u.y * v.x };
      const c2 = { x: u.y * c1.z - u.z * c1.y, y: u.z * c1.x - u.x * c1.z, z: u.x * c1.y - u.y * c1.x };
      return { x: v.x + 2 * (w * c1.x + c2.x), y: v.y + 2 * (w * c1.y + c2.y), z: v.z + 2 * (w * c1.z + c2.z) };
    };
    for (const joint of joints) {
      const a = bodies.get(joint.a), b = bodies.get(joint.b);
      if (!a || !b) continue;
      let data: RAPIER.JointData;
      if (joint.hinge) {
        data = RAPIER.JointData.revolute(local(a, joint.anchor), local(b, joint.anchor), joint.hinge.axis);
        data.limitsEnabled = true;
        data.limits = joint.hinge.limits;
      } else data = RAPIER.JointData.spherical(local(a, joint.anchor), local(b, joint.anchor));
      this.world.createImpulseJoint(data, a, b, true);
    }
    if (impulse) bodies.get(impulse.part)?.applyImpulse(impulse.vector, true);
    return {
      pose: (name) => {
        const body = bodies.get(name);
        if (!body) return null;
        const t = body.translation(), r = body.rotation();
        return { position: { x: t.x, y: t.y, z: t.z }, rotation: { x: r.x, y: r.y, z: r.z, w: r.w } };
      },
      remove: () => {
        for (const body of bodies.values()) {
          for (let index = 0; index < body.numColliders(); index += 1) this.cosmetic.delete(body.collider(index).handle);
          this.world.removeRigidBody(body);
        }
        bodies.clear();
      },
    };
  }

  // The first solid surface along a short segment and its normal, for small debris.
  sweep(origin: Vec3, direction: Vec3, distance: number): { distance: number; normal: Vec3 } | null {
    const hit = this.world.castRayAndGetNormal(new RAPIER.Ray(origin, direction), distance, true, undefined, undefined, this.collider, undefined, this.solid);
    return hit ? { distance: hit.timeOfImpact, normal: { x: hit.normal.x, y: hit.normal.y, z: hit.normal.z } } : null;
  }

  traceShot({ origin, direction, distance }: ShotRay): number {
    return this.world.castRay(new RAPIER.Ray(origin, direction), distance, true, undefined, undefined, this.collider, undefined, this.solid)?.timeOfImpact ?? distance;
  }

  clearShot({ origin, direction, distance }: ShotRay): boolean {
    if (distance <= 0) return true;
    const ray = new RAPIER.Ray(origin, direction);
    return this.world.castRay(ray, distance, true, undefined, undefined, this.collider, undefined, this.solid) === null;
  }

  private position(grounded: boolean): CharacterStep {
    const position = this.body.translation();
    return { east: position.x, north: position.z, feet: position.y - this.halfHeight - RADIUS, grounded };
  }

  dispose(): void {
    this.world.free();
  }
}
