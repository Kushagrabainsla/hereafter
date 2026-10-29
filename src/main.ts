import "./style.css";
import { arenaFromUrl } from "./world/arena";
import { createMapViewer, type MapViewer, type MapState } from "./world/mapViewer";
import { newRoomCode, normalizeRoomCode, PeerRoom } from "./network/peerRoom";
import { selfId } from "trystero";
import { WEAPONS, type WeaponKind, type WeaponPickup } from "./game/combatRules";
import { MatchState, type CombatEvent, type CombatIntent, type CombatSnapshot } from "./game/matchState";
import { gameAudio } from "./game/gameAudio";

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing UI element: ${id}`);
  return found as T;
}

const controlsDialog = element<HTMLDialogElement>("controls-dialog");
const openControlsButton = element<HTMLButtonElement>("open-controls");
const closeControlsButton = element<HTMLButtonElement>("close-controls");
const roomDialog = element<HTMLDialogElement>("room-dialog");
const openRoomButton = element<HTMLButtonElement>("open-room");
const closeRoomButton = element<HTMLButtonElement>("close-room");
const createRoomButton = element<HTMLButtonElement>("create-room");
const joinRoomButton = element<HTMLButtonElement>("join-room");
const leaveRoomButton = element<HTMLButtonElement>("leave-room");
const copyInviteButton = element<HTMLButtonElement>("copy-invite");
const roomEntry = element<HTMLElement>("room-entry");
const roomActive = element<HTMLElement>("room-active");
const roomCodeInput = element<HTMLInputElement>("room-code");
const activeRoomCode = element<HTMLElement>("active-room-code");
const inviteLink = element<HTMLInputElement>("invite-link");
const roomStatus = element<HTMLElement>("room-status");
const healthNumber = element<HTMLElement>("health-number");
const healthBar = element<HTMLElement>("health-bar");
const healthFill = element<HTMLElement>("health-fill");
const weaponName = element<HTMLElement>("weapon-name");
const ammoCount = element<HTMLElement>("ammo-count");
const scoreLabel = element<HTMLElement>("score-label");
const pickupHint = element<HTMLElement>("pickup-hint");
const combatToast = element<HTMLElement>("combat-toast");
const deathOverlay = element<HTMLElement>("death-overlay");
const respawnHint = element<HTMLElement>("respawn-hint");
const damageReadout = document.createElement("div");
damageReadout.className = "damage-readout";
damageReadout.setAttribute("role", "status");
document.getElementById("map")!.parentElement!.appendChild(damageReadout);
const hitMarker = element<HTMLElement>("hit-marker");
const damageDirection = element<HTMLElement>("damage-direction");
const killBanner = element<HTMLElement>("kill-banner");
const killDetail = element<HTMLElement>("kill-detail");
const damageFlash = element<HTMLElement>("damage-flash");
const performanceLabel = element<HTMLElement>("performance");
const notice = element<HTMLElement>("notice");
const noticeLabel = element<HTMLElement>("notice-label");
const noticeMessage = element<HTMLElement>("notice-message");
let viewer: MapViewer | null = null;
let peerRoom: PeerRoom | null = null;
let match: MatchState | null = null;
let lastEventId = 0;
let lastLocalAttack = 0;
let lastDryFire = 0;
let pendingShot = 0;
let triggerHeld = false;
// Time to bring a weapon up out of a sprint before it fires.
const SPRINT_OUT_MS: Record<WeaponKind, number> = { knife: 60, pistol: 140, rifle: 220 };
const crosshair = document.querySelector<HTMLElement>(".crosshair");
const previousPlayers = new Map<string, { active: WeaponKind; reloadUntil: number; health: number }>();
// Browsers only start audio from a user gesture; every gesture retries until it runs.
for (const type of ["pointerdown", "keydown", "touchstart"]) window.addEventListener(type, () => gameAudio.unlock(), { capture: true, passive: true });
window.addEventListener("pointerup", () => { triggerHeld = false; });
window.addEventListener("blur", () => { triggerHeld = false; });
document.addEventListener("pointerlockchange", () => { triggerHeld = false; });
window.setInterval(() => {
  if (triggerHeld && document.pointerLockElement && match?.player(selfId)?.active === "rifle") attack();
}, 16);
let toastTimer = 0;
const arena = arenaFromUrl(window.location.search);

function setStatus(state: MapState, message: string): void {
  notice.dataset.state = state;
  notice.hidden = state === "ready";
  noticeLabel.textContent = state === "error" ? "Arena unavailable" : "Preparing arena";
  noticeMessage.textContent = message;
}

function openControls(): void {
  if (controlsDialog.open || roomDialog.open) return;
  controlsDialog.showModal();
  syncPause();
}

function closeControls(): void {
  if (controlsDialog.open) controlsDialog.close();
}

function syncPause(): void {
  if (controlsDialog.open || roomDialog.open || (match?.player(selfId)?.health ?? 100) <= 0) triggerHeld = false;
  viewer?.setPaused(controlsDialog.open || roomDialog.open || (match?.player(selfId)?.health ?? 100) <= 0);
}

function toast(message: string): void {
  combatToast.textContent = message;
  combatToast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { combatToast.hidden = true; }, 2200);
}

const pulseTimers = new WeakMap<HTMLElement, number>();
function pulse(elementToPulse: HTMLElement, duration: number): void {
  window.clearTimeout(pulseTimers.get(elementToPulse));
  elementToPulse.classList.remove("visible");
  void elementToPulse.offsetWidth;
  elementToPulse.classList.add("visible");
  pulseTimers.set(elementToPulse, window.setTimeout(() => elementToPulse.classList.remove("visible"), duration));
}

// Restart a CSS animation by removing its classes, forcing layout, then adding them back.
function replay(target: HTMLElement, ...classes: string[]): void {
  target.classList.remove("show", "headshot", "kill");
  void target.offsetWidth;
  target.classList.add("show", ...classes);
}

// Point an arc from the crosshair toward the attacker. Screen right is forward x up,
// which is (-cos h, sin h) in east/north for heading h.
function showDamageDirection(from: { x: number; z: number }): void {
  if (!viewer) return;
  const pose = viewer.playerPose();
  const heading = pose.heading * Math.PI / 180;
  const east = from.x - pose.east, north = from.z - pose.north;
  if (Math.hypot(east, north) < 0.3) return;
  const angle = Math.atan2(-east * Math.cos(heading) + north * Math.sin(heading), east * Math.sin(heading) + north * Math.cos(heading));
  const arc = document.createElement("div");
  arc.className = "damage-arc";
  arc.style.setProperty("--angle", `${angle}rad`);
  arc.addEventListener("animationend", () => arc.remove());
  damageDirection.appendChild(arc);
  while (damageDirection.children.length > 4) damageDirection.firstElementChild?.remove();
}

function showElimination(event: CombatEvent): void {
  const details = [event.zone === "head" ? "Headshot" : "", event.weapon ? WEAPONS[event.weapon].label : "", event.shot ? `${Math.max(1, Math.round(event.shot.distance))} m` : ""];
  killDetail.textContent = details.filter(Boolean).join(" · ");
  replay(killBanner);
  replay(scoreLabel);
}

// Weapon switches and reload starts arrive as state changes rather than events.
function cueStateChanges(state: CombatSnapshot, newEvent: CombatEvent | null): void {
  for (const [peerId, player] of Object.entries(state.players)) {
    const before = previousPlayers.get(peerId);
    previousPlayers.set(peerId, { active: player.active, reloadUntil: player.reloadUntil, health: player.health });
    if (!before) continue;
    const reloadStarted = player.health > 0 && player.reloadUntil > 0 && player.reloadUntil !== before.reloadUntil;
    if (peerId === selfId) {
      const pickedUp = newEvent?.kind === "pickup" && newEvent.actor === selfId;
      if (player.active !== before.active && !pickedUp && player.health > 0) gameAudio.switchWeapon(player.active);
      if (reloadStarted) viewer?.startReload(player.active, WEAPONS[player.active].reloadMs);
      if (player.health <= 0 && before.health > 0) viewer?.cancelReload();
    } else if (reloadStarted) viewer?.remoteReload(peerId, player.active);
  }
  for (const peerId of previousPlayers.keys()) if (!state.players[peerId]) previousPlayers.delete(peerId);
}

function onMatchChange(state: CombatSnapshot): void {
  const player = state.players[selfId];
  if (!player) return;
  const wasDead = !deathOverlay.hidden;
  healthNumber.textContent = String(player.health);
  healthBar.setAttribute("aria-valuenow", String(player.health));
  healthBar.classList.toggle("low", player.health <= 35);
  healthFill.style.width = `${player.health}%`;
  weaponName.textContent = WEAPONS[player.active].label;
  ammoCount.textContent = player.active === "knife" ? "MELEE" : player.reloadUntil > Date.now() ? "RELOADING" : `${player.ammo[player.active]} / ∞`;
  scoreLabel.textContent = `${player.kills} KILL${player.kills === 1 ? "" : "S"} · ${player.deaths} DEATH${player.deaths === 1 ? "" : "S"}`;
  viewer?.setWeapon(player.active);
  viewer?.setTakenPickups(state.taken);
  for (const [peerId, remote] of Object.entries(state.players)) if (peerId !== selfId) {
    viewer?.setRemoteHealth(peerId, remote.health);
    viewer?.setRemoteWeapon(peerId, remote.active);
  }
  deathOverlay.hidden = player.health > 0;
  if (wasDead && player.health > 0) viewer?.respawn();
  syncPause();
  gameAudio.setDown(player.health <= 0);
  const event = state.event && state.event.id !== lastEventId ? state.event : null;
  cueStateChanges(state, event);
  if (event) {
    lastEventId = event.id;
    if (event.shot) viewer?.showShot(event, event.actor === selfId);
    viewer?.combatSound(event, selfId);
    if ((event.kind === "hit" || event.kind === "death") && event.actor === selfId && event.target !== selfId) {
      const headshot = event.zone === "head", kill = event.kind === "death";
      damageReadout.textContent = `${headshot ? "HEADSHOT · " : ""}${event.damage ?? 0}`;
      damageReadout.classList.toggle("headshot", headshot);
      pulse(damageReadout, 700);
      replay(hitMarker, ...(headshot ? ["headshot"] : []), ...(kill ? ["kill"] : []));
      gameAudio.hitConfirm(headshot, kill);
      if (kill) showElimination(event);
    }
    if (event.kind === "pickup" && event.actor === selfId && event.weapon) {
      toast(`${WEAPONS[event.weapon].label} equipped`);
      gameAudio.pickup();
    }
    if ((event.kind === "hit" || event.kind === "death") && event.target === selfId) {
      pulse(damageFlash, 420);
      gameAudio.hurt(event.damage ?? 0, event.kind === "death");
      if (event.shot) showDamageDirection(event.shot.origin);
    }
    if (event.kind === "death" && event.target === selfId) toast("You were eliminated");
  }
}

function submit(intent: CombatIntent): void {
  if (!match || !viewer) return;
  match.setPose(selfId, viewer.playerPose());
  if (peerRoom) peerRoom.sendCombatIntent(intent);
  else match.apply(selfId, intent);
}

function nearestPickup(): WeaponPickup | null {
  if (!viewer || !match) return null;
  const pose = viewer.playerPose();
  const taken = new Set(match.getState().taken);
  return match.pickups.filter((pickup) => !taken.has(pickup.id))
    .map((pickup) => ({ pickup, distance: Math.hypot(pickup.east - pose.east, pickup.north - pose.north) }))
    .filter(({ distance }) => distance <= 2.3)
    .sort((a, b) => a.distance - b.distance)[0]?.pickup ?? null;
}

function attack(): void {
  if (!viewer || !match || controlsDialog.open || roomDialog.open) return;
  const player = match.player(selfId);
  if (!player || player.health <= 0 || !viewer.weaponReady()) return;
  const weapon = player.active;
  // Firing drops a sprint; the shot follows once the weapon is up. Each attack keeps the
  // sprint held off briefly, so a held trigger walks and a released one runs again.
  const sprinting = viewer.playerPose().running;
  viewer.holdSprint(0.35);
  if (sprinting || pendingShot) {
    if (!pendingShot) pendingShot = window.setTimeout(() => { pendingShot = 0; attack(); }, SPRINT_OUT_MS[weapon]);
    return;
  }
  const now = Date.now();
  if (now - lastLocalAttack < WEAPONS[weapon].cooldownMs || player.reloadUntil > now) return;
  if (weapon !== "knife" && player.ammo[weapon] <= 0) {
    // Held triggers retry every frame; click and remind at most a few times a second.
    if (now - lastDryFire > 300) { lastDryFire = now; gameAudio.dryFire(); toast("Press R to reload"); }
    return;
  }
  lastLocalAttack = now;
  const { heading, pitch } = viewer.playerPose();
  submit({ kind: "attack", weapon, aim: { heading, pitch } });
  viewer.playAttack(weapon);
}

function interact(): void {
  const pickup = nearestPickup();
  if (pickup) submit({ kind: "pickup", pickupId: pickup.id });
}

function openRoom(): void {
  if (roomDialog.open || controlsDialog.open) return;
  roomDialog.showModal();
  syncPause();
}

function roomLink(code: string): string {
  const url = new URL(window.location.href);
  url.searchParams.set("room", code);
  return url.toString();
}

function enterRoom(rawCode: string): void {
  if (peerRoom) return;
  const code = normalizeRoomCode(rawCode);
  if (code.length < 6 || code.length > 24) {
    roomStatus.textContent = "Enter a room code with 6–24 letters or numbers.";
    return;
  }
  try {
    match?.reset(selfId);
    lastEventId = 0;
    peerRoom = new PeerRoom(code, arena, match!, {
      onPeers(count, spawnSlot) {
        openRoomButton.textContent = count === 1 ? "Room · waiting" : `Room · ${count} players`;
        viewer?.setSpawnSlot(spawnSlot);
      },
      onPose(peerId, pose) {
        viewer?.setRemotePose(peerId, pose);
      },
      onPeerLeave(peerId) {
        viewer?.removeRemotePeer(peerId);
      },
      onStatus(message) {
        roomStatus.textContent = message;
      },
    });
    roomCodeInput.value = code;
    activeRoomCode.textContent = code;
    inviteLink.value = roomLink(code);
    roomEntry.hidden = true;
    roomActive.hidden = false;
    window.history.replaceState(null, "", inviteLink.value);
  } catch {
    match?.reset(selfId);
    roomStatus.textContent = "Could not open the room. Please try again.";
  }
}

async function leaveRoom(): Promise<void> {
  const leaving = peerRoom;
  peerRoom = null;
  viewer?.clearRemotePeers();
  viewer?.setSpawnSlot(0);
  match?.reset(selfId);
  lastEventId = 0;
  roomEntry.hidden = false;
  roomActive.hidden = true;
  roomStatus.textContent = "Room left. You can still explore on your own.";
  openRoomButton.textContent = "Play together";
  const url = new URL(window.location.href);
  url.searchParams.delete("room");
  window.history.replaceState(null, "", url);
  if (leaving) await leaving.leave();
}

openControlsButton.addEventListener("click", openControls);
closeControlsButton.addEventListener("click", closeControls);
controlsDialog.addEventListener("close", syncPause);
openRoomButton.addEventListener("click", openRoom);
closeRoomButton.addEventListener("click", () => roomDialog.close());
roomDialog.addEventListener("close", syncPause);
createRoomButton.addEventListener("click", () => enterRoom(newRoomCode()));
joinRoomButton.addEventListener("click", () => enterRoom(roomCodeInput.value));
roomCodeInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") enterRoom(roomCodeInput.value);
});
leaveRoomButton.addEventListener("click", () => { void leaveRoom(); });
copyInviteButton.addEventListener("click", () => {
  if (!navigator.clipboard) {
    inviteLink.select();
    roomStatus.textContent = "Copy is unavailable. Select and copy the link above.";
    return;
  }
  void navigator.clipboard.writeText(inviteLink.value).then(() => {
    roomStatus.textContent = "Invite link copied. Share it with a friend.";
  }).catch(() => {
    inviteLink.select();
    roomStatus.textContent = "Copy is unavailable. Select and copy the link above.";
  });
});
document.addEventListener("keydown", (event) => {
  if (event.key.toLowerCase() !== "h" || event.repeat || event.altKey || event.metaKey || event.ctrlKey || roomDialog.open) return;
  event.preventDefault();
  if (controlsDialog.open) closeControls();
  else openControls();
});

document.addEventListener("keydown", (event) => {
  if (event.repeat || event.altKey || event.metaKey || event.ctrlKey || controlsDialog.open || roomDialog.open || document.activeElement instanceof HTMLInputElement) return;
  const key = event.key.toLowerCase();
  if (!["f", "e", "1", "2", "3", "r", "m", "enter"].includes(key)) return;
  event.preventDefault();
  if (key === "m") {
    gameAudio.setMuted(!gameAudio.isMuted());
    toast(gameAudio.isMuted() ? "Sound off · press M to turn it back on" : "Sound on");
  } else if (key === "f") attack();
  else if (key === "e") interact();
  else if (key === "r") submit({ kind: "reload" });
  else if (key === "enter") submit({ kind: "respawn" });
  else {
    const weapon: WeaponKind = key === "1" ? "knife" : key === "2" ? "pistol" : "rifle";
    submit({ kind: "select", weapon });
  }
});

window.setInterval(() => {
  if (!viewer || !match) return;
  const pose = viewer.playerPose();
  match.setPose(selfId, pose);
  peerRoom?.sendPose(pose);
}, 50);

window.setInterval(() => {
  if (!viewer || !match) return;
  if (peerRoom) peerRoom.tickCombat();
  else match.tick();
  const pickup = nearestPickup();
  pickupHint.hidden = !pickup || (match.player(selfId)?.health ?? 0) <= 0;
  if (pickup) pickupHint.textContent = `Press E to pick up ${WEAPONS[pickup.weapon].label}`;
  const player = match.player(selfId);
  if (player?.health === 0) {
    const seconds = Math.max(0, Math.ceil((player.respawnAfter - Date.now()) / 1000));
    respawnHint.textContent = seconds > 0 ? `Respawn in ${seconds}…` : "Press Enter to respawn";
  }
}, 100);
window.addEventListener("beforeunload", () => { void peerRoom?.leave(); });

void createMapViewer(element("map"), arena, {
  onStatus: setStatus,
  onAim(spreadPixels, melee) {
    crosshair?.style.setProperty("--gap", `${Math.max(3, spreadPixels).toFixed(1)}px`);
    crosshair?.classList.toggle("melee", melee);
  },
  onMetrics(metrics) {
    performanceLabel.textContent = `${metrics.renderer} · ${metrics.fps} FPS`;
    performanceLabel.title = `${metrics.drawCalls} draw calls · ${metrics.triangles.toLocaleString()} triangles · ${metrics.pixelRatio.toFixed(2)}× resolution`;
  },
}).then((created) => {
  viewer = created;
  match = new MatchState(created.arenaData(), arena, onMatchChange, (ray) => created.clearShot(ray), (ray) => created.traceShot(ray));
  match.reset(selfId);
  const canvas = element("map").querySelector("canvas");
  if (canvas) {
    let pointerDown: { x: number; y: number; time: number } | null = null;
    canvas.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      if (document.pointerLockElement === canvas) { triggerHeld = true; attack(); }
      else pointerDown = { x: event.clientX, y: event.clientY, time: performance.now() };
    });
    canvas.addEventListener("pointerup", (event) => {
      if (!pointerDown || document.pointerLockElement === canvas) return;
      if (Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) < 7 && performance.now() - pointerDown.time < 350) attack();
      pointerDown = null;
    });
    canvas.addEventListener("pointercancel", () => { pointerDown = null; });
  }
  syncPause();
  const invite = new URLSearchParams(window.location.search).get("room");
  if (invite) enterRoom(invite);
}).catch(() => {
  setStatus("error", "The world could not load. Check browser WebGPU or WebGL 2 support, then reload.");
  performanceLabel.textContent = "Graphics unavailable";
});
