import { Color, Frustum, Group, Matrix4, Scene, Sphere, Vector3, type Camera, type Object3D } from "three/webgpu";
import { terrainHeight, type ArenaData } from "../world/arena";
import { type PlayerPose } from "./playerController";
import { type WeaponKind } from "./combatRules";
import { PlayerModelLibrary, type PlayerModelInstance } from "./playerModel";
import { CharacterRagdoll } from "./ragdoll";
import { type PhysicsWorld, type Vec3 } from "../world/physics";

// Other players are drawn behind their latest pose, interpolating between pose packets placed
// on the sender's own clock, so they move smoothly despite network jitter. Each is drawn just
// far enough behind that its next pose has almost always arrived: the time between its poses
// while it moves, plus how late nine in ten of its last 64 poses arrived beyond the quickest.
// A fixed 100 ms drew everyone that far in the past however steady the connection. The delay
// follows a change at a tenth of real time, so a player's motion never jumps.
const MIN_DELAY_MS = 40;
const MAX_DELAY_MS = 150;
const EXTRAPOLATE_MS = 100;

interface PoseSample { time: number; pose: PlayerPose }

function lerpHeading(a: number, b: number, t: number): number {
  return (a + ((((b - a) % 360) + 540) % 360 - 180) * t + 360) % 360;
}

interface RemoteAvatar {
  root: Group;
  model: PlayerModelInstance | null;
  tint: Color;
  pose: PlayerPose;
  heading: number;
  carrying: boolean;
  limpPhase: number;
  weapons: Map<WeaponKind, Group>;
  samples: PoseSample[];
  dying: boolean;
  ragdoll: CharacterRagdoll | null;
  impulse?: { part: string; vector: Vec3 };
  previous: Vector3;
  velocity: Vector3;
  // Smallest observed (receive clock - send clock), relaxed slowly so clock drift is followed.
  offset: number | null;
  offsetAt: number;
  // How late recent poses arrived beyond the quickest, the gaps between poses sent while
  // moving, the delay they call for and the delay drawn now, in ms.
  lateness: number[];
  gaps: number[];
  targetDelay: number;
  delay: number;
  displayTime: number;
  // Animation time owed while the player was off screen or skipped for distance, and a slot
  // that spreads the skipped frames of distant players across frames.
  pendingAnimation: number;
  slot: number;
}

// A player's root, placed and turned each frame. It stays empty until the shared character
// model has loaded, then holds the character and the weapons on its hand.
function createAvatar(peerId: string): RemoteAvatar {
  const hue = [...peerId].reduce((value, character) => value + character.charCodeAt(0), 0) % 360 / 360;
  return { root: new Group(), model: null, tint: new Color().setHSL(hue, 0.5, 0.78), pose: {
    east: 0, north: 0, heading: 0, pitch: 0, jumpHeight: 0,
    moving: false, running: false, crouching: false,
  }, heading: 0, carrying: false, limpPhase: 0, weapons: new Map(), samples: [], offset: null, offsetAt: 0, lateness: [], gaps: [], targetDelay: 100, delay: 100, displayTime: 0, pendingAnimation: 0, slot: Math.floor(Math.random() * 6), dying: false, ragdoll: null, previous: new Vector3(), velocity: new Vector3() };
}

export class RemotePlayers {
  private avatars = new Map<string, RemoteAvatar>();
  private dead = new Set<string>();
  private equipped = new Map<string, WeaponKind>();
  private legWounds = new Map<string, number>();
  private toolModel: Object3D | null = null;
  private tools = new Map<string, Object3D>();
  private weaponModels: Map<WeaponKind, Object3D> | null = null;

  constructor(private scene: Scene, private data: ArenaData, private models: PlayerModelLibrary, private physics?: PhysicsWorld) {}

  // Puts the shared character on a player once the model has loaded.
  private attachModel(avatar: RemoteAvatar, dead: boolean): void {
    const model = this.models.instantiate(avatar.tint);
    if (!model) return;
    if (dead && !this.physics) model.setDead(true);
    avatar.model = model;
    avatar.root.add(model.root);
    this.useRealWeapons(avatar);
  }

  // Characters hold the same weapon models the player sees in first person, whose grip is at
  // their origin with the barrel along -Z. The knife sits on the hand socket and follows the
  // arm; a gun hangs from the character's root and is held to the shoulder with both hands
  // (PlayerModelInstance.holdGun). Each is hidden until the next pose shows the one the
  // player has out.
  setWeaponModels(models: Map<WeaponKind, Object3D>): void {
    this.weaponModels = models;
    for (const avatar of this.avatars.values()) if (avatar.model) this.useRealWeapons(avatar);
  }

