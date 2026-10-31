import "./style.css";
import { MARKET_ARENA } from "./world/nightMarket";
import { createMapViewer, type MapViewer, type MapState } from "./world/mapViewer";
import { newRoomCode, normalizeRoomCode, PeerRoom } from "./network/peerRoom";
import { selfId } from "trystero";
import { carriedMass, KNIFE, MAGAZINE_LABEL, MAGAZINES_PER_PICKUP, MAX_SPARE_MAGAZINES, PICKUP_HEIGHT, PICKUP_REACH, WEAPONS, type GunKind, type KnifeStroke, type WeaponKind } from "./game/combatRules";
import { MatchState, type CombatEvent, type CombatIntent, type CombatPlayer, type CombatSnapshot } from "./game/matchState";
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
const grenadeCount = element<HTMLElement>("grenade-count");
const magRow = element<HTMLElement>("mag-row");
const magPips = element<HTMLElement>("mag-pips");
const loadCount = element<HTMLElement>("load-count");
const CAUSE_LABEL: Record<string, string> = { knife: WEAPONS.knife.label, pistol: WEAPONS.pistol.label, rifle: WEAPONS.rifle.label, grenade: "Frag grenade", fall: "Fall" };
const damageFlash = element<HTMLElement>("damage-flash");
const performanceLabel = element<HTMLElement>("performance");
const loader = element<HTMLElement>("loader");
const loaderFill = element<HTMLElement>("loader-fill");
const loaderStep = element<HTMLElement>("loader-step");
const loaderPercent = element<HTMLElement>("loader-percent");
const loaderTip = element<HTMLElement>("loader-tip");
let viewer: MapViewer | null = null;
let peerRoom: PeerRoom | null = null;
let match: MatchState | null = null;
let lastEventId = 0;
let lastLocalAttack = 0;
let lastDryFire = 0;
let pendingShot = 0;
let triggerHeld = false;
// The knife can start its next stroke after this moment.
let knifeFreeAt = 0;
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
const arena = MARKET_ARENA;
const dialogOpen = (): boolean => controlsDialog.open || roomDialog.open;

// The loader's bar never moves backward.
let loadProgress = 0;
const LOADER_TIPS = [
  "Press H any time to see every control.",
  "Hold Q or E to lean around cover.",
  "Press G to throw a grenade. It bounces, rolls and bursts after 2.6 seconds.",
  "Crouch while sprinting to slide.",
  "Press Space facing cover or a ledge to climb onto it.",
  "Walk into a ladder to climb to the fire escape or the balcony. Long falls hurt.",
  "Rounds go through glass, crates, bins and cardboard, but not brick.",
  "Shoot out a shop window and climb through it.",
  "The bar stair and the alley ladder both reach the balcony.",
  "Stalls stop pistol rounds; carbine rounds punch through them.",
  "Guns come with one magazine. Spare magazines lie on tables, counters and high ground.",
  "Everything you carry has weight: a carbine and its magazines slow you down.",
  "Right-click or press V to stab with the knife. A stab in the back is fatal.",
  "Fallen players drop their guns and magazines.",
  "Climb into the food truck by its back doors. Its propane tanks explode when shot.",
  "Shoot out lamps and signs to darken a lane. The breaker box blacks out the service alley.",
  "Slash a shut door to kick it open. Enough rounds, or a grenade, blow it off its hinges.",
  "Shoot a steam pipe to fill the alley around it with cover.",
  "The record shop runs through the middle block. Its boarded back window can be blown out.",
  "Shoot a red fuel drum and get clear: it vents fire, then explodes.",
  "A broken stall leaves a low pile you can still hide behind.",
];
let tipIndex = 0;
const tipTimer = window.setInterval(() => { tipIndex = (tipIndex + 1) % LOADER_TIPS.length; loaderTip.textContent = LOADER_TIPS[tipIndex]; }, 3500);

function showProgress(fraction: number, step?: string): void {
  loadProgress = Math.max(loadProgress, Math.min(1, fraction));
  loaderFill.style.width = `${(loadProgress * 100).toFixed(1)}%`;
  loaderPercent.textContent = `${Math.round(loadProgress * 100)}%`;
  if (step) loaderStep.textContent = step;
}

