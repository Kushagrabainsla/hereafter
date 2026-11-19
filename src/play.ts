import { MARKET_ARENA } from "./world/nightMarket";
import { createMapViewer, type MapViewer } from "./world/mapViewer";
import { newRoomCode, normalizeRoomCode, PeerRoom } from "./network/peerRoom";
import { selfId } from "trystero";
import { BANDAGE_MS, BLEED_DRIP_MS, SPRAY_MS, carriedMass, EAT_MS, NO_SPRINT_LEG, reloadTime, FOOD, FULL_HEALTH, MAGAZINE_LABEL, MAGAZINES_PER_PICKUP, MAX_SPARE_MAGAZINES, PICKUP_HEIGHT, PICKUP_REACH, RESPAWN, WEAPONS, type GunKind, type WeaponKind } from "./game/combatRules";
import { standings, KILL_LIMIT, MatchState, ROUND_MS, type CombatEvent, type CombatIntent, type CombatPlayer, type CombatSnapshot } from "./game/matchState";
import { gameAudio } from "./game/gameAudio";
import { PlayerVoices } from "./game/playerVoices";
import { Memes, type MemeMoment } from "./game/memes";
import { cleanName, LANGUAGES, measuredQuality, saveMeasuredQuality, saveSettings, VOICE_CHOICES, voiceOf, type Language, type Settings, type VoiceChoice } from "./settings";
import { type Loading, type StepId } from "./loading";
import { assetUrl, releaseAssets } from "./assetStore";
import { mapById } from "./maps";
import { DefaultLoadingManager } from "three/webgpu";
import { fillScreen } from "./mouseLock";
import { INPUT, INPUT_RANGE, setInput } from "./inputSettings";
import { gameKey } from "./keys";
import { SoloTargets } from "./game/soloTargets";
import { cheaper, drawnPixels, FPS_FLOOR, pickQuality, QUALITY, QUALITY_LABEL, type QualityLevel } from "./world/quality";

