import RAPIER from "@dimforge/rapier3d";
import { terrainHeight, type Arena, type ArenaData } from "./arena";
import { type WorldEntity } from "./entities";
import { type Material } from "./materials";
import { STRIKE_SPEED, type HitZone } from "../game/combatRules";

const RADIUS = 0.3;
const STANDING_HALF_HEIGHT = 0.58;
const CROUCHED_HALF_HEIGHT = 0.28;
const STEP_SECONDS = 1 / 60;
// Ledges between these heights above the feet can be mantled. Lower ones are stepped over
// or jumped; the 1.12 m concrete cover is above the 0.97 m jump apex, so it needs a mantle.
const MIN_MANTLE = 0.45;
const MAX_MANTLE = 1.6;
const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };
// The player takes part in no contacts: props are moved only by the character controller, with
// the mass of the player's body, not the unstoppable force of a moving kinematic body.
const PLAYER_GROUPS = 0x0002 << 16;
const RAGDOLL_GROUPS = (0x0004 << 16) | 0x0001;
// The most force a player's body puts into a prop it walks into, in newtons: enough to
// shove a crate or a bin along, not a full drum.
const PUSH_FORCE = 800;
// A prop another peer owns glides to each place it reports over a little more than the gap
// between reports. An owner silent for this long has gone, and the coordinating peer takes over.
const FOLLOW_SECONDS = 0.08;
const OWNER_SILENCE_MS = 1500;
// A prop this slow for this long has come to rest, and its owner lets it go.
const QUIET_SPEED = 0.06;
const QUIET_SPIN = 0.12;
const QUIET_SECONDS = 0.5;
// A carried prop is steered, not placed: the hands close the gap to where it should be at this
// rate, up to this speed relative to the player, with this much force, so a stool snaps into
// place and a loaded crate swings after the player. It collides with the world on the way.
const HOLD_GAIN = 14;
const HOLD_SPEED = 12;
const HOLD_FORCE = 500;
const HOLD_TURN = 9;
const HOLD_TURN_GAIN = 10;
// Held this far from where the hands want it for this long, something has got in the way, and
// the player loses their grip.
const HOLD_SLACK = 0.5;
const HOLD_STRAIN_SECONDS = 0.3;
// A lifted prop comes straight up for up to this long before coming in to the hands, so a stool
// on the far side of a table is lifted over it instead of pulled into it.
const HOLD_RISE_SECONDS = 0.3;
// The hands follow the eyes only so far up and down, and less than the eyes do.
const HOLD_LOOK = 30 * Math.PI / 180;
const HOLD_LOOK_SHARE = 0.6;
// A sudden change of speed this large is a knock worth hearing, and one this large can hurt the
// prop itself. The player who let go of a prop is out of its way for a moment.
const KNOCK_SPEED = 1.6;
const SMASH_SPEED = 6.3;
const KNOCK_GAP_MS = 130;
const CLEAR_OF_THROWER_MS = 500;
// The most a throw can lift its aim for gravity: as for a flight of this long.
const AIM_FLIGHT_SECONDS = 0.6;
// A body struck by a prop counts as this heavy, and the prop rebounds from it this much.
const STRUCK_BODY_MASS = 80;
const STRUCK_BOUNCE = 0.25;
const STRUCK_GAP_MS = 600;
// Hit zones by height above the feet, as for a bullet (combatRules.ts).
const HEAD_HEIGHT = 1.45;
const TORSO_HEIGHT = 0.73;