function setStatus(state: MapState, message: string): void {
  loader.dataset.state = state;
  if (state === "error") {
    window.clearInterval(tipTimer);
    loaderStep.textContent = message;
    loaderTip.textContent = "Arena unavailable. Reload the page to try again.";
    return;
  }
  if (state !== "ready") return;
  window.clearInterval(tipTimer);
  showProgress(1, "Ready");
  window.setTimeout(() => {
    loader.classList.add("done");
    window.setTimeout(() => { loader.hidden = true; }, 650);
  }, 250);
}

function openControls(): void {
  if (dialogOpen()) return;
  controlsDialog.showModal();
  syncPause();
}

function closeControls(): void {
  if (controlsDialog.open) controlsDialog.close();
}

function syncPause(): void {
  if (dialogOpen() || (match?.player(selfId)?.health ?? 100) <= 0) triggerHeld = false;
  viewer?.setPaused(dialogOpen() || (match?.player(selfId)?.health ?? 100) <= 0);
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
  const distance = event.from && viewer ? Math.hypot(event.from.x - (viewer.remotePosition(event.target!)?.x ?? event.from.x), event.from.z - (viewer.remotePosition(event.target!)?.z ?? event.from.z)) : 0;
  const details = [event.zone === "head" ? "Headshot" : "", CAUSE_LABEL[event.cause ?? ""] ?? "", distance >= 0.5 ? `${Math.max(1, Math.round(distance))} m` : ""];
  killDetail.textContent = details.filter(Boolean).join(" · ");
  replay(killBanner);
  replay(scoreLabel);
}

// Rounds in the gun and spare rounds, one bar per spare magazine and what it all weighs.
function showAmmo(player: CombatPlayer): void {
  const gun = player.active === "knife" ? null : player.active;
  const spares = gun ? player.mags[gun] : [];
  ammoCount.textContent = !gun ? "SLASH · STAB" : player.reloadUntil > Date.now() ? "RELOADING" : `${player.ammo[gun]} / ${spares.reduce((sum, rounds) => sum + rounds, 0)}`;
  magRow.hidden = !gun;
  magPips.replaceChildren(...(gun && spares.length ? spares.map((rounds) => {
    const pip = document.createElement("i");
    pip.style.setProperty("--fill", (rounds / WEAPONS[gun].magazine).toFixed(2));
    return pip;
  }) : [Object.assign(document.createElement("em"), { textContent: "NONE" })]));
  const mass = carriedMass(player);
  loadCount.textContent = `${mass.toFixed(1)} kg`;
  loadCount.parentElement?.classList.toggle("heavy", mass > 6);
  viewer?.setLoad(mass);
}