// The game: the world, the match and everything on screen during play. main.ts loads this
// module while the player sets up a match, and calls launch() on Deploy; until then nothing
// here runs but wiring.

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing UI element: ${id}`);
  return found as T;
}

const controlsDialog = element<HTMLDialogElement>("controls-dialog");
const pauseDialog = element<HTMLDialogElement>("pause-dialog");
const pauseEyebrow = element<HTMLElement>("pause-eyebrow");
const pauseTitle = element<HTMLElement>("pause-title");
const pauseNote = element<HTMLElement>("pause-note");
const pauseResumeButton = element<HTMLButtonElement>("pause-resume");
const pauseSettingsButton = element<HTMLButtonElement>("pause-settings");
const pauseControlsButton = element<HTMLButtonElement>("pause-controls");
const pauseInviteButton = element<HTMLButtonElement>("pause-invite");
const pauseLeaveButton = element<HTMLButtonElement>("pause-leave");
const settingsDialog = element<HTMLDialogElement>("settings-dialog");
const closeSettingsButton = element<HTMLButtonElement>("close-settings");
const settingSound = element<HTMLInputElement>("setting-sound");
const settingSetupButton = element<HTMLButtonElement>("setting-setup");
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
const lowHealth = element<HTMLElement>("low-health");
// The health below which the edges of the view turn red.
const LOW_HEALTH = 35;
const weaponName = element<HTMLElement>("weapon-name");
const ammoCount = element<HTMLElement>("ammo-count");
const scoreLabel = element<HTMLElement>("score-label");
const pickupHint = element<HTMLElement>("pickup-hint");
const resumeHint = element<HTMLElement>("resume-hint");
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
const smokeCount = element<HTMLElement>("smoke-count");
const magRow = element<HTMLElement>("mag-row");
const magPips = element<HTMLElement>("mag-pips");
const loadCount = element<HTMLElement>("load-count");
const woundRow = element<HTMLElement>("wound-row");
const bandageCount = element<HTMLElement>("bandage-count");
const CAUSE_LABEL: Record<string, string> = { pistol: WEAPONS.pistol.label, rifle: WEAPONS.rifle.label, grenade: "Frag grenade", fall: "Fall", struck: "Thrown object", bleed: "Bled out", fire: "Fire" };
const damageFlash = element<HTMLElement>("damage-flash");
const performanceLabel = element<HTMLElement>("performance");
const playerNameInput = element<HTMLInputElement>("player-name");
const voiceLanguageInput = element<HTMLSelectElement>("voice-language");
const voiceLinesInput = element<HTMLInputElement>("voice-lines");
const adultVoiceInput = element<HTMLInputElement>("adult-voice");
const memeSoundsInput = element<HTMLInputElement>("meme-sounds");
const roundHud = element<HTMLElement>("round-hud");
const roundClock = element<HTMLElement>("round-clock");
const roundNote = element<HTMLElement>("round-note");
const roundBanner = element<HTMLElement>("round-banner");
const roundBannerTitle = element<HTMLElement>("round-banner-title");
const roundBannerDetail = element<HTMLElement>("round-banner-detail");
const killFeed = element<HTMLOListElement>("kill-feed");
const scoreboard = element<HTMLElement>("scoreboard");
const scoreboardEyebrow = element<HTMLElement>("scoreboard-eyebrow");
const scoreboardTitle = element<HTMLElement>("scoreboard-title");
const scoreboardNote = element<HTMLElement>("scoreboard-note");
const scoreboardRows = element<HTMLElement>("scoreboard-rows");
const scoreboardFooter = element<HTMLElement>("scoreboard-footer");
const deathCause = element<HTMLElement>("death-cause");
let viewer: MapViewer | null = null;
let peerRoom: PeerRoom | null = null;
// The practice targets of a solo game; none while in a room.
let soloTargets: SoloTargets | null = null;
let match: MatchState | null = null;
let lastEventId = 0;
let lastLocalAttack = 0;
let lastDryFire = 0;
let respawnAskedAt = 0;
let pendingShot = 0;
let triggerHeld = false;
let sprayHeld = false;
// Time to bring a weapon up out of a sprint before it fires.
const SPRINT_OUT_MS: Record<WeaponKind, number> = { pistol: 140, rifle: 220 };
const crosshair = document.querySelector<HTMLElement>(".crosshair");
const previousPlayers = new Map<string, { active: WeaponKind; reloadUntil: number; health: number }>();
// Browsers only start audio from a user gesture; every gesture retries until it runs.
for (const type of ["pointerdown", "keydown", "touchstart"]) window.addEventListener(type, () => gameAudio.unlock(), { capture: true, passive: true });
// Letting go of every button ends firing and aiming, whichever came up last.
window.addEventListener("pointerup", (event) => { if (event.buttons === 0) { triggerHeld = false; sprayHeld = false; viewer?.setAiming(false); viewer?.releaseThrow(); } });
window.addEventListener("blur", () => { triggerHeld = false; sprayHeld = false; viewer?.setAiming(false); viewer?.cancelThrow(); });
document.addEventListener("pointerlockchange", () => { triggerHeld = false; sprayHeld = false; viewer?.cancelThrow(); });
// The held trigger of an automatic weapon: how often the game looks if the next shot is due, and
// how late a shot may be and still keep the beat (later than that, the beat starts again).
const FIRE_BEAT = { tick: 8, late: 40 };
window.setInterval(() => {
  if (triggerHeld && document.pointerLockElement && match?.player(selfId)?.active === "rifle") attack();
}, FIRE_BEAT.tick);
let toastTimer = 0;
const arena = MARKET_ARENA;

// The player's choices from the setup screen, changed in the match dialog during play and
// kept in this browser. Nothing runs until launch().
let settings: Settings | null = null;
let launched = false;
let playerName = "";
let nameSentAt = 0;
// The player's language and whether they speak lines, and the voice the two make.
let language: Language = "en";
let lines = true;
let voiceChoice: VoiceChoice = "en";
const keep = (): void => { if (settings) { Object.assign(settings, { name: playerName, language, lines, adult: voices.adult, memes: voices.memes.on }); saveSettings(settings); } };
playerNameInput.addEventListener("input", () => {
  const name = cleanName(playerNameInput.value);
  if (!name) return;
  playerName = name;
  nameSentAt = 0;
  keep();
});
playerNameInput.addEventListener("change", () => { playerNameInput.value = playerName; });
function changeVoice(): void {
  language = LANGUAGES.find((choice) => choice === voiceLanguageInput.value) ?? "en";
  lines = voiceLinesInput.checked;
  voiceChoice = voiceOf({ language, lines });
  nameSentAt = 0;
  keep();
  void loadVoices();
}
voiceLanguageInput.addEventListener("change", changeVoice);
voiceLinesInput.addEventListener("change", changeVoice);
// Other players speak with their own choice, heard from where they stand.
const voices = new PlayerVoices(selfId, (id) => {
  if (id === selfId) return voiceChoice;
  return VOICE_CHOICES.find((choice) => choice === match?.player(id)?.voice) ?? "en";
}, (id) => {
  const at = viewer?.remotePosition(id);
  return at ? { x: at.x, y: at.y + 1.6, z: at.z } : null;
}, (id) => (id === selfId ? viewer?.playerPose() : match?.poseAt(id))?.running ?? false);
adultVoiceInput.addEventListener("change", () => { voices.adult = voices.memes.adult = adultVoiceInput.checked; keep(); void loadVoices(); });
memeSoundsInput.addEventListener("change", () => { voices.memes.on = memeSoundsInput.checked; keep(); void loadVoices(); });

// The voice and meme clips this player can hear: their own language's and every other
// player's in the room, loaded as players with new languages arrive.
const loadedVoices = new Set<string>();
function wantedClips(): string[] {
  const langs = new Set<VoiceChoice>([voiceChoice, ...Object.values(match?.players() ?? {}).map((player) => player.voice as VoiceChoice).filter((voice) => VOICE_CHOICES.includes(voice))]);
  return [...PlayerVoices.clips(langs, voices.adult), ...(voices.memes.on ? Memes.clips(langs, voices.adult) : [])];
}
function loadVoices(onDone?: (path: string) => void): Promise<void> {
  const clips = wantedClips().filter((path) => !loadedVoices.has(path));
  for (const path of clips) loadedVoices.add(path);
  return gameAudio.loadClips(clips, onDone);
}

// Another player's name, or a stand-in made from their id until theirs arrives.
function nameOf(id: string): string {
  if (id === selfId) return playerName;
  return match?.player(id)?.name || `Player ${id.slice(0, 4).toUpperCase()}`;
}

// Times in the match are on the coordinator's clock.
const roomClock = (): number => peerRoom?.clock() ?? Date.now();
const clockText = (ms: number): string => {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};
const ordinal = (n: number): string => {
  const suffix = ["th", "st", "nd", "rd"], tens = n % 100;
  return `${n}${suffix[(tens - 20) % 10] ?? suffix[tens] ?? suffix[0]}`;
};
// A player's place: one after everyone with more kills, or as many and fewer deaths, so equal
// scores share a place.
const placeOf = (players: Readonly<Record<string, CombatPlayer>>, id: string): number => {
  const me = players[id];
  return me ? 1 + Object.values(players).filter((other) => other.kills > me.kills || (other.kills === me.kills && other.deaths < me.deaths)).length : 0;
};
// The wait after a round is a ceasefire.
const ceasefire = (): boolean => match?.round().phase === "over";

const dialogOpen = (): boolean => controlsDialog.open || roomDialog.open || pauseDialog.open || settingsDialog.open;

function openControls(): void {
  if (dialogOpen()) return;
  controlsDialog.showModal();
  syncPause();
}

// The pause menu. Esc frees the mouse (the browser does that), and the menu opens with it: Resume,
// Settings, Controls, Invite and Leave match. A solo game stops while any dialog is open. A
// room's match cannot stop, and the menu says so.
function openPause(): void {
  if (!launched || dialogOpen()) return;
  const solo = !peerRoom;
  pauseEyebrow.textContent = solo ? "Solo practice" : `Room ${peerRoom?.code ?? ""}`;
  pauseTitle.textContent = solo ? "Paused" : "Menu";
  pauseNote.textContent = solo ? "The practice targets wait for you. A fire or a wound does not." : "The match goes on while this menu is open.";
  pauseInviteButton.textContent = solo ? "Play together" : "Invite";
  pauseLeaveButton.textContent = solo ? "Quit to the setup screen" : "Leave match";
  settingSound.checked = !gameAudio.isMuted();
  pauseDialog.showModal();
  syncPause();
}

// A dialog opened from the pause menu goes back to it when it closes.
let backToPause = false;
function fromPause(open: () => void): void {
  pauseDialog.close();
  backToPause = true;
  open();
}
function afterDialog(): void {
  if (backToPause && !dialogOpen()) { backToPause = false; openPause(); }
  syncPause();
}

// Whether the solo game stands still: a dialog is open and no other player is in the game.
const soloPaused = (): boolean => !peerRoom && dialogOpen();

function closeControls(): void {
  if (controlsDialog.open) controlsDialog.close();
}

// The player stops while the loading screen is up, a dialog is open or they are down. Only a
// dialog frees the mouse; otherwise it stays locked and play resumes without a click.
function syncPause(): void {
  const dead = (match?.player(selfId)?.health ?? 100) <= 0;
  const paused = !launched || dialogOpen() || dead;
  if (paused) triggerHeld = false;
  viewer?.setPaused(paused, dialogOpen());
  // With the mouse free in play, a hint says how to lock it again.
  resumeHint.hidden = !launched || dialogOpen() || dead || document.pointerLockElement !== null || !mouseLookOffered;
  // In play with the mouse locked, the title and the top buttons fade out, so the world fills the
  // screen; Esc frees the mouse and brings them back.
  document.body.classList.toggle("in-play", launched && document.pointerLockElement !== null);
}
// Touch screens cannot lock a pointer, so they get no hint.
const mouseLookOffered = matchMedia("(pointer: fine)").matches;
// When the mouse comes free in play (Esc, or another window takes the keyboard), the pause menu opens.
let mouseWasLocked = false;
document.addEventListener("pointerlockchange", () => {
  const locked = document.pointerLockElement !== null;
  if (mouseWasLocked && !locked) openPause();
  mouseWasLocked = locked;
  syncPause();
});
// With the mouse already free, Esc opens the menu. In an open dialog, the browser's own Esc closes it.
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !launched || dialogOpen() || document.pointerLockElement !== null) return;
  event.preventDefault();
  openPause();
});

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
// which is (-cos h, sin h) in east/north for heading h. Null when the attacker is on top of you.
function arcAngle(from: { x: number; z: number }): number | null {
  if (!viewer) return null;
  const pose = viewer.playerPose();
  const heading = pose.heading * Math.PI / 180;
  const east = from.x - pose.east, north = from.z - pose.north;
  if (Math.hypot(east, north) < 0.3) return null;
  return Math.atan2(-east * Math.cos(heading) + north * Math.sin(heading), east * Math.sin(heading) + north * Math.cos(heading));
}

// The place each arc on the screen points at. Every frame the arcs turn as the player turns, so
// an arc keeps pointing at where the shot came from; before, it kept the angle it was drawn with.
const arcSources = new Map<HTMLElement, { x: number; z: number }>();
function showDamageDirection(from: { x: number; z: number }): void {
  const angle = arcAngle(from);
  if (angle === null) return;
  const arc = document.createElement("div");
  arc.className = "damage-arc";
  arc.style.setProperty("--angle", `${angle}rad`);
  arcSources.set(arc, { x: from.x, z: from.z });
  arc.addEventListener("animationend", () => { arcSources.delete(arc); arc.remove(); });
  damageDirection.appendChild(arc);
  while (damageDirection.children.length > 4) { const oldest = damageDirection.firstElementChild as HTMLElement | null; if (!oldest) break; arcSources.delete(oldest); oldest.remove(); }
  if (arcSources.size === 1) requestAnimationFrame(turnArcs);
}
function turnArcs(): void {
  for (const [arc, from] of arcSources) { const angle = arcAngle(from); if (angle !== null) arc.style.setProperty("--angle", `${angle}rad`); }
  if (arcSources.size) requestAnimationFrame(turnArcs);
}

function showElimination(event: CombatEvent): void {
  const distance = event.from && viewer ? Math.hypot(event.from.x - (viewer.remotePosition(event.target!)?.x ?? event.from.x), event.from.z - (viewer.remotePosition(event.target!)?.z ?? event.from.z)) : 0;
  const details = [nameOf(event.target!), event.zone === "head" ? "Headshot" : "", CAUSE_LABEL[event.cause ?? ""] ?? "", distance >= 0.5 ? `${Math.max(1, Math.round(distance))} m` : ""];
  killDetail.textContent = details.filter(Boolean).join(" · ");
  replay(killBanner);
  replay(scoreLabel);
}

// Rounds in the gun and spare rounds, one bar per spare magazine and what it all weighs.
function showAmmo(player: CombatPlayer): void {
  const gun = player.owned.includes(player.active) ? player.active : null;
  const spares = gun ? player.mags[gun] : [];
  ammoCount.textContent = !gun ? "—" : player.reloadUntil > Date.now() ? "RELOADING" : `${player.ammo[gun]} / ${spares.reduce((sum, rounds) => sum + rounds, 0)}`;
  magRow.hidden = !gun;
  magPips.replaceChildren(...(gun && spares.length ? spares.map((rounds) => {
    const pip = document.createElement("i");
    pip.style.setProperty("--fill", (rounds / WEAPONS[gun].magazine).toFixed(2));
    return pip;
  }) : [Object.assign(document.createElement("em"), { textContent: "NONE" })]));
  const mass = carriedMass(player), total = mass + (viewer?.holding()?.mass ?? 0);
  loadCount.textContent = `${total.toFixed(1)} kg`;
  loadCount.parentElement?.classList.toggle("heavy", total > 7);
  viewer?.setLoad(mass);
}

// What the player is carrying in the way of wounds, and what they have to treat them with.
function showWounds(player: CombatPlayer): void {
  const chip = (text: string, kind = ""): HTMLElement => Object.assign(document.createElement("span"), { textContent: text, className: kind });
  const wounds = [...(player.burnUntil ? [chip("On fire: get low", "bleeding")] : []), ...(player.bleedUntil ? [chip("Bleeding", "bleeding")] : []), ...(player.leg ? [chip(player.leg >= NO_SPRINT_LEG ? "Bad leg" : "Leg wound")] : []), ...(player.arm ? [chip(player.arm >= 0.6 ? "Bad arm" : "Arm wound")] : [])];
  const text = wounds.map((wound) => wound.textContent).join();
  if (woundRow.dataset.shown !== text) { woundRow.dataset.shown = text; woundRow.replaceChildren(...wounds); }
  woundRow.hidden = !wounds.length || player.health <= 0;
  bandageCount.textContent = player.bandages ? "● ".repeat(player.bandages).trim() : "—";
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
      if (reloadStarted) viewer?.startReload(player.active, reloadTime(player.active, player.arm));
      if (player.health <= 0 && before.health > 0) { viewer?.cancelReload(); viewer?.putDown(); }
    } else if (reloadStarted) viewer?.remoteReload(peerId, player.active);
  }
  for (const peerId of previousPlayers.keys()) if (!state.players[peerId]) previousPlayers.delete(peerId);
}

let lastPhase = "";
function onMatchChange(state: CombatSnapshot): void {
  const player = state.players[selfId];
  if (!player) return;
  // A round ending rings the bell once, and the winner has something to say.
  if (state.round.phase === "over" && lastPhase === "live") {
    gameAudio.roundBell(false);
    voices.roundOver(state.round.winner, Object.keys(state.players), state.round.number);
  }
  lastPhase = state.round.phase;
  const wasDead = !deathOverlay.hidden;
  healthNumber.textContent = String(player.health);
  healthBar.setAttribute("aria-valuenow", String(player.health));
  healthBar.classList.toggle("low", player.health <= 35);
  healthFill.style.width = `${player.health}%`;
  // Below LOW_HEALTH the edges of the view turn red, more as health falls, and beat near death.
  const low = player.health > 0 ? Math.sqrt(Math.max(0, Math.min(1, (LOW_HEALTH - player.health) / LOW_HEALTH))) : 0;
  lowHealth.style.setProperty("--low", low.toFixed(2));
  lowHealth.classList.toggle("beat", player.health > 0 && player.health <= 15);
  weaponName.textContent = player.powder > 0 ? "Fire extinguisher" : WEAPONS[player.active].label;
  showAmmo(player);
  if (player.powder > 0) ammoCount.textContent = `${Math.ceil(player.powder)} S OF POWDER`;
  viewer?.setTool(player.powder > 0);
  if (player.powder <= 0) sprayHeld = false;
  scoreLabel.textContent = `${player.kills} KILL${player.kills === 1 ? "" : "S"} · ${player.deaths} DEATH${player.deaths === 1 ? "" : "S"}`;
  viewer?.setWeapon(player.active);
  viewer?.setTakenPickups(state.taken);
  viewer?.setOpen(state.open);
  viewer?.setFires(state.fires);
  viewer?.setBurning(Object.entries(state.players).filter(([id, other]) => id !== selfId && other.burnUntil > 0 && other.health > 0).map(([id]) => id));
  // Nobody keeps hold of something that has caught fire.
  const held = viewer?.holding();
  if (held && state.fires.some((fire) => fire.entity === held.id)) { viewer?.putDown(); toast("It caught fire"); }
  viewer?.setWounds(player.leg, player.arm);
  showWounds(player);
  for (const [peerId, remote] of Object.entries(state.players)) if (peerId !== selfId) {
    viewer?.setRemoteHealth(peerId, remote.health);
    viewer?.setRemoteWeapon(peerId, remote.active);
    viewer?.setRemoteLeg(peerId, remote.leg);
    viewer?.setRemoteTool(peerId, remote.powder > 0);
  }
  deathOverlay.hidden = player.health > 0;
  viewer?.setLocalDead(player.health <= 0);
  if (wasDead && player.health > 0) {
    // Back at the spawn farthest from the living enemies, with a moment of protection.
    viewer?.respawn(Object.entries(state.players).flatMap(([id, other]) => { const pose = id !== selfId && other.health > 0 ? match?.poseAt(id) : undefined; return pose ? [{ east: pose.east, north: pose.north }] : []; }));
    toast("Back in · protected for 2 s or until you fire");
  }
  syncPause();
  gameAudio.setDown(player.health <= 0);
  grenadeCount.textContent = player.grenades ? "● ".repeat(player.grenades).trim() : "—";
  smokeCount.textContent = player.smokes ? "● ".repeat(player.smokes).trim() : "—";
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
  voices.events(fresh, state.players, state.grenades);
  for (const event of fresh) {
    if (event.kind !== "death" || !event.target || event.target === selfId) continue;
    const at = viewer?.remotePosition(event.target);
    if (at) graves.push({ x: at.x, z: at.z, at: performance.now() });
  }
}

function playEvent(event: CombatEvent): void {
  if (event.kind === "round") { startRound(); return; }
  if (event.kind === "death" && event.target) addToKillFeed(event);
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
  if (event.kind === "pickup" && event.actor === selfId && event.item === "extinguisher") {
    toast("Hold click to spray at a fire");
    gameAudio.pickup();
  }
  if (event.kind === "pickup" && event.actor === selfId && event.food) {
    const food = FOOD[event.food];
    viewer?.busyHands(EAT_MS / 1000);
    if (food.rushSeconds) viewer?.startRush(food.rushSeconds);
    toast(food.rushSeconds ? `Sugar rush: faster for ${food.rushSeconds} s` : `+${food.heal} health`);
    gameAudio.pickup();
  }
  if (event.kind === "bandage" && event.actor === selfId) {
    toast("Bandaged: the bleeding has stopped");
    gameAudio.pickup();
  }
  if (event.kind === "reload" && event.actor === selfId && match) {
    const player = match.player(selfId);
    if (player && !player.mags[player.active].length) window.setTimeout(() => toast("That was your last magazine"), 600);
  }
  if (damaging && event.target === selfId) {
    pulse(damageFlash, 420);
    // Nobody keeps hold of a crate through being shot.
    viewer?.putDown();
    gameAudio.hurt(event.damage ?? 0, event.kind === "death");
    viewer?.flinch(event.damage ?? 0);
    if (event.from && event.cause !== "fall") showDamageDirection(event.from);
  }
  if (event.kind === "death" && event.target === selfId) {
    deathCause.textContent = event.cause === "fall" ? "You fell too far" : event.cause === "struck" && event.actor === selfId ? "Something heavy hit you" : event.cause === "bleed" && event.actor === selfId ? "You bled out" : event.cause === "fire" && event.actor === selfId ? "You burned" : event.actor === selfId ? "Caught in your own blast"
      : [`By ${nameOf(event.actor)}`, CAUSE_LABEL[event.cause ?? ""] ?? "", event.zone === "head" ? "Headshot" : ""].filter(Boolean).join(" · ");
  }
}

// A new round: the market is rebuilt and everyone starts again at a spawn point.
function startRound(): void {
  viewer?.resetWorld();
  viewer?.respawn();
  viewer?.cancelReload();
  sharedProps.clear();
  playerJoined = true;
  pendingShot = 0;
  roundBannerTitle.textContent = `Round ${match?.round().number ?? ""}`;
  roundBannerDetail.textContent = `First to ${KILL_LIMIT} kills · ${ROUND_MS / 60_000} minutes`;
  replay(roundBanner);
  gameAudio.roundBell(true);
}

// Eliminations in the room, newest first, each for seven seconds.
function addToKillFeed(event: CombatEvent): void {
  const victim = event.target!;
  const line = document.createElement("li");
  line.classList.toggle("mine", event.actor === selfId || victim === selfId);
  const who = (id: string): HTMLElement => {
    const name = document.createElement("b");
    name.textContent = nameOf(id);
    name.classList.toggle("you", id === selfId);
    return name;
  };
  const how = document.createElement("span");
  if (event.cause === "fall") {
    how.textContent = "fell";
    line.append(who(victim), how);
  } else if (event.cause === "struck" && event.actor === victim) {
    how.textContent = "was flattened";
    line.append(who(victim), how);
  } else if ((event.cause === "bleed" || event.cause === "fire") && event.actor === victim) {
    how.textContent = event.cause === "fire" ? "burned" : "bled out";
    line.append(who(victim), how);
  } else if (event.actor === victim || !event.actor) {
    how.textContent = `${CAUSE_LABEL[event.cause ?? ""] ?? ""} · own blast`;
    line.append(who(victim), how);
  } else {
    how.textContent = [CAUSE_LABEL[event.cause ?? ""] ?? "", event.zone === "head" ? "headshot" : ""].filter(Boolean).join(" · ");
    line.append(who(event.actor), how, who(victim));
  }
  killFeed.prepend(line);
  while (killFeed.children.length > 5) killFeed.lastElementChild?.remove();
  window.setTimeout(() => line.classList.add("fading"), 6400);
  window.setTimeout(() => line.remove(), 7000);
}

// The round clock at the top of the screen, in a room.
function showRound(): void {
  const round = match?.round();
  roundHud.hidden = !peerRoom || !round || round.phase === "over";
  if (roundHud.hidden || !round || !match) return;
  roundHud.dataset.phase = round.phase;
  const left = round.until - roomClock();
  if (round.phase === "warmup") {
    roundClock.textContent = "Warm-up";
    roundNote.textContent = "A round starts when another player joins";
  } else if (round.phase === "countdown") {
    roundClock.textContent = clockText(left);
    roundNote.textContent = `Round ${round.number + 1} starts soon`;
  } else {
    const place = placeOf(match.players(), selfId);
    roundClock.textContent = clockText(left);
    roundNote.textContent = `Round ${round.number} · first to ${KILL_LIMIT}${place ? ` · you're ${ordinal(place)}` : ""}`;
  }
}

// The scoreboard shows while Tab is held, and on its own once a round is over.
let tabHeld = false;
let scoreboardKey = "";
function showScoreboard(): void {
  const round = match?.round();
  const open = !!match && !!round && (tabHeld || (!!peerRoom && round.phase === "over"));
  scoreboard.hidden = !open;
  if (!open || !match || !round) return;
  const left = clockText(round.until - roomClock());
  let eyebrow = "Practice", title = "Scoreboard", note = "Create a room under Play together to fight friends.";
  if (peerRoom && round.phase === "over") {
    eyebrow = `Round ${round.number}`;
    title = round.winner === selfId ? "You win the round" : round.winner ? `${nameOf(round.winner)} wins the round` : "The round is a draw";
    note = `Next round in ${left}`;
  } else if (peerRoom && round.phase === "live") {
    eyebrow = `Round ${round.number} · ${left} left`;
    note = `First to ${KILL_LIMIT} kills wins the round.`;
  } else if (peerRoom) {
    eyebrow = "Warm-up";
    note = round.phase === "countdown" ? `Round ${round.number + 1} starts in ${left}.` : "A round starts when another player joins. Scores here don't count.";
  }
  const pings = peerRoom?.pings() ?? {}, host = peerRoom?.leader() ?? selfId;
  const players = match.players();
  const rows = standings(players).map((player) => [String(placeOf(players, player.id)), nameOf(player.id), String(player.kills), String(player.deaths),
    player.id === selfId ? "—" : pings[player.id] === undefined ? "…" : `${pings[player.id]} ms`, player.id === selfId ? "you" : "", player.id === host && peerRoom ? "host" : ""]);
  const footer = `Change your name with the ${peerRoom ? "Room" : "Play together"} button at the top right.`;
  const key = JSON.stringify([eyebrow, title, note, rows, footer]);
  if (key === scoreboardKey) return;
  scoreboardKey = key;
  scoreboardFooter.textContent = footer;
  scoreboardEyebrow.textContent = eyebrow;
  scoreboardTitle.textContent = title;
  scoreboardNote.textContent = note;
  scoreboardRows.replaceChildren(...rows.map(([place, name, kills, deaths, ping, you, hostTag]) => {
    const row = document.createElement("tr");
    row.classList.toggle("you", !!you);
    const cell = (text: string): HTMLElement => Object.assign(document.createElement("td"), { textContent: text });
    const nameCell = cell(name);
    for (const tag of [you, hostTag]) if (tag) nameCell.append(Object.assign(document.createElement("em"), { textContent: tag }));
    row.append(cell(place), nameCell, cell(kills), cell(deaths), cell(ping));
    return row;
  }));
}
document.addEventListener("keydown", (event) => {
  if (!launched || event.key !== "Tab" || event.altKey || event.metaKey || dialogOpen()) return;
  event.preventDefault();
  if (tabHeld) return;
  tabHeld = true;
  showScoreboard();
});
document.addEventListener("keyup", (event) => {
  if (event.key !== "Tab") return;
  tabHeld = false;
  showScoreboard();
});
window.addEventListener("blur", () => { tabHeld = false; showScoreboard(); });

function throwGrenade(smoke = false): void {
  if (!viewer || !match || dialogOpen() || ceasefire()) return;
  const player = match.player(selfId);
  if (!player || player.health <= 0 || !viewer.weaponReady()) return;
  if ((smoke ? player.smokes : player.grenades) <= 0) { toast(smoke ? "No smoke grenades left" : "No grenades left"); return; }
  viewer.holdSprint(0.5);
  viewer.quickThrow();
  const { heading, pitch } = viewer.playerPose();
  submit({ kind: "throw", aim: { heading, pitch }, ...(smoke ? { smoke } : {}) });
}

function submit(intent: CombatIntent): void {
  if (!match || !viewer) return;
  match.setPose(selfId, viewer.playerPose());
  if (peerRoom) peerRoom.sendCombatIntent(intent);
  else match.apply(selfId, intent);
}

// The closest thing in reach to pick up, placed or dropped, with what taking it would give.
function nearestPickup(): { id: string; label: string; full: boolean; idle?: boolean } | null {
  if (!viewer || !match) return null;
  const player = match.player(selfId);
  if (!player) return null;
  const pose = viewer.playerPose(), state = match.getState(), taken = new Set(state.taken);
  const room = (gun: GunKind): boolean => player.mags[gun].length < MAX_SPARE_MAGAZINES;
  const candidates: { id: string; east: number; north: number; y: number; label: string; full: boolean; idle?: boolean }[] = [];
  for (const pickup of match.pickups) {
    if (taken.has(pickup.id)) continue;
    if (pickup.item === "extinguisher") {
      // Only when looked at, so one on the wall never gets in the way of the door beside it.
      // And never through the wall it hangs on.
      const heading = pose.heading * Math.PI / 180, dx = pickup.east - pose.east, dz = pickup.north - pose.north, far = Math.hypot(dx, dz) || 1;
      const inSight = viewer.clearShot({ origin: { x: pose.east, y: pose.jumpHeight + 1.5, z: pose.north }, direction: { x: dx / far, y: 0, z: dz / far }, distance: Math.max(0, far - 0.25) });
      if (player.powder <= 0 && state.entities[pickup.id] !== 0 && (dx * Math.sin(heading) + dz * Math.cos(heading)) / far > 0.8 && inSight) candidates.push({ ...pickup, full: false, label: "the fire extinguisher" });
      continue;
    }
    if (pickup.item === "food") {
      const food = FOOD[pickup.food], idle = food.heal > 0 && player.health >= FULL_HEALTH;
      candidates.push({ ...pickup, full: false, idle, label: idle ? `You're at full health. ${food.verb === "eat" ? "Eat" : "Drink"} when you're hurt` : `${food.verb} ${food.name} (${food.heal ? `+${food.heal} health` : `faster for ${food.rushSeconds} s`})` });
      continue;
    }
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

function attack(): void {
  if (!viewer || !match || dialogOpen() || ceasefire()) return;
  const player = match.player(selfId);
  // With both hands on something, the attack is to throw it, or to spray.
  if (viewer.holding()) { viewer.beginThrow(); return; }
  if ((player?.powder ?? 0) > 0) { if (!sprayHeld) { sprayHeld = true; sprayOnce(); } return; }
  if (!player || player.health <= 0 || !viewer.weaponReady()) return;
  const weapon = player.active;
  if (!player.owned.includes(weapon)) return;
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
  if (player.ammo[weapon] <= 0) {
    // Held triggers retry every frame; click and remind at most a few times a second.
    if (now - lastDryFire > 300) {
      lastDryFire = now;
      gameAudio.dryFire();
      toast(player.mags[weapon].length ? "Press R to reload" : "Out of ammunition: find magazines");
      if (!player.mags[weapon].length) { voices.say(selfId, "empty", now); ownMeme("empty"); }
    }
    return;
  }
  // A held trigger fires on an even beat. The timer that fires it is always a little late, and
  // counting each shot from that late moment made the carbine's 135 ms into 135 to 166 ms. So the
  // next shot counts from the moment this one was due, if that was within the last FIRE_BEAT.late.
  const due = lastLocalAttack + WEAPONS[weapon].cooldownMs;
  lastLocalAttack = now - due < FIRE_BEAT.late ? due : now;
  const { heading, pitch } = viewer.playerPose();
  submit({ kind: "attack", weapon, aim: { heading, pitch }, seen: viewer.seenTimes() });
  viewer.playAttack(weapon);
}

// What pressing E would lift: a loose prop in the crosshair, unless there is a useful pickup in
// reach, and never mid-reload or for a fallen player.
function liftTarget(): ReturnType<MapViewer["liftable"]> {
  const player = match?.player(selfId), pickup = nearestPickup();
  if (!viewer || !player || player.health <= 0 || player.reloadUntil > Date.now() || (pickup && !pickup.idle && !pickup.full)) return null;
  const prop = viewer.liftable();
  return prop && !match?.burning(prop.id) ? prop : null;
}

// E puts down what the hands hold. Otherwise it takes the nearest pickup, lifts the loose prop
// the player is looking at, or opens or closes the nearest door or hatch. Returns whether there
// was anything to interact with: E is also lean right, and a press that did something does not lean.
function interact(): boolean {
  if (viewer?.holding()) { viewer.putDown(); return true; }
  if ((match?.player(selfId)?.powder ?? 0) > 0) { submit({ kind: "stow" }); return true; }
  const pickup = nearestPickup();
  const usable = viewer?.nearestUse();
  const prop = liftTarget();
  if (pickup && !pickup.idle && !pickup.full) submit({ kind: "pickup", pickupId: pickup.id });
  else if (prop && !prop.heavy) viewer?.lift(prop.id);
  else if (pickup?.full) toast("Your magazine pouches are full");
  // Food a player does not need never gets in the way of the door beside it.
  else if (usable) submit({ kind: "use", target: usable.id });
  else if (prop) toast(`Too heavy to lift: ${prop.mass} kg. Push it instead`);
  else if (pickup?.idle) toast(pickup.label);
  else return false;
  return true;
}

// Ties a bandage round the worst of it: both hands, for a couple of seconds.
function bandage(): void {
  const player = match?.player(selfId);
  if (!viewer || !player || player.health <= 0) return;
  if (!player.leg && !player.arm && !player.bleedUntil) { toast("You have nothing to bandage"); return; }
  if (!player.bandages) { toast("No bandages left"); return; }
  if (viewer.holding() || !viewer.weaponReady() || player.reloadUntil > Date.now()) return;
  viewer.busyHands(BANDAGE_MS / 1000);
  viewer.holdSprint(BANDAGE_MS / 1000);
  toast("Tying a bandage…");
  submit({ kind: "bandage" });
}

function reload(): void {
  const player = match?.player(selfId);
  if (!player || player.health <= 0 || !player.owned.includes(player.active) || viewer?.holding() || player.powder > 0) return;
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
    soloTargets?.clear();
    soloTargets = null;
    match?.reset(selfId);
    viewer?.resetWorld();
    lastEventId = 0;
    sharedProps.clear();
    killFeed.replaceChildren();
    nameSentAt = 0;
    roomSize = 1;
    peerRoom = new PeerRoom(code, arena, {
      onPeers(count, spawnSlot) {
        if (count > roomSize) playerJoined = true;
        roomSize = count;
        openRoomButton.textContent = count === 1 ? "Room · waiting" : `Room · ${count} players`;
        viewer?.setSpawnSlot(spawnSlot);
      },
      onPose(peerId, pose, sentAt) {
        viewer?.setRemotePose(peerId, pose, sentAt);
      },
      onPeerLeave(peerId) {
        voices.memes.say(peerId, "leave", peerId);
        viewer?.removeRemotePeer(peerId);
      },
      onStatus(message) {
        roomStatus.textContent = message;
      },
      onProps(states, owner, rest, knocks) {
        viewer?.applyPropStates(states, owner, rest, selfId);
        viewer?.hearKnocks(knocks);
      },
      onPushes(pushes) {
        viewer?.applyShoves(pushes);
      },
      onMeme(peerId, code, seed) {
        voices.memes.hear(peerId, code, seed);
      },
    });
    if (match) peerRoom.attach(match);
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
  if (leaving) voices.memes.say(selfId, "leave", Date.now());
  peerRoom = null;
  viewer?.clearRemotePeers();
  viewer?.setSpawnSlot(0);
  match?.reset(selfId);
  viewer?.resetWorld();
  lastEventId = 0;
  killFeed.replaceChildren();
  nameSentAt = 0;
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
controlsDialog.addEventListener("close", afterDialog);
openRoomButton.addEventListener("click", openRoom);
closeRoomButton.addEventListener("click", () => roomDialog.close());
roomDialog.addEventListener("close", afterDialog);
pauseDialog.addEventListener("close", syncPause);
// Resume locks the mouse again: a click on the button is the gesture the browser asks for.
pauseResumeButton.addEventListener("click", () => {
  pauseDialog.close();
  if (mouseLookOffered) { viewer?.lockPointer(); fillScreen(); }
});
pauseSettingsButton.addEventListener("click", () => fromPause(() => { settingsDialog.showModal(); syncPause(); }));
pauseControlsButton.addEventListener("click", () => fromPause(openControls));
pauseInviteButton.addEventListener("click", () => fromPause(openRoom));
pauseLeaveButton.addEventListener("click", () => {
  // Out of a room, the game is solo again. Out of a solo game, the setup screen starts a new one.
  if (peerRoom) { pauseDialog.close(); void leaveRoom().then(() => toast("You left the room · solo practice")); }
  else window.location.assign(window.location.pathname);
});
closeSettingsButton.addEventListener("click", () => settingsDialog.close());
settingsDialog.addEventListener("close", afterDialog);
settingSound.addEventListener("change", () => gameAudio.setMuted(!settingSound.checked));
// The input settings: each slider shows its value, and a change applies and is saved at once.
const inputSliders: { key: "sensitivity" | "aimSensitivity" | "fov"; slider: HTMLInputElement; value: HTMLElement; show: (value: number) => string }[] = [
  { key: "sensitivity", slider: element<HTMLInputElement>("setting-sensitivity"), value: element<HTMLElement>("setting-sensitivity-value"), show: (value) => value.toFixed(2) },
  { key: "aimSensitivity", slider: element<HTMLInputElement>("setting-aim"), value: element<HTMLElement>("setting-aim-value"), show: (value) => value.toFixed(2) },
  { key: "fov", slider: element<HTMLInputElement>("setting-fov"), value: element<HTMLElement>("setting-fov-value"), show: (value) => `${Math.round(value)}°` },
];
for (const { key, slider, value, show } of inputSliders) {
  const range = INPUT_RANGE[key];
  slider.min = String(range.min); slider.max = String(range.max); slider.step = String(range.step);
  slider.value = String(INPUT[key]);
  value.textContent = show(INPUT[key]);
  slider.addEventListener("input", () => { setInput({ [key]: Number(slider.value) }); value.textContent = show(INPUT[key]); });
}
const settingInvert = element<HTMLInputElement>("setting-invert");
settingInvert.checked = INPUT.invertY;
settingInvert.addEventListener("change", () => setInput({ invertY: settingInvert.checked }));
settingSetupButton.addEventListener("click", () => window.location.assign(window.location.pathname + window.location.search));
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
  if (!launched || gameKey(event) !== "h" || event.repeat || event.altKey || event.metaKey || roomDialog.open) return;
  event.preventDefault();
  if (controlsDialog.open) closeControls();
  else openControls();
});

// Ctrl is the crouch key, so the action keys work with it held: a crouched player can reload,
// throw and switch weapons. Keys are read by their place on the keyboard (keys.ts).
document.addEventListener("keydown", (event) => {
  if (!launched || event.repeat || event.altKey || event.metaKey || dialogOpen() || document.activeElement instanceof HTMLInputElement) return;
  const key = gameKey(event);
  if (!["f", "e", "g", "t", "b", "1", "2", "r", "m", "enter", " "].includes(key)) return;
  // Space respawns a fallen player; otherwise it is the jump, which the controller reads.
  if (key === " " && (match?.player(selfId)?.health ?? 1) > 0) return;
  event.preventDefault();
  if (key === "m") {
    gameAudio.setMuted(!gameAudio.isMuted());
    toast(gameAudio.isMuted() ? "Sound off · press M to turn it back on" : "Sound on");
  } else if (key === "f") attack();
  else if (key === "g") throwGrenade();
  else if (key === "t") throwGrenade(true);
  else if (key === "b") bandage();
  else if (key === "e") { if (interact()) viewer?.skipLean(); }
  else if (key === "r") reload();
  else if (key === "enter" || key === " ") submit({ kind: "respawn" });
  else {
    // Reaching for a weapon lets go of whatever the hands hold.
    viewer?.putDown();
    if ((match?.player(selfId)?.powder ?? 0) > 0) submit({ kind: "stow" });
    const weapon: WeaponKind = key === "1" ? "pistol" : "rifle";
    submit({ kind: "select", weapon });
  }
});
document.addEventListener("keyup", (event) => { if (gameKey(event) === "f") { viewer?.releaseThrow(); sprayHeld = false; } });

// While the trigger is held, the extinguisher in hand keeps spraying.
function sprayOnce(): void {
  const player = match?.player(selfId);
  if (!viewer || !player || player.powder <= 0 || player.health <= 0 || dialogOpen()) { sprayHeld = false; return; }
  const { heading, pitch } = viewer.playerPose();
  submit({ kind: "spray", aim: { heading, pitch } });
}
window.setInterval(() => { if (sprayHeld) sprayOnce(); }, SPRAY_MS);

// Each loose prop is simulated by the peer that first touched it, which shares it 15 times a
// second while it moves and once more where it comes to rest. Every two seconds the coordinating
// peer also shares the displaced props that have changed since it last did, and every displaced
// prop after a player joins.
let propTick = 0, playerJoined = false, roomSize = 1;
const sharedProps = new Map<string, string>();
window.setInterval(() => {
  if (!viewer) return;
  const leading = !peerRoom || peerRoom.leading();
  const { moving, settled } = viewer.propTraffic(leading);
  const shoves = viewer.takeShoves(), knocks = viewer.takeKnocks();
  viewer.hearKnocks(knocks);
  for (const { prop, target, speed, zone, thrown } of viewer.takeStrikes()) submit({ kind: "struck", prop, target: target || selfId, speed, zone, thrown });
  for (const [prop, speed] of viewer.takeSmashes()) submit({ kind: "smash", prop, speed });
  if (!peerRoom) return;
  for (const [owner, pushes] of shoves) peerRoom.sendPushes(owner, pushes);
  peerRoom.sendProps(moving, false, knocks);
  peerRoom.sendProps(settled, true);
  for (const state of settled) sharedProps.set(state[0], state.join());
  propTick += 1;
  if (!leading || propTick % 30 !== 0) return;
  const everything = playerJoined;
  playerJoined = false;
  peerRoom.sendProps(viewer.displacedProps().filter((state) => {
    const text = state.join();
    if (!everything && sharedProps.get(state[0]) === text) return false;
    sharedProps.set(state[0], text);
    return true;
  }), true);
}, 66);

window.setInterval(() => {
  if (!viewer || !match) return;
  const pose = viewer.playerPose();
  match.setPose(selfId, pose);
  peerRoom?.sendPose(pose);
  // A solo game has practice targets to shoot at; a room has real players.
  // They stand still while a solo game is paused, so nothing shoots a player who is in a menu.
  if (!peerRoom && launched && !soloPaused()) (soloTargets ??= new SoloTargets(match, viewer, selfId)).update();
  if (launched && (match.player(selfId)?.health ?? 0) > 0) movementMemes(pose);
}, 33);

// Memes for this player's own movement, rolled here and sent to the room: a jump, a sprint
// held for 4 s, and crouching up and down three times near where someone just died. A hard
// landing is reported by the viewer.
const SPRINT_MEME_MS = 4000;
let sprintSince = 0, sprintSaid = false, wasAirborne = true, wasCrouching = false;
const crouches: number[] = [];
const graves: { x: number; z: number; at: number }[] = [];
function ownMeme(moment: MemeMoment): void {
  const chosen = voices.memes.own(moment);
  if (chosen) peerRoom?.sendMeme(chosen.code, chosen.seed);
}
function movementMemes(pose: ReturnType<MapViewer["playerPose"]>): void {
  const now = performance.now();
  if (pose.airborne && !wasAirborne && pose.jumpHeight > 0.05) ownMeme("jump");
  wasAirborne = pose.airborne ?? false;
  if (pose.running && pose.moving) {
    sprintSince ||= now;
    if (!sprintSaid && now - sprintSince > SPRINT_MEME_MS) { sprintSaid = true; ownMeme("sprint"); }
  } else { sprintSince = 0; sprintSaid = false; }
  if (pose.crouching && !wasCrouching) {
    crouches.push(now);
    while (crouches.length && now - crouches[0] > 2500) crouches.shift();
    while (graves.length && now - graves[0].at > 30_000) graves.shift();
    if (crouches.length >= 3 && graves.some((grave) => Math.hypot(grave.x - pose.east, grave.z - pose.north) < 3)) { crouches.length = 0; ownMeme("teabag"); }
  }
  wasCrouching = pose.crouching ?? false;
}

window.setInterval(() => {
  if (!viewer || !match) return;
  if (peerRoom) peerRoom.tickCombat();
  else match.tick();
  const pickup = nearestPickup(), held = viewer.holding(), tool = (match.player(selfId)?.powder ?? 0) > 0;
  const prop = held || tool ? null : liftTarget(), lift = prop && !prop.heavy ? prop : null;
  const usable = lift || (pickup && !pickup.idle) ? null : viewer.nearestUse();
  pickupHint.hidden = (!held && !tool && !pickup && !lift && !usable) || (match.player(selfId)?.health ?? 0) <= 0;
  if (held) pickupHint.textContent = "Click to throw, hold to throw harder · E to put it down";
  else if (tool) pickupHint.textContent = "Hold click to spray · E to put it back";
  else if (lift && (!pickup || pickup.idle || pickup.full)) pickupHint.textContent = `Press E to lift ${lift.label} (${lift.mass} kg)`;
  else if (pickup && !(pickup.idle && usable)) pickupHint.textContent = pickup.idle ? pickup.label : pickup.full ? `Your magazine pouches are full` : `Press E to ${pickup.id.startsWith("food-") ? "" : "take "}${pickup.label}`;
  else if (usable) pickupHint.textContent = `Press E to ${usable.verb} ${usable.label}`;
  const player = match.player(selfId);
  if (player && (held?.mass ?? 0) !== shownHeld) { shownHeld = held?.mass ?? 0; showAmmo(player); }
  // Others can see a bleeding player leaving blood behind.
  if (performance.now() - lastDrip > BLEED_DRIP_MS) {
    lastDrip = performance.now();
    for (const [peerId, other] of Object.entries(match.players())) if (peerId !== selfId && other.bleedUntil && other.health > 0) viewer.dripBlood(peerId);
  }
  if (player?.health === 0) {
    const seconds = Math.max(0, Math.ceil((player.respawnAfter - roomClock()) / 1000));
    // Enter, Space or a click respawns; the game does it by itself 5 s after the fall.
    const automatic = Math.max(0, Math.ceil((player.respawnAfter - RESPAWN.waitMs + RESPAWN.autoMs - roomClock()) / 1000));
    respawnHint.textContent = seconds > 0 ? `Respawn in ${seconds}…` : `Click or press Space to respawn · back in ${automatic} s`;
    if (seconds <= 0 && automatic <= 0 && Date.now() - respawnAskedAt > 1000) { respawnAskedAt = Date.now(); submit({ kind: "respawn" }); }
  }
  // The coordinator keeps everyone's name and voice; this player's go again until they show there.
  if (player && (player.name !== playerName || player.voice !== voiceChoice) && Date.now() - nameSentAt > 1500) {
    nameSentAt = Date.now();
    submit({ kind: "profile", name: playerName, voice: voiceChoice });
  }
  showRound();
  showScoreboard();
  const langs = [...new Set(Object.values(match.players()).map((other) => other.voice))].sort().join();
  if (launched && langs !== heardLangs) { heardLangs = langs; void loadVoices(); }
}, 100);
let heardLangs = "", shownHeld = 0, lastDrip = 0;
// Mobile browsers often skip beforeunload when a page goes away; pagehide comes in either case.
for (const event of ["beforeunload", "pagehide"]) window.addEventListener(event, () => { void peerRoom?.leave(); });

// Starts the match chosen on the setup screen: joins or creates its room (the connection is
// made while the world builds), loads the sounds chosen and builds the world, reporting each
// step to the loading screen. Resolves once the loading screen has gone.
export async function launch(chosen: Settings, loading: Loading): Promise<void> {
  settings = chosen;
  playerName = chosen.name;
  language = chosen.language;
  lines = chosen.lines;
  voiceChoice = voiceOf(chosen);
  voices.adult = voices.memes.adult = chosen.adult;
  voices.memes.on = chosen.memes;
  playerNameInput.value = playerName;
  voiceLanguageInput.value = language;
  voiceLinesInput.checked = lines;
  adultVoiceInput.checked = chosen.adult;
  memeSoundsInput.checked = chosen.memes;
  gameAudio.setRaining(chosen.time === "dusk");
  element("map").setAttribute("aria-label", `First-person view of the ${mapById(chosen.map).name}`);
  if (chosen.mode === "room") enterRoom(chosen.room === "join" ? chosen.code : newRoomCode());
  // Three.js loaders read the files downloaded during setup.
  DefaultLoadingManager.setURLModifier(assetUrl);

  loading.begin("sounds");
  await gameAudio.loadBank();
  const wanted = wantedClips().filter((path) => !loadedVoices.has(path));
  let loadedClips = 0;
  await loadVoices(() => { loadedClips += 1; loading.progress("sounds", loadedClips / Math.max(1, wanted.length)); });
  loading.done("sounds");

  try {
    await buildWorld(loading);
  } catch {
    loading.fail("The world could not load. Check browser WebGPU or WebGL 2 support, then reload.");
    performanceLabel.textContent = "Graphics unavailable";
    return;
  }
  await loading.finish();
  launched = true;
  syncPause();
  if (peerRoom && chosen.room === "create") toast(`Room ${peerRoom.code} is open · press Room to copy the invite link`);
  if (!peerRoom) toast("Practice · eight targets are in the market · they shoot back once you move");
  // Files a model loads late can still use the downloads for a while; then they are freed.
  window.setTimeout(releaseAssets, 15_000);
}

const STEP_OF: Record<string, StepId> = { textures: "world", buildings: "world", props: "props", renderer: "renderer", physics: "physics", shaders: "shaders" };

// The graphics preset for this match, and the frame rates Auto watches to choose the next one.
let qualityLevel: QualityLevel = "high";
let qualityPixels = 0;
const qualityWatch = { skip: 20, samples: [] as number[], done: false };
const QUALITY_SAMPLES = 30;

// Auto moves one preset down for the next match when a match runs slowly: after the first ten
// seconds of play (shader builds), fifteen seconds of frame rate under FPS_FLOOR.
function watchQuality(fps: number): void {
  if (settings?.graphics !== "auto" || qualityWatch.done || !launched || document.hidden || dialogOpen()) return;
  if (qualityWatch.skip > 0) { qualityWatch.skip -= 1; return; }
  qualityWatch.samples.push(fps);
  if (qualityWatch.samples.length < QUALITY_SAMPLES) return;
  qualityWatch.done = true;
  const mean = qualityWatch.samples.reduce((sum, value) => sum + value, 0) / qualityWatch.samples.length;
  const next = mean < FPS_FLOOR ? cheaper(qualityLevel) : null;
  if (!next) return;
  saveMeasuredQuality(next, qualityPixels);
  toast(`Low frame rate: graphics will use ${QUALITY_LABEL[next]} from the next match. Change it on the setup screen`);
}

function buildWorld(loading: Loading): Promise<MapViewer> {
  const map = element("map");
  qualityPixels = drawnPixels(map.clientWidth || window.innerWidth, map.clientHeight || window.innerHeight, window.devicePixelRatio);
  qualityLevel = pickQuality(settings?.graphics ?? "auto", measuredQuality(qualityPixels), qualityPixels);
  let ready: (viewer: MapViewer) => void = () => undefined, failed: (error: unknown) => void = () => undefined;
  const done = new Promise<MapViewer>((resolve, reject) => { ready = resolve; failed = reject; });
  // The first frames can come before the viewer is handed over, or after.
  let shown = false;
  void createMapViewer(element("map"), arena, {
    onStatus(state) {
      if (state === "ready") { shown = true; if (viewer) ready(viewer); }
      if (state === "error") failed(new Error("render"));
    },
    onStep(step) { loading.begin(STEP_OF[step] ?? "world"); },
    onStepProgress(step, fraction) { loading.progress(STEP_OF[step] ?? "world", fraction); },
    onHardLanding(speed) { submit({ kind: "fall", speed }); ownMeme("hardLanding"); },
    // The crosshair's gap follows the spread, and it fades out as the sights come up: down the
    // sights the gun's own sights mark the aim.
    onAim(spreadPixels, aim) {
      crosshair?.style.setProperty("--gap", `${Math.max(3, spreadPixels).toFixed(1)}px`);
      if (crosshair) crosshair.style.opacity = (1 - aim).toFixed(2);
    },
    onMetrics(metrics) {
      performanceLabel.textContent = `${metrics.renderer} · ${QUALITY_LABEL[qualityLevel]} · ${metrics.fps} FPS`;
      watchQuality(metrics.fps);
      performanceLabel.title = `${metrics.drawCalls} draw calls · ${metrics.triangles.toLocaleString()} triangles · ${metrics.pixelRatio.toFixed(2)}× resolution`;
    },
  }, QUALITY[qualityLevel], settings?.time ?? "dusk").then((created) => {
    viewer = created;
    syncPause();
    match = new MatchState(created.arenaData(), onMatchChange, created.combatWorld());
    match.reset(selfId);
    const canvas = element("map").querySelector("canvas");
    if (canvas) {
      let pointerDown: { x: number; y: number; time: number } | null = null;
      // The right button aims down the sights while held.
      canvas.addEventListener("contextmenu", (event) => event.preventDefault());
      const press = (event: PointerEvent): void => {
        if (!launched) return;
        if (event.button === 2) { viewer?.setAiming(true); return; }
        if (event.button !== 0) return;
        // A fallen player's click respawns them.
        if ((match?.player(selfId)?.health ?? 1) <= 0) { submit({ kind: "respawn" }); return; }
        if (document.pointerLockElement === canvas) { triggerHeld = true; attack(); }
        else pointerDown = { x: event.clientX, y: event.clientY, time: performance.now() };
      };
      const release = (event: PointerEvent): void => {
        if (event.button === 0) { triggerHeld = false; sprayHeld = false; viewer?.releaseThrow(); }
        else if (event.button === 2) viewer?.setAiming(false);
      };
      canvas.addEventListener("pointerdown", press);
      // Browsers send pointerdown only for the first mouse button held and pointerup only for
      // the last let go; a button pressed or released while another is held, such as firing
      // while aiming, comes as a pointermove naming that button.
      const BUTTON_BIT = [1, 4, 2];
      canvas.addEventListener("pointermove", (event) => {
        if (event.button < 0 || event.button > 2) return;
        if (event.buttons & BUTTON_BIT[event.button]) press(event);
        else release(event);
      });
      canvas.addEventListener("pointerup", (event) => {
        if (!pointerDown || document.pointerLockElement === canvas) return;
        // With the mouse free, a click that does not drag locks it for mouse look, however long
        // it is held, and fills the screen again; a quick tap on a touch screen attacks.
        const still = Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) < 7;
        if (still && event.pointerType === "mouse") { viewer?.lockPointer(); fillScreen(); }
        else if (still && performance.now() - pointerDown.time < 350) { attack(); viewer?.releaseThrow(); }
        pointerDown = null;
      });
      canvas.addEventListener("pointercancel", () => { pointerDown = null; });
    }
    peerRoom?.attach(match);
    if (shown) ready(created);
  }).catch(failed);
  return done;
}