export interface Quat { x: number; y: number; z: number; w: number }
export type PropTransform = [string, number, number, number, number, number, number, number];
interface Followed { owner: string; from: number[]; to: number[]; progress: number; resting: boolean; heard: number }
// out and low place it from the eyes; turn keeps the way it faced the player when lifted; draw
// is how far it has been pulled back for a throw, 0 to 1.
interface Held { id: string; body: RAPIER.RigidBody; handle: number; mass: number; out: number; low: number; high: number; turn: number; draw: number; strain: number; rise: number }
// Another player, for working out what a flying prop hits.
export interface StrikeTarget { id: string; east: number; feet: number; north: number; crouching: boolean }
// A prop this peer simulates hit a player, target "" being this peer's own player. thrown says
// a player threw it, rather than it falling or being knocked.
export interface Strike { prop: string; target: string; speed: number; zone: HitZone; thrown: boolean }
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
  // Loose props. Each has one owner at a time: the peer that touched it first simulates it and
  // tells the others where it is. A prop at rest has no owner and is held still everywhere.
  private props = new Map<string, RAPIER.RigidBody>();
  private propHandles = new Set<number>();
  private owned = new Set<string>();
  private followed = new Map<string, Followed>();
  // How long each prop this peer owns has been all but still.
  private quiet = new Map<string, number>();
  // Doors and hatches: fixed colliders moved whenever they open or close.
  private movers = new Map<string, RAPIER.Collider>();
  // Shoves the player gave props another peer owns, waiting to be sent to that peer.
  private shoves = new Map<string, { owner: string; push: Vec3; speed: number }>();
  // The prop in the player's hands, and where the player is looking.
  private held: Held | null = null;
  private view = { heading: 0, pitch: 0, eyeHeight: 1.72 };
  private walking = { x: 0, y: 0, z: 0 };
  private released: { id: string; at: number } | null = null;
  // Props a player threw, until they settle: what they hit is that player's doing.
  private thrown = new Set<string>();
  private targets: StrikeTarget[] = [];
  private struck = new Map<string, number>();
  private strikes: Strike[] = [];
  private smashes: [string, number][] = [];
  private knocks: [string, number][] = [];
  private knocked = new Map<string, number>();
  private speeds = new Map<string, [number, number, number]>();
  private lastPlace = new Map<string, number[]>();
  private standing = new RAPIER.Capsule(STANDING_HALF_HEIGHT, RADIUS);
  private crouchingBody = new RAPIER.Capsule(CROUCHED_HALF_HEIGHT, RADIUS);
  // Players walk through what they carry, and bullets do not.
  private walkable = (collider: RAPIER.Collider): boolean => this.solid(collider) && collider.handle !== this.held?.handle;

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
    this.world.step();
  }

  setCharacterMass(kilograms: number): void { this.controller.setCharacterMass(kilograms); }

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
      const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased()
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
    this.owned.delete(id);
    this.quiet.delete(id);
    this.followed.delete(id);
    this.forget(id);
    if (this.held?.id === id) this.held = null;
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

  // The state of a prop to send to other peers: [id, x, y, z, qx, qy, qz, qw].
  private propState(id: string, body: RAPIER.RigidBody): PropTransform {
    const t = body.translation(), r = body.rotation();
    const round = (value: number): number => Math.round(value * 1000) / 1000;
    return [id, round(t.x), round(t.y), round(t.z), round(r.x), round(r.y), round(r.z), round(r.w)];
  }

  // Starts simulating a prop nobody owns, on this peer.
  private claim(id: string, body: RAPIER.RigidBody): void {
    if (this.owned.has(id) || this.followed.has(id)) return;
    body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    this.owned.add(id);
    this.quiet.set(id, 0);
  }

  // What this peer has to tell the others: the props it is moving, and those that have just
  // settled, which it lets go. A prop whose owner has gone quiet in mid-air is taken over by
  // the coordinating peer, so it finishes falling.
  propTraffic(leading: boolean): { moving: PropTransform[]; settled: PropTransform[] } {
    const moving: PropTransform[] = [], settled: PropTransform[] = [];
    for (const id of this.owned) {
      const body = this.props.get(id);
      if (!body) continue;
      const state = this.propState(id, body);
      if ((this.quiet.get(id) ?? 0) < QUIET_SECONDS) { moving.push(state); continue; }
      settled.push(state);
      this.owned.delete(id);
      this.quiet.delete(id);
      this.forget(id);
      const t = body.translation(), r = body.rotation();
      body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, false);
      body.setNextKinematicTranslation(t);
      body.setNextKinematicRotation(r);
    }
    if (leading) {
      const now = performance.now();
      for (const [id, follow] of this.followed) {
        if (follow.resting || now - follow.heard < OWNER_SILENCE_MS) continue;
        this.followed.delete(id);
        const body = this.props.get(id);
        if (body) this.claim(id, body);
      }
    }
    return { moving, settled };
  }

  // Every prop at rest away from where it started, for a player who has just joined.
  displacedProps(): PropTransform[] {
    const states: PropTransform[] = [];
    for (const [id, body] of this.props) {
      if (this.owned.has(id) || this.followed.has(id)) continue;
      const start = this.entities.get(id)!.center, t = body.translation(), r = body.rotation(), yaw = this.entities.get(id)!.yaw;
      const turned = Math.abs(r.x) + Math.abs(r.z) > 0.02 || Math.abs(Math.abs(r.y) - Math.abs(Math.sin(yaw / 2))) > 0.02;
      if (Math.hypot(t.x - start.x, t.y - start.y, t.z - start.z) > 0.03 || turned) states.push(this.propState(id, body));
    }
    return states;
  }

  // What another peer says about props it owns, or, with resting set, where props have come
  // to rest. Two peers can claim one prop in the same moment: the lower id keeps it.
  applyPropStates(states: PropTransform[], owner: string, resting: boolean, self: string): void {
    const now = performance.now();
    for (const [id, x, y, z, qx, qy, qz, qw] of states) {
      const body = this.props.get(id);
      if (!body || ![x, y, z, qx, qy, qz, qw].every(Number.isFinite) || Math.abs(x) > 60 || Math.abs(z) > 60 || y < -5 || y > 40) continue;
      if (this.owned.has(id)) {
        if (resting || owner > self) continue;
        if (this.held?.id === id) this.letGo();
        this.owned.delete(id);
        this.forget(id);
        body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, false);
      }
      const current = this.followed.get(id);
      if (current && current.owner !== owner && (resting || (now - current.heard < OWNER_SILENCE_MS && owner > current.owner))) continue;
      const t = body.translation(), r = body.rotation();
      this.followed.set(id, { owner, from: [t.x, t.y, t.z, r.x, r.y, r.z, r.w], to: [x, y, z, qx, qy, qz, qw], progress: 0, resting, heard: now });
    }
  }

  // Before each step: props another peer owns glide to where it last said they were, a packet
  // behind so they move smoothly between packets.
  private followProps(): void {
    for (const [id, follow] of this.followed) {
      const body = this.props.get(id);
      if (!body) { this.followed.delete(id); continue; }
      follow.progress = Math.min(1, follow.progress + STEP_SECONDS / FOLLOW_SECONDS);
      const { from, to, progress: t } = follow;
      const at = (index: number): number => from[index] + (to[index] - from[index]) * t;
      // Quaternions may come with either sign; turn the short way.
      const sign = from[3] * to[3] + from[4] * to[4] + from[5] * to[5] + from[6] * to[6] < 0 ? -1 : 1;
      const turn = (index: number): number => from[index] + (sign * to[index] - from[index]) * t;
      const [qx, qy, qz, qw] = [turn(3), turn(4), turn(5), turn(6)], length = Math.hypot(qx, qy, qz, qw) || 1;
      body.setNextKinematicTranslation({ x: at(0), y: at(1), z: at(2) });
      body.setNextKinematicRotation({ x: qx / length, y: qy / length, z: qz / length, w: qw / length });
      if (t >= 1 && follow.resting) this.followed.delete(id);
    }
  }

  // Before each step: a moving prop this peer owns takes over the free props it is about to
  // touch, so what it hits moves with its full momentum and a stack comes down together.
  private spreadOwnership(): void {
    const reached: string[] = [];
    for (const id of this.owned) {
      const body = this.props.get(id), shape = this.entities.get(id)?.shape;
      if (!body || !shape) continue;
      // A body pinned in place by its contacts can go on reporting a small velocity for ever,
      // so what counts is how far it really went in the last step.
      const v = body.linvel(), w = body.angvel(), t = body.translation(), r = body.rotation(), was = this.lastPlace.get(id);
      this.lastPlace.set(id, [t.x, t.y, t.z, r.x, r.y, r.z, r.w]);
      const moved = was ? Math.hypot(t.x - was[0], t.y - was[1], t.z - was[2]) / STEP_SECONDS : Math.hypot(v.x, v.y, v.z);
      const turned = was ? 2 * Math.hypot(r.x - was[3], r.y - was[4], r.z - was[5], r.w - was[6]) / STEP_SECONDS : Math.hypot(w.x, w.y, w.z);
      const still = moved < QUIET_SPEED && turned < QUIET_SPIN;
      this.quiet.set(id, still && id !== this.held?.id ? (this.quiet.get(id) ?? 0) + STEP_SECONDS : 0);
      const size = shape.type === "box" ? Math.hypot(...shape.half) : Math.hypot(shape.halfHeight, shape.radius);
      const speed = moved + turned * size;
      if (speed < 0.05) continue;
      const reach = size + speed * STEP_SECONDS * 2 + 0.05;
      this.world.collidersWithAabbIntersectingAabb(body.translation(), { x: reach, y: reach, z: reach }, (collider) => {
        if (!this.propHandles.has(collider.handle)) return true;
        const other = this.tags.get(collider.handle)?.entity;
        if (other && !this.owned.has(other) && !this.followed.has(other)) reached.push(other);
        return true;
      });
    }
    for (const id of reached) { const body = this.props.get(id); if (body) this.claim(id, body); }
  }

  private stepWorld(): void {
    this.spreadOwnership();
    this.followProps();
    this.steerHeld();
    this.world.step();
    this.noteKnocks();
    this.strikeBodies();
  }

  private forget(id: string): void {
    this.thrown.delete(id);
    this.speeds.delete(id);
    this.knocked.delete(id);
    this.lastPlace.delete(id);
  }

  // Where the player is looking, and how high their eyes are above their feet.
  setHoldView(heading: number, pitch: number, eyeHeight: number): void {
    this.view.heading = heading * Math.PI / 180;
    this.view.pitch = pitch * Math.PI / 180;
    this.view.eyeHeight = eyeHeight;
  }

  private eye(): Vec3 {
    const at = this.body.translation();
    return { x: at.x, y: at.y - this.halfHeight - RADIUS + this.view.eyeHeight, z: at.z };
  }

  private forward(pitch = this.view.pitch): Vec3 {
    return { x: Math.sin(this.view.heading) * Math.cos(pitch), y: Math.sin(pitch), z: Math.cos(this.view.heading) * Math.cos(pitch) };
  }

  // The nearest thing along the line of sight, if it is a loose prop nobody else is moving.
  // Nothing can be lifted through a wall or from behind the thing in front of it.
  propInView(reach: number): string | null {
    const hit = this.world.castRay(new RAPIER.Ray(this.eye(), this.forward()), reach, true, undefined, undefined, this.collider, undefined, this.solid);
    if (!hit || !this.propHandles.has(hit.collider.handle)) return null;
    const id = this.tags.get(hit.collider.handle)?.entity;
    return id && !this.followed.has(id) ? id : null;
  }

  // Takes a prop into the player's hands, held clear of their body and low enough to see over.
  lift(id: string): boolean {
    const body = this.props.get(id), entity = this.entities.get(id), collider = this.entityColliders.get(id);
    if (this.held || !body || !collider || !entity?.shape || !entity.mass || this.followed.has(id)) return false;
    this.claim(id, body);
    body.setGravityScale(0, true);
    const shape = entity.shape;
    const [wide, high, deep] = shape.type === "box" ? shape.half : [shape.radius, shape.halfHeight, shape.radius];
    const r = body.rotation();
    const yaw = Math.atan2(2 * (r.w * r.y + r.x * r.z), 1 - 2 * (r.y * r.y + r.x * r.x));
    this.held = { id, body, handle: collider.handle, mass: entity.mass, out: RADIUS + Math.hypot(wide, deep) + 0.12, low: 0.22 + high, high, turn: yaw - this.view.heading, draw: 0, strain: 0, rise: HOLD_RISE_SECONDS };
    this.speeds.delete(id);
    return true;
  }

  heldProp(): { id: string; mass: number } | null { return this.held ? { id: this.held.id, mass: this.held.mass } : null; }

  // How far a throw has been drawn back, 0 to 1.
  setDraw(draw: number): void { if (this.held) this.held.draw = draw; }

  // Lets go of what the player holds. It keeps the speed it had and falls.
  letGo(): void {
    const held = this.held;
    if (!held) return;
    held.body.setGravityScale(1, true);
    this.held = null;
    this.released = { id: held.id, at: performance.now() };
    this.quiet.set(held.id, 0);
  }

  // Throws what the player holds at this speed toward what the crosshair is on, on top of the
  // player's own speed, lifted to make up for the fall on the way, with some tumble. Returns
  // the direction it went.
  throwHeld(speed: number): Vec3 | null {
    const held = this.held;
    if (!held) return null;
    const eye = this.eye(), forward = this.forward(), at = held.body.translation();
    const sight = this.world.castRay(new RAPIER.Ray(eye, forward), 40, true, undefined, undefined, this.collider, held.body, this.solid)?.timeOfImpact ?? 40;
    const far = Math.max(sight, 4);
    const dx = eye.x + forward.x * far - at.x, dy = eye.y + forward.y * far - at.y, dz = eye.z + forward.z * far - at.z, length = Math.hypot(dx, dy, dz) || 1;
    const direction = { x: dx / length, y: dy / length, z: dz / length };
    const lift = 14 * Math.min(AIM_FLIGHT_SECONDS, length / speed) / 2;
    held.body.setLinvel({ x: this.walking.x + direction.x * speed, y: this.walking.y * 0.5 + direction.y * speed + lift, z: this.walking.z + direction.z * speed }, true);
    const spin = 2 + 14 / (held.mass + 2), right = { x: -Math.cos(this.view.heading), z: Math.sin(this.view.heading) };
    held.body.setAngvel({ x: right.x * spin, y: (Math.random() - 0.5) * spin, z: right.z * spin }, true);
    this.thrown.add(held.id);
    this.letGo();
    this.speeds.delete(this.released!.id);
    return direction;
  }

  // Before each step: the hands bring the prop toward where it should be, with no more force
  // than arms have and in no time at all for something light.
  private steerHeld(): void {
    const held = this.held;
    if (!held) return;
    const { body, mass } = held;
    const eye = this.eye(), forward = this.forward(Math.max(-HOLD_LOOK, Math.min(HOLD_LOOK, this.view.pitch)));
    const out = held.out - 0.22 * held.draw;
    const at = body.translation(), v = body.linvel();
    // Never below where it would stand on the floor under the player's feet, or it would be
    // pressed into the ground.
    const feet = this.body.translation().y - this.halfHeight - RADIUS;
    const ey = Math.max(feet + held.high + 0.03, eye.y + forward.y * out * HOLD_LOOK_SHARE - held.low + 0.08 * held.draw) - at.y;
    const rising = held.rise > 0 && ey > 0.12;
    held.rise = rising ? held.rise - STEP_SECONDS : 0;
    const ex = rising ? 0 : eye.x + forward.x * out - at.x, ez = rising ? 0 : eye.z + forward.z * out - at.z;
    const gap = Math.hypot(ex, ey, ez);
    const closing = ((v.x - this.walking.x) * ex + (v.y - this.walking.y) * ey + (v.z - this.walking.z) * ez) / (gap || 1);
    held.strain = gap > held.out * 0.6 + HOLD_SLACK && closing < 0.3 ? held.strain + STEP_SECONDS : 0;
    if (held.strain > HOLD_STRAIN_SECONDS) { this.letGo(); return; }
    const pull = Math.min(HOLD_SPEED, gap * HOLD_GAIN) / (gap || 1);
    const dx = this.walking.x + ex * pull - v.x, dy = this.walking.y + ey * pull - v.y, dz = this.walking.z + ez * pull - v.z;
    const change = Math.hypot(dx, dy, dz), most = HOLD_FORCE / mass * STEP_SECONDS, share = change > most ? most / change : 1;
    body.setLinvel({ x: v.x + dx * share, y: v.y + dy * share, z: v.z + dz * share }, true);
    // The turn from where it is to level, facing the way it faced the player when lifted.
    const half = (this.view.heading + held.turn) / 2, ty = Math.sin(half), tw = Math.cos(half), r = body.rotation();
    let qx = -tw * r.x - ty * r.z, qy = ty * r.w - tw * r.y, qz = -tw * r.z + ty * r.x, qw = tw * r.w + ty * r.y;
    if (qw < 0) { qx = -qx; qy = -qy; qz = -qz; qw = -qw; }
    const sine = Math.hypot(qx, qy, qz), angle = 2 * Math.atan2(sine, qw);
    const rate = sine > 1e-5 ? Math.min(HOLD_TURN / (1 + mass / 15), angle * HOLD_TURN_GAIN) / sine : 0;
    body.setAngvel({ x: qx * rate, y: qy * rate, z: qz * rate }, true);
  }

  // After each step: a prop whose speed changed sharply has hit something. Pushes from bullets,
  // blasts and players are not knocks; those clear the speed it is compared with.
  private noteKnocks(): void {
    const now = performance.now();
    for (const id of this.owned) {
      const body = this.props.get(id);
      if (!body) continue;
      const v = body.linvel(), was = this.speeds.get(id);
      this.speeds.set(id, [v.x, v.y, v.z]);
      if (!was || id === this.held?.id) continue;
      const change = Math.hypot(v.x - was[0], v.y - was[1], v.z - was[2]);
      if (change < KNOCK_SPEED || now - (this.knocked.get(id) ?? 0) < KNOCK_GAP_MS) continue;
      this.knocked.set(id, now);
      if (this.knocks.length < 16) this.knocks.push([id, Math.round(change * 10) / 10]);
      if (change >= SMASH_SPEED && this.smashes.length < 16) this.smashes.push([id, Math.round(change * 10) / 10]);
    }
  }

  // Whether any prop is being simulated here, so the frame loop can skip listing players.
  simulating(): boolean { return this.owned.size > 0; }
  setStrikeTargets(targets: StrikeTarget[]): void { this.targets = targets; }

  // After each step: props moving fast enough to hurt, against each player's body. Players take
  // no part in the solver, so the prop's rebound is worked out here, from the two masses.
  private strikeBodies(): void {
    let everyone: StrikeTarget[] | null = null;
    for (const id of this.owned) {
      if (id === this.held?.id) continue;
      const body = this.props.get(id), collider = this.entityColliders.get(id), mass = this.entities.get(id)?.mass;
      if (!body || !collider || !mass) continue;
      const v = body.linvel();
      if (Math.hypot(v.x, v.y, v.z) < STRIKE_SPEED) continue;
      if (!everyone) {
        const self = this.body.translation();
        everyone = [...this.targets, { id: "", east: self.x, feet: self.y - this.halfHeight - RADIUS, north: self.z, crouching: this.crouched }];
      }
      const at = body.translation(), now = performance.now();
      for (const target of everyone) {
        if (target.id === "" && this.released?.id === id && now - this.released.at < CLEAR_OF_THROWER_MS) continue;
        if (Math.hypot(at.x - target.east, at.z - target.north) > 2) continue;
        const half = target.crouching ? CROUCHED_HALF_HEIGHT : STANDING_HALF_HEIGHT;
        const middle = target.feet + half + RADIUS, top = middle + half + RADIUS;
        const contact = collider.contactShape(target.crouching ? this.crouchingBody : this.standing, { x: target.east, y: middle, z: target.north }, IDENTITY, 0.03);
        if (!contact || contact.distance > 0.03) continue;
        const nearest = Math.max(middle - half, Math.min(middle + half, at.y));
        const nx = target.east - at.x, ny = nearest - at.y, nz = target.north - at.z, length = Math.hypot(nx, ny, nz) || 1;
        const along = (v.x * nx + v.y * ny + v.z * nz) / length;
        const key = `${id}|${target.id}`;
        if (along < STRIKE_SPEED || now - (this.struck.get(key) ?? -Infinity) < STRUCK_GAP_MS) continue;
        this.struck.set(key, now);
        const loss = along * (1 + STRUCK_BOUNCE) * STRUCK_BODY_MASS / (mass + STRUCK_BODY_MASS) / length;
        body.setLinvel({ x: v.x - nx * loss, y: v.y - ny * loss, z: v.z - nz * loss }, true);
        this.speeds.delete(id);
        const height = (Math.min(top, Math.max(target.feet, at.y)) - target.feet) / (target.crouching ? 0.72 : 1);
        this.strikes.push({ prop: id, target: target.id, speed: Math.round(along * 10) / 10, zone: height >= HEAD_HEIGHT ? "head" : height >= TORSO_HEIGHT ? "torso" : "legs", thrown: this.thrown.has(id) });
        break;
      }
    }
  }

  takeStrikes(): Strike[] { const list = this.strikes; this.strikes = []; return list; }
  takeSmashes(): [string, number][] { const list = this.smashes; this.smashes = []; return list; }
  takeKnocks(): [string, number][] { const list = this.knocks; this.knocks = []; return list; }

  // A bullet or blast pushing a loose prop: this peer starts simulating a prop nobody owns,
  // and passes the push to the owner of one that somebody does.
  push(id: string, point: Vec3, impulse: Vec3): void {
    const body = this.props.get(id);
    if (!body) return;
    const follow = this.followed.get(id);
    if (follow) { this.addShove(id, follow.owner, impulse, 0); return; }
    this.claim(id, body);
    body.applyImpulseAtPoint(impulse, point, true);
    this.speeds.delete(id);
  }

  // speed is how fast the player pushing was walking into the prop, or 0 for a bullet or blast.
  private addShove(id: string, owner: string, push: Vec3, speed: number): void {
    const shove = this.shoves.get(id);
    if (shove && shove.owner === owner) { shove.push.x += push.x; shove.push.y += push.y; shove.push.z += push.z; shove.speed = Math.max(shove.speed, speed); }
    else this.shoves.set(id, { owner, push: { ...push }, speed });
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
    this.letGo();
    this.released = null;
    this.thrown.clear();
    this.speeds.clear();
    this.knocked.clear();
    this.lastPlace.clear();
    this.struck.clear();
    this.strikes = [];
    this.smashes = [];
    this.knocks = [];
    for (const [id, body] of this.props) {
      const entity = this.entities.get(id)!;
      body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, false);
      body.setTranslation(entity.center, true);
      body.setRotation({ x: 0, y: Math.sin(entity.yaw / 2), z: 0, w: Math.cos(entity.yaw / 2) }, true);
    }
    this.owned.clear();
    this.followed.clear();
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
    this.stepWorld();
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
      undefined, undefined, this.collider, undefined, (candidate) => candidate.handle !== this.terrainCollider.handle && this.walkable(candidate))) return this.crouched;
    this.collider.setShape(nextShape);
    this.body.setTranslation(nextPosition, true);
    this.world.propagateModifiedBodyPositionsToColliders();
    this.halfHeight = nextHalfHeight;
    this.crouched = wantsCrouch;
    return this.crouched;
  }

  move(east: number, north: number, vertical: number): CharacterStep {
    this.controller.computeColliderMovement(this.collider, { x: east, y: vertical, z: north }, undefined, undefined, this.walkable);
    this.collectShoves(east, north);
    this.steps += 1;
    const movement = this.controller.computedMovement();
    this.walking = { x: movement.x / STEP_SECONDS, y: movement.y / STEP_SECONDS, z: movement.z / STEP_SECONDS };
    const current = this.body.translation();
    this.body.setNextKinematicTranslation({ x: current.x + movement.x, y: current.y + movement.y, z: current.z + movement.z });
    this.stepWorld();
    return this.position(this.controller.computedGrounded());
  }

  // Walking into a loose prop. A prop nobody owns becomes this peer's, and from the next step
  // the character controller shoves it with the player's mass, with no wait on the network. A
  // prop another peer owns cannot move here, so the walk is recorded for that peer, as the
  // impulse the player's mass would give it: as much of the walk as the prop blocked, up to a
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
      const follow = this.followed.get(id);
      if (!follow) { const body = this.props.get(id); if (body) this.claim(id, body); continue; }
      const impulse = Math.min(mass * into, PUSH_FORCE * STEP_SECONDS);
      this.addShove(id, follow.owner, { x: -n.x / flat * impulse, y: 0, z: -n.z / flat * impulse }, Math.min(into, 12));
    }
  }

  // Shoves waiting to go out, by the peer that owns each prop.
  takeShoves(): Map<string, [string, number, number, number, number][]> {
    const byOwner = new Map<string, [string, number, number, number, number][]>();
    for (const [id, { owner, push, speed }] of this.shoves) {
      // A long frame can gather more than a packet may carry; the excess is lost, as a body
      // cannot lean harder than that anyway.
      const scale = Math.min(1, 100 / (Math.hypot(push.x, push.y, push.z) || 1));
      const list = byOwner.get(owner) ?? [];
      list.push([id, Math.round(push.x * scale * 100) / 100, Math.round(push.y * scale * 100) / 100, Math.round(push.z * scale * 100) / 100, Math.round(speed * 100) / 100]);
      byOwner.set(owner, list);
    }
    this.shoves.clear();
    return byOwner;
  }

  // Shoves other players gave props this peer owns, applied a little above the middle of each
  // prop the way a hip or hand meets it. A body walking into a light stool moves it no faster
  // than the body is walking; it does not fire it across the room.
  applyShoves(shoves: [string, number, number, number, number][]): void {
    for (const [id, x, y, z, speed] of shoves) {
      const body = this.props.get(id);
      // It may have settled while the shove was on its way; then it is this peer's to move again.
      if (!body || this.followed.has(id)) continue;
      this.claim(id, body);
      const at = body.translation();
      body.applyImpulseAtPoint({ x, y, z }, { x: at.x, y: at.y + 0.1, z: at.z }, true);
      this.speeds.delete(id);
      if (speed <= 0) continue;
      const length = Math.hypot(x, y, z) || 1, v = body.linvel();
      const over = (v.x * x + v.y * y + v.z * z) / length - speed;
      if (over > 0) body.setLinvel({ x: v.x - x / length * over, y: v.y - y / length * over, z: v.z - z / length * over }, true);
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
    this.walking = { x: 0, y: 0, z: 0 };
    this.idleTime = Math.min(0.1, this.idleTime + seconds);
    while (this.idleTime >= STEP_SECONDS) { this.stepWorld(); this.idleTime -= STEP_SECONDS; }
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

  // Whether a wall or other fixed part of the map stands between two points. Loose props, stalls
  // and the like let heat by, and so, for this purpose, does the ground.
  walled(a: Vec3, b: Vec3): boolean {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, distance = Math.hypot(dx, dy, dz);
    if (distance < 0.01) return false;
    return this.world.castRay(new RAPIER.Ray(a, { x: dx / distance, y: dy / distance, z: dz / distance }), distance, true, undefined, undefined, this.collider, undefined, (collider) => {
      const tag = this.tags.get(collider.handle);
      return !!tag && !tag.entity && tag.material !== "ground" && tag.material !== "boundary";
    }) !== null;
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