// Weapon switches and reload starts arrive as state changes rather than events.
function cueStateChanges(state: CombatSnapshot, fresh: CombatEvent[]): void {
  for (const [peerId, player] of Object.entries(state.players)) {
    const before = previousPlayers.get(peerId);
    previousPlayers.set(peerId, { active: player.active, reloadUntil: player.reloadUntil, health: player.health });
    if (!before) continue;
    const reloadStarted = player.health > 0 && player.reloadUntil > 0 && player.reloadUntil !== before.reloadUntil;
    if (peerId === selfId) {
      const pickedUp = fresh.some((event) => event.kind === "pickup" && event.actor === selfId);
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
  showAmmo(player);
  scoreLabel.textContent = `${player.kills} KILL${player.kills === 1 ? "" : "S"} · ${player.deaths} DEATH${player.deaths === 1 ? "" : "S"}`;
  viewer?.setWeapon(player.active);
  viewer?.setTakenPickups(state.taken);
  viewer?.setOpen(state.open);
  for (const [peerId, remote] of Object.entries(state.players)) if (peerId !== selfId) {
    viewer?.setRemoteHealth(peerId, remote.health);
    viewer?.setRemoteWeapon(peerId, remote.active);
    viewer?.setRemoteMass(peerId, carriedMass(remote));
  }
  deathOverlay.hidden = player.health > 0;
  viewer?.setLocalDead(player.health <= 0);
  if (wasDead && player.health > 0) viewer?.respawn();
  syncPause();
  gameAudio.setDown(player.health <= 0);
  grenadeCount.textContent = player.grenades ? "● ".repeat(player.grenades).trim() : "—";
  viewer?.setEntityHealth(state.entities);
  // A peer joining a running room receives a backlog of events; it starts from the newest.
  if (lastEventId === 0 && state.eventSeq > 3) lastEventId = state.eventSeq;
  const fresh = state.events.filter((event) => event.id > lastEventId);
  cueStateChanges(state, fresh);
  viewer?.setDrops(state.drops, new Set(fresh.flatMap((event) => event.kind === "drop" && event.drop ? [event.drop] : [])));
  for (const event of fresh) {
    lastEventId = event.id;
    playEvent(event);
  }
}

function playEvent(event: CombatEvent): void {
  if (event.kind === "shot" && event.shot) viewer?.showShot(event, event.actor === selfId);
  viewer?.playEvent(event, selfId);
  const damaging = event.kind === "hit" || event.kind === "death";
  if (damaging && event.actor === selfId && event.target !== selfId) {
    const headshot = event.zone === "head", kill = event.kind === "death";
    damageReadout.textContent = `${headshot ? "HEADSHOT · " : ""}${event.damage ?? 0}`;
    damageReadout.classList.toggle("headshot", headshot);
    pulse(damageReadout, 700);
    replay(hitMarker, ...(headshot ? ["headshot"] : []), ...(kill ? ["kill"] : []));
    gameAudio.hitConfirm(headshot, kill);
    if (kill) showElimination(event);
  }
  if (damaging && event.target && event.target !== selfId) viewer?.remoteFlinch(event.target, event.damage ?? 0);
  if (event.kind === "pickup" && event.actor === selfId && event.weapon) {
    const gun = event.weapon as GunKind;
    toast(event.item === "magazines" ? `${MAGAZINES_PER_PICKUP} × ${MAGAZINE_LABEL[gun]}s` : event.item === "drop" ? `Took the dropped ${WEAPONS[gun].label.toLowerCase()}` : match?.player(selfId)?.active === gun ? `${WEAPONS[gun].label} · one magazine` : `Took its ${MAGAZINE_LABEL[gun]}`);
    gameAudio.pickup();
  }
  if (event.kind === "reload" && event.actor === selfId && match) {
    const player = match.player(selfId);
    if (player && player.active !== "knife" && !player.mags[player.active].length) window.setTimeout(() => toast("That was your last magazine"), 600);
  }
  if (damaging && event.target === selfId) {
    pulse(damageFlash, 420);
    gameAudio.hurt(event.damage ?? 0, event.kind === "death");
    viewer?.flinch(event.damage ?? 0);
    if (event.from && event.cause !== "fall") showDamageDirection(event.from);
  }
  if (event.kind === "death" && event.target === selfId) toast(event.cause === "fall" ? "You fell too far" : event.cause === "grenade" && event.actor === selfId ? "Caught in your own blast" : "You were eliminated");
}

function throwGrenade(): void {
  if (!viewer || !match || dialogOpen()) return;
  const player = match.player(selfId);
  if (!player || player.health <= 0 || !viewer.weaponReady()) return;
  if (player.grenades <= 0) { toast("No grenades left"); return; }
  viewer.holdSprint(0.5);
  viewer.quickThrow();
  const { heading, pitch } = viewer.playerPose();
  submit({ kind: "throw", aim: { heading, pitch } });
}

function submit(intent: CombatIntent): void {
  if (!match || !viewer) return;
  match.setPose(selfId, viewer.playerPose());
  if (peerRoom) peerRoom.sendCombatIntent(intent);
  else match.apply(selfId, intent);
}

// The closest thing in reach to pick up, placed or dropped, with what taking it would give.
function nearestPickup(): { id: string; label: string; full: boolean } | null {
  if (!viewer || !match) return null;
  const player = match.player(selfId);
  if (!player) return null;
  const pose = viewer.playerPose(), state = match.getState(), taken = new Set(state.taken);
  const room = (gun: GunKind): boolean => player.mags[gun].length < MAX_SPARE_MAGAZINES;
  const candidates: { id: string; east: number; north: number; y: number; label: string; full: boolean }[] = [];
  for (const pickup of match.pickups) {
    if (taken.has(pickup.id)) continue;
    const gun = pickup.weapon, owned = player.owned.includes(gun);
    const label = pickup.item === "magazines" ? `${MAGAZINES_PER_PICKUP} × ${MAGAZINE_LABEL[gun]}s` : owned ? `the ${MAGAZINE_LABEL[gun]} from this ${WEAPONS[gun].label.toLowerCase()}` : `the ${WEAPONS[gun].label.toLowerCase()} (${WEAPONS[gun].magazine} rounds)`;
    candidates.push({ id: pickup.id, east: pickup.east, north: pickup.north, y: pickup.y, label, full: (pickup.item === "magazines" || owned) && !room(gun) });
  }
  for (const drop of state.drops) {
    const gun = drop.weapon, mags = drop.mags.length, takesGun = drop.gun && !player.owned.includes(gun);
    const parts = [drop.gun ? `${drop.rounds} round${drop.rounds === 1 ? "" : "s"} loaded` : "", mags ? `${mags} magazine${mags === 1 ? "" : "s"}` : ""].filter(Boolean).join(", ");
    candidates.push({ id: drop.id, east: drop.position.x, north: drop.position.z, y: drop.position.y, label: `the dropped ${drop.gun ? WEAPONS[gun].label.toLowerCase() : MAGAZINE_LABEL[gun] + "s"} (${parts})`, full: !takesGun && !room(gun) });
  }
  return candidates
    .map((candidate) => ({ candidate, distance: Math.hypot(candidate.east - pose.east, candidate.north - pose.north) }))
    .filter(({ candidate, distance }) => distance <= PICKUP_REACH && Math.abs(pose.jumpHeight - candidate.y) <= PICKUP_HEIGHT + 0.1)
    .sort((a, b) => a.distance - b.distance)[0]?.candidate ?? null;
}

function attack(stroke: KnifeStroke = "slash"): void {
  if (!viewer || !match || dialogOpen()) return;
  const player = match.player(selfId);
  if (!player || player.health <= 0 || !viewer.weaponReady()) return;
  const weapon = player.active;
  if (weapon !== "knife" && stroke === "stab") return;
  // Firing drops a sprint; the shot follows once the weapon is up. Each attack keeps the
  // sprint held off briefly, so a held trigger walks and a released one runs again.
  const sprinting = viewer.playerPose().running;
  viewer.holdSprint(0.35);
  if (sprinting || pendingShot) {
    if (!pendingShot) pendingShot = window.setTimeout(() => { pendingShot = 0; attack(stroke); }, SPRINT_OUT_MS[weapon]);
    return;
  }
  const now = Date.now();
  if (weapon === "knife") {
    // The stroke starts now and the blade lands when the swing reaches its target, aimed
    // wherever the player is looking by then.
    if (now < knifeFreeAt) return;
    knifeFreeAt = now + KNIFE[stroke].recoveryMs;
    viewer.playAttack("knife", stroke);
    window.setTimeout(() => {
      const current = match?.player(selfId);
      if (!viewer || !current || current.health <= 0 || current.active !== "knife") return;
      const { heading, pitch } = viewer.playerPose();
      submit({ kind: "attack", weapon: "knife", stroke, aim: { heading, pitch }, seen: viewer.seenTimes() });
    }, KNIFE[stroke].contactMs);
    return;
  }
  if (now - lastLocalAttack < WEAPONS[weapon].cooldownMs || player.reloadUntil > now) return;
  if (player.ammo[weapon] <= 0) {
    // Held triggers retry every frame; click and remind at most a few times a second.
    if (now - lastDryFire > 300) { lastDryFire = now; gameAudio.dryFire(); toast(player.mags[weapon].length ? "Press R to reload" : "Out of ammunition: find magazines"); }
    return;
  }
  lastLocalAttack = now;
  const { heading, pitch } = viewer.playerPose();
  submit({ kind: "attack", weapon, aim: { heading, pitch }, seen: viewer.seenTimes() });
  viewer.playAttack(weapon);
}

// E takes the nearest pickup, or else opens or closes the nearest door or hatch.
function interact(): void {
  const pickup = nearestPickup();
  if (pickup?.full) toast("Your magazine pouches are full");
  else if (pickup) submit({ kind: "pickup", pickupId: pickup.id });
  else {
    const usable = viewer?.nearestUse();
    if (usable) submit({ kind: "use", target: usable.id });
  }
}

function reload(): void {
  const player = match?.player(selfId);
  if (!player || player.health <= 0 || player.active === "knife") return;
  if (!player.mags[player.active].length) { toast("No spare magazines. Find some on tables, counters and high ground"); return; }
  submit({ kind: "reload" });
}

function openRoom(): void {
  if (dialogOpen()) return;
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
    viewer?.resetWorld();
    lastEventId = 0;
    peerRoom = new PeerRoom(code, arena, match!, {
      onPeers(count, spawnSlot) {
        openRoomButton.textContent = count === 1 ? "Room · waiting" : `Room · ${count} players`;
        viewer?.setSpawnSlot(spawnSlot);
      },
      onPose(peerId, pose, sentAt) {
        viewer?.setRemotePose(peerId, pose, sentAt);
      },
      onPeerLeave(peerId) {
        viewer?.removeRemotePeer(peerId);
      },
      onStatus(message) {
        roomStatus.textContent = message;
      },
      onProps(states) {
        viewer?.applyPropStates(states);
      },
      onPushes(pushes) {
        viewer?.applyShoves(pushes);
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
  viewer?.resetWorld();
  viewer?.setAuthority(true);
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
  if (event.repeat || event.altKey || event.metaKey || event.ctrlKey || dialogOpen() || document.activeElement instanceof HTMLInputElement) return;
  const key = event.key.toLowerCase();
  if (!["f", "v", "e", "g", "1", "2", "3", "r", "m", "enter"].includes(key)) return;
  event.preventDefault();
  if (key === "m") {
    gameAudio.setMuted(!gameAudio.isMuted());
    toast(gameAudio.isMuted() ? "Sound off · press M to turn it back on" : "Sound on");
  } else if (key === "f") attack();
  else if (key === "v") attack("stab");
  else if (key === "g") throwGrenade();
  else if (key === "e") interact();
  else if (key === "r") reload();
  else if (key === "enter") submit({ kind: "respawn" });
  else {
    const weapon: WeaponKind = key === "1" ? "knife" : key === "2" ? "pistol" : "rifle";
    submit({ kind: "select", weapon });
  }
});

// The coordinating peer simulates loose props and shares moving ones 15 times a second,
// with every displaced prop every two seconds for peers that just joined.
let propTick = 0;
window.setInterval(() => {
  if (!viewer) return;
  const leading = !peerRoom || peerRoom.leading();
  viewer.setAuthority(leading);
  // Props this player walked into go to the peer that simulates them.
  const shoves = viewer.takeShoves();
  if (peerRoom && !leading) peerRoom.sendPushes(shoves);
  if (!peerRoom || !leading) return;
  propTick += 1;
  peerRoom.sendProps(viewer.propStates(propTick % 30 === 0));
}, 66);

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
  const usable = pickup ? null : viewer.nearestUse();
  pickupHint.hidden = (!pickup && !usable) || (match.player(selfId)?.health ?? 0) <= 0;
  if (pickup) pickupHint.textContent = pickup.full ? `Your magazine pouches are full` : `Press E to take ${pickup.label}`;
  else if (usable) pickupHint.textContent = `Press E to ${usable.open ? "close" : "open"} ${usable.label}`;
  const player = match.player(selfId);
  if (player?.health === 0) {
    const seconds = Math.max(0, Math.ceil((player.respawnAfter - Date.now()) / 1000));
    respawnHint.textContent = seconds > 0 ? `Respawn in ${seconds}…` : "Press Enter to respawn";
  }
}, 100);
window.addEventListener("beforeunload", () => { void peerRoom?.leave(); });

void createMapViewer(element("map"), arena, {
  onStatus: setStatus,
  onProgress: showProgress,
  onHardLanding(speed) { submit({ kind: "fall", speed }); },
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
  match = new MatchState(created.arenaData(), onMatchChange, created.combatWorld());
  match.reset(selfId);
  const canvas = element("map").querySelector("canvas");
  if (canvas) {
    let pointerDown: { x: number; y: number; time: number } | null = null;
    // The right button stabs with the knife.
    canvas.addEventListener("contextmenu", (event) => event.preventDefault());
    canvas.addEventListener("pointerdown", (event) => {
      if (event.button === 2) { attack("stab"); return; }
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