  private useRealWeapons(avatar: RemoteAvatar): void {
    if (!this.weaponModels || !avatar.model?.weaponSocket) return;
    for (const [kind, source] of this.weaponModels) {
      if (avatar.weapons.has(kind)) continue;
      const copy = source.clone(true) as Group;
      copy.visible = false;
      // Cloning turns userData into plain JSON, and the grip holds real vectors and matrices.
      copy.userData.grip = source.userData.grip;
      (kind === "knife" ? avatar.model.weaponSocket : avatar.model.root).add(copy);
      avatar.weapons.set(kind, copy);
    }
  }

  // sentAt is the moment on the sender's clock the pose was taken.
  setPose(peerId: string, pose: PlayerPose, sentAt = Date.now()): void {
    let avatar = this.avatars.get(peerId);
    if (!avatar) {
      avatar = createAvatar(peerId);
      avatar.root.position.set(pose.east, terrainHeight(this.data, pose.east, pose.north) + pose.jumpHeight, pose.north);
      avatar.heading = pose.heading;
      this.avatars.set(peerId, avatar);
      this.scene.add(avatar.root);
    }
    avatar.root.visible = avatar.model !== null || !this.dead.has(peerId);
    this.setWeapon(peerId, this.equipped.get(peerId) ?? "knife");
    const now = Date.now(), observed = now - sentAt;
    avatar.offset = avatar.offset === null ? observed : Math.min(observed, avatar.offset + (now - avatar.offsetAt) * 0.02);
    avatar.offsetAt = now;
    const samples = avatar.samples;
    avatar.lateness.push(observed - avatar.offset);
    if (avatar.lateness.length > 64) avatar.lateness.shift();
    // A player standing still sends a pose only every quarter second; those gaps say nothing
    // about how far apart its poses come while it moves.
    const gap = samples.length ? sentAt - samples[samples.length - 1].time : 0;
    if (gap > 0 && gap < 150) {
      avatar.gaps.push(gap);
      if (avatar.gaps.length > 16) avatar.gaps.shift();
    }
    const late = [...avatar.lateness].sort((a, b) => a - b), gaps = [...avatar.gaps].sort((a, b) => a - b);
    avatar.targetDelay = Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, (gaps[gaps.length >> 1] ?? 50) + late[Math.floor(late.length * 0.9)]));
    if (!samples.length || sentAt > samples[samples.length - 1].time) samples.push({ time: sentAt, pose });
    while (samples.length > 2 && samples[0].time < sentAt - 1500) samples.shift();
    avatar.pose = pose;
  }

  // The moment of each live player's own timeline currently on screen, for lag compensation.
  seen(): Record<string, number> {
    const seen: Record<string, number> = {};
    for (const [peerId, avatar] of this.avatars) if (!this.dead.has(peerId) && avatar.samples.length) seen[peerId] = Math.round(avatar.displayTime);
    return seen;
  }

  setToolModel(model: Object3D): void { this.toolModel = model; }

  // Whether a player holds an extinguisher, in front of their chest.
  setTool(peerId: string, held: boolean): void {
    const avatar = this.avatars.get(peerId);
    let tool = this.tools.get(peerId);
    if (held && !tool && avatar && this.toolModel) {
      tool = this.toolModel.clone(true);
      tool.position.set(0, 0.85, 0.36);
      avatar.root.add(tool);
      this.tools.set(peerId, tool);
    }
    if (tool) tool.visible = held;
  }

  // How bad a player's leg wound is, 0 to 1, shown in how they walk.
  setLegWound(peerId: string, leg: number): void { this.legWounds.set(peerId, leg); }

  flinch(peerId: string, damage: number): void {
    this.avatars.get(peerId)?.model?.flinch(Math.min(1, 0.35 + damage / 60));
  }

  private interpolated(avatar: RemoteAvatar): PlayerPose {
    const samples = avatar.samples;
    if (!samples.length) return avatar.pose;
    const time = avatar.displayTime;
    const last = samples[samples.length - 1];
    if (time >= last.time) {
      if (samples.length < 2) return last.pose;
      const previous = samples[samples.length - 2];
      const ahead = Math.min(time - last.time, EXTRAPOLATE_MS) / Math.max(1, last.time - previous.time);
      if (Math.hypot(last.pose.east - previous.pose.east, last.pose.north - previous.pose.north) > 4) return last.pose;
      return { ...last.pose, east: last.pose.east + (last.pose.east - previous.pose.east) * ahead, north: last.pose.north + (last.pose.north - previous.pose.north) * ahead };
    }
    for (let index = samples.length - 2; index >= 0; index -= 1) {
      const a = samples[index], b = samples[index + 1];
      if (a.time > time) continue;
      // Respawns and corrections teleport rather than glide.
      if (Math.hypot(b.pose.east - a.pose.east, b.pose.north - a.pose.north) > 4) return b.pose;
      const t = (time - a.time) / Math.max(1, b.time - a.time);
      return {
        ...a.pose,
        east: a.pose.east + (b.pose.east - a.pose.east) * t,
        north: a.pose.north + (b.pose.north - a.pose.north) * t,
        jumpHeight: a.pose.jumpHeight + (b.pose.jumpHeight - a.pose.jumpHeight) * t,
        heading: lerpHeading(a.pose.heading, b.pose.heading, t),
        pitch: a.pose.pitch + (b.pose.pitch - a.pose.pitch) * t,
        lean: (a.pose.lean ?? 0) + ((b.pose.lean ?? 0) - (a.pose.lean ?? 0)) * t,
      };
    }
    return samples[0].pose;
  }

  setWeapon(peerId: string, weapon: WeaponKind): void {
    this.equipped.set(peerId, weapon);
    const avatar = this.avatars.get(peerId);
    // A fallen player's guns lie where they dropped, so the body holds nothing.
    if (!avatar) return;
    // Both hands on something else, the weapon is away.
    const out = !this.dead.has(peerId) && !avatar.carrying;
    for (const [kind, model] of avatar.weapons) model.visible = kind === weapon && out;
    avatar.model?.holdGun(weapon !== "knife" && out ? avatar.weapons.get(weapon) ?? null : null);
    avatar.model?.setCarrying(avatar.carrying && !this.dead.has(peerId));
  }

  // Another player's knife stroke or shot, on their character's arm.
  attack(peerId: string, weapon: WeaponKind, stroke?: "slash" | "stab"): void {
    this.avatars.get(peerId)?.model?.attack(weapon === "knife" ? stroke ?? "slash" : "shot");
  }

  // Where another player's gun's muzzle is, for the tracer and the flash's light, or null.
  muzzle(peerId: string): Vector3 | null {
    return this.dead.has(peerId) ? null : this.avatars.get(peerId)?.model?.muzzle() ?? null;
  }

  // Where another player's hands hold their weapon, for spent cases: the held gun's ejection
  // port, or a guess from their stance before the model has loaded.
  hands(peerId: string): { position: Vector3; heading: number } | null {
    const avatar = this.avatars.get(peerId);
    if (!avatar || this.dead.has(peerId)) return null;
    const port = avatar.model?.port();
    if (port) return { position: port, heading: avatar.heading };
    const yaw = avatar.heading * Math.PI / 180, crouch = avatar.pose.crouching ? 0.45 : 0;
    return { position: avatar.root.position.clone().add(new Vector3(Math.sin(yaw) * 0.35 - Math.cos(yaw) * 0.12, 1.35 - crouch, Math.cos(yaw) * 0.35 + Math.sin(yaw) * 0.12)), heading: avatar.heading };
  }

  setHealth(peerId: string, health: number): void {
    const avatar = this.avatars.get(peerId);
    const wasDead = this.dead.has(peerId);
    if (health <= 0) this.dead.add(peerId);
    else this.dead.delete(peerId);
    if (!avatar) return;
    this.setWeapon(peerId, this.equipped.get(peerId) ?? "knife");
    // The character falls as a ragdoll (or plays its death clip without physics) and stays
    // down until respawn.
    avatar.root.visible = avatar.model !== null || health > 0;
    // A death waits for the character model if it has not attached yet (a peer that just
    // joined, or a tab that was in the background), so the body still falls when it appears.
    if (health <= 0 && !wasDead) {
      if (this.physics) avatar.dying = true;
      else avatar.model?.setDead(true);
    }
    if (health > 0 && wasDead) {
      avatar.dying = false;
      avatar.impulse = undefined;
      if (avatar.ragdoll) { avatar.ragdoll.remove(); avatar.ragdoll = null; }
      avatar.model?.unfreeze();
      avatar.model?.setDead(false);
    }
  }

  // The blow that killed a player, applied to the ragdoll when it is created.
  kill(peerId: string, part: string, vector: Vec3): void {
    const avatar = this.avatars.get(peerId);
    if (avatar) avatar.impulse = { part, vector };
  }

  // Smoothed feet positions and latest poses, for footsteps and other positioned sounds.
  each(visit: (peerId: string, feet: Vector3, pose: PlayerPose, dead: boolean) => void): void {
    for (const [peerId, avatar] of this.avatars) visit(peerId, avatar.root.position, avatar.pose, this.dead.has(peerId));
  }

  position(peerId: string): Vector3 | null {
    return this.avatars.get(peerId)?.root.position ?? null;
  }

  remove(peerId: string): void {
    const avatar = this.avatars.get(peerId);
    if (!avatar) return;
    avatar.ragdoll?.remove();
    this.scene.remove(avatar.root);
    if (avatar.model) { avatar.root.remove(avatar.model.root); avatar.model.dispose(); }
    this.avatars.delete(peerId);
    this.dead.delete(peerId);
    this.equipped.delete(peerId);
    this.legWounds.delete(peerId);
    this.tools.delete(peerId);
  }

  clear(): void {
    for (const peerId of this.avatars.keys()) this.remove(peerId);
    this.dead.clear();
    this.equipped.clear();
  }

  // Players out of view are neither drawn nor animated, and distant ones animate every second or
  // third frame. three never culls the characters (their skinned bounds are unreliable), so
  // without this every player cost a full skeleton update and a draw each frame, even behind
  // the camera.
  private frustum = new Frustum();
  private viewProjection = new Matrix4();
  private bounds = new Sphere(new Vector3(), 1.3);
  private frame = 0;

  update(seconds: number, camera?: Camera): void {
    const delta = Math.min(seconds, 0.1);
    this.frame += 1;
    if (camera) {
      camera.updateMatrixWorld();
      this.frustum.setFromProjectionMatrix(this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    }
    for (const [peerId, avatar] of this.avatars) {
      const { root } = avatar;
      if (!avatar.model && this.models.ready()) this.attachModel(avatar, this.dead.has(peerId));
      if (avatar.ragdoll) { root.visible = true; avatar.ragdoll.update(); continue; }
      if (avatar.dying && avatar.model && this.physics) {
        avatar.dying = false;
        try {
          avatar.model.freeze();
          avatar.ragdoll = new CharacterRagdoll(this.physics, avatar.model.root, { x: avatar.velocity.x, y: avatar.velocity.y, z: avatar.velocity.z }, avatar.impulse);
        } catch (error) {
          console.warn("Ragdoll unavailable; playing the death animation instead.", error);
          avatar.model.unfreeze();
          avatar.model.setDead(true);
        }
        continue;
      }
      avatar.delay += Math.max(-100 * delta, Math.min(100 * delta, avatar.targetDelay - avatar.delay));
      avatar.displayTime = Date.now() - (avatar.offset ?? 0) - avatar.delay;
      const pose = this.interpolated(avatar);
      if ((pose.carrying === true) !== avatar.carrying) {
        avatar.carrying = pose.carrying === true;
        this.setWeapon(peerId, this.equipped.get(peerId) ?? "knife");
      }
      root.position.set(pose.east, terrainHeight(this.data, pose.east, pose.north) + pose.jumpHeight, pose.north);
      if (delta > 0) avatar.velocity.lerp(root.position.clone().sub(avatar.previous).divideScalar(delta), 0.3);
      if (avatar.velocity.length() > 15) avatar.velocity.setLength(0);
      avatar.previous.copy(root.position);
      avatar.heading = pose.heading;
      root.rotation.y = avatar.heading * Math.PI / 180;
      // Leaning rolls the whole body a little toward the character's right (local -x) and
      // bends the upper body the rest of the way, matching the shifted hit boxes.
      const lean = this.dead.has(peerId) ? 0 : pose.lean ?? 0;
      root.rotation.z = lean * 0.1;
      // A limp drops the body on the bad leg and tips it that way.
      const leg = this.dead.has(peerId) ? 0 : this.legWounds.get(peerId) ?? 0;
      if (leg > 0 && pose.moving) {
        avatar.limpPhase += delta * (pose.running ? 9 : 6.5);
        const swing = Math.sin(avatar.limpPhase);
        root.rotation.z += swing * 0.07 * leg;
        root.position.y -= Math.max(0, swing) * 0.05 * leg;
      }
      if (avatar.model) {
        this.bounds.center.set(root.position.x, root.position.y + 0.95, root.position.z);
        root.visible = !camera || this.frustum.intersectsSphere(this.bounds);
        avatar.pendingAnimation = Math.min(0.25, avatar.pendingAnimation + delta);
        if (!root.visible) continue;
        const distance = camera ? camera.position.distanceTo(root.position) : 0;
        const every = distance > 35 ? 3 : distance > 18 ? 2 : 1;
        if ((this.frame + avatar.slot) % every !== 0) continue;
        avatar.model.setStance(pose.crouching ? "crouch" : pose.moving ? pose.running ? "run" : "walk" : "idle");
        avatar.model.setPitch(pose.pitch);
        avatar.model.setLean(lean);
        avatar.model.update(avatar.pendingAnimation);
        avatar.pendingAnimation = 0;
        continue;
      }
    }
  }
}
