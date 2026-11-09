import { MARKET_ARENA } from "./world/nightMarket";
import { createMapViewer, type MapViewer } from "./world/mapViewer";
import { newRoomCode, normalizeRoomCode, PeerRoom } from "./network/peerRoom";
import { selfId } from "trystero";
import { carriedMass, EAT_MS, FOOD, FULL_HEALTH, KNIFE, MAGAZINE_LABEL, MAGAZINES_PER_PICKUP, MAX_SPARE_MAGAZINES, PICKUP_HEIGHT, PICKUP_REACH, WEAPONS, type GunKind, type KnifeStroke, type WeaponKind } from "./game/combatRules";
import { standings, KILL_LIMIT, MatchState, ROUND_MS, type CombatEvent, type CombatIntent, type CombatPlayer, type CombatSnapshot } from "./game/matchState";
import { gameAudio } from "./game/gameAudio";
import { PlayerVoices } from "./game/playerVoices";
import { Memes, type MemeMoment } from "./game/memes";
import { cleanName, LANGUAGES, saveSettings, VOICE_CHOICES, voiceOf, type Language, type Settings, type VoiceChoice } from "./settings";
import { type Loading, type StepId } from "./loading";
import { assetUrl, releaseAssets } from "./assetStore";
import { mapById } from "./maps";
import { DefaultLoadingManager } from "three/webgpu";
import { fillScreen } from "./mouseLock";

// The game: the world, the match and everything on screen during play. main.ts loads this
// module while the player sets up a match, and calls launch() on Deploy; until then nothing
// here runs but wiring.

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
const CAUSE_LABEL: Record<string, string> = { knife: WEAPONS.knife.label, pistol: WEAPONS.pistol.label, rifle: WEAPONS.rifle.label, grenade: "Frag grenade", fall: "Fall" };
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
// Letting go of every button ends firing and aiming, whichever came up last.
window.addEventListener("pointerup", (event) => { if (event.buttons === 0) { triggerHeld = false; viewer?.setAiming(false); } });
window.addEventListener("blur", () => { triggerHeld = false; viewer?.setAiming(false); });
document.addEventListener("pointerlockchange", () => { triggerHeld = false; });
window.setInterval(() => {
  if (triggerHeld && document.pointerLockElement && match?.player(selfId)?.active === "rifle") attack();
}, 16);
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

const dialogOpen = (): boolean => controlsDialog.open || roomDialog.open;

function openControls(): void {
  if (dialogOpen()) return;
  controlsDialog.showModal();
  syncPause();
}

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
}
// Touch screens cannot lock a pointer, so they get no hint.
const mouseLookOffered = matchMedia("(pointer: fine)").matches;
document.addEventListener("pointerlockchange", () => syncPause());

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
  const details = [nameOf(event.target!), event.zone === "head" ? "Headshot" : "", CAUSE_LABEL[event.cause ?? ""] ?? "", distance >= 0.5 ? `${Math.max(1, Math.round(distance))} m` : ""];
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
  loadCount.parentElement?.classList.toggle("heavy", mass > 7);
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
  if (event.kind === "pickup" && event.actor === selfId && event.food) {
    const food = FOOD[event.food];
    viewer?.busyHands(EAT_MS / 1000);
    if (food.rushSeconds) viewer?.startRush(food.rushSeconds);
    toast(food.rushSeconds ? `Sugar rush: faster for ${food.rushSeconds} s` : `+${food.heal} health`);
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
  if (event.kind === "death" && event.target === selfId) {
    deathCause.textContent = event.cause === "fall" ? "You fell too far" : event.actor === selfId ? "Caught in your own blast"
      : [`By ${nameOf(event.actor)}`, CAUSE_LABEL[event.cause ?? ""] ?? "", event.zone === "head" ? "Headshot" : "", event.behind ? "From behind" : ""].filter(Boolean).join(" · ");
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
  } else if (event.actor === victim || !event.actor) {
    how.textContent = `${CAUSE_LABEL[event.cause ?? ""] ?? ""} · own blast`;
    line.append(who(victim), how);
  } else {
    how.textContent = [CAUSE_LABEL[event.cause ?? ""] ?? "", event.zone === "head" ? "headshot" : "", event.behind ? "from behind" : ""].filter(Boolean).join(" · ");
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
  if (!launched || event.key !== "Tab" || event.altKey || event.metaKey || event.ctrlKey || dialogOpen()) return;
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

function attack(stroke: KnifeStroke = "slash"): void {
  if (!viewer || !match || dialogOpen() || ceasefire()) return;
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
    if (now - lastDryFire > 300) {
      lastDryFire = now;
      gameAudio.dryFire();
      toast(player.mags[weapon].length ? "Press R to reload" : "Out of ammunition: find magazines");
      if (!player.mags[weapon].length) { voices.say(selfId, "empty", now); ownMeme("empty"); }
    }
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
  const usable = viewer?.nearestUse();
  // Food a player does not need never gets in the way of the door beside it.
  if (pickup?.idle && usable) submit({ kind: "use", target: usable.id });
  else if (pickup?.idle) toast(pickup.label);
  else if (pickup?.full) toast("Your magazine pouches are full");
  else if (pickup) submit({ kind: "pickup", pickupId: pickup.id });
  else if (usable) submit({ kind: "use", target: usable.id });
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
      onProps(states) {
        viewer?.applyPropStates(states);
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
  viewer?.setAuthority(true);
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
  if (!launched || event.key.toLowerCase() !== "h" || event.repeat || event.altKey || event.metaKey || event.ctrlKey || roomDialog.open) return;
  event.preventDefault();
  if (controlsDialog.open) closeControls();
  else openControls();
});

document.addEventListener("keydown", (event) => {
  if (!launched || event.repeat || event.altKey || event.metaKey || event.ctrlKey || dialogOpen() || document.activeElement instanceof HTMLInputElement) return;
  const key = event.key.toLowerCase();
  if (!["f", "v", "e", "g", "t", "1", "2", "3", "r", "m", "enter"].includes(key)) return;
  event.preventDefault();
  if (key === "m") {
    gameAudio.setMuted(!gameAudio.isMuted());
    toast(gameAudio.isMuted() ? "Sound off · press M to turn it back on" : "Sound on");
  } else if (key === "f") attack();
  else if (key === "v") attack("stab");
  else if (key === "g") throwGrenade();
  else if (key === "t") throwGrenade(true);
  else if (key === "e") interact();
  else if (key === "r") reload();
  else if (key === "enter") submit({ kind: "respawn" });
  else {
    const weapon: WeaponKind = key === "1" ? "knife" : key === "2" ? "pistol" : "rifle";
    submit({ kind: "select", weapon });
  }
});

// The coordinating peer simulates loose props and shares moving ones 15 times a second. Every
// two seconds it also shares the displaced props that have changed since it last did, so each
// comes to rest in the same place everywhere, and every displaced prop after a player joins.
let propTick = 0, playerJoined = false, roomSize = 1;
const sharedProps = new Map<string, string>();
window.setInterval(() => {
  if (!viewer) return;
  const leading = !peerRoom || peerRoom.leading();
  viewer.setAuthority(leading);
  // Props this player walked into go to the peer that simulates them.
  const shoves = viewer.takeShoves();
  if (peerRoom && !leading) peerRoom.sendPushes(shoves);
  if (!peerRoom || !leading) return;
  propTick += 1;
  const refresh = propTick % 30 === 0;
  let states = viewer.propStates(refresh);
  if (refresh) {
    const everything = playerJoined;
    playerJoined = false;
    states = states.filter((state) => {
      const text = state.join();
      if (!everything && sharedProps.get(state[0]) === text) return false;
      sharedProps.set(state[0], text);
      return true;
    });
  }
  peerRoom.sendProps(states);
}, 66);

window.setInterval(() => {
  if (!viewer || !match) return;
  const pose = viewer.playerPose();
  match.setPose(selfId, pose);
  peerRoom?.sendPose(pose);
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
  const pickup = nearestPickup();
  const usable = pickup && !pickup.idle ? null : viewer.nearestUse();
  pickupHint.hidden = (!pickup && !usable) || (match.player(selfId)?.health ?? 0) <= 0;
  if (pickup && !(pickup.idle && usable)) pickupHint.textContent = pickup.idle ? pickup.label : pickup.full ? `Your magazine pouches are full` : `Press E to ${pickup.id.startsWith("food-") ? "" : "take "}${pickup.label}`;
  else if (usable) pickupHint.textContent = `Press E to ${usable.open ? "close" : "open"} ${usable.label}`;
  const player = match.player(selfId);
  if (player?.health === 0) {
    const seconds = Math.max(0, Math.ceil((player.respawnAfter - roomClock()) / 1000));
    respawnHint.textContent = seconds > 0 ? `Respawn in ${seconds}…` : "Press Enter to respawn";
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
let heardLangs = "";
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
  // Files a model loads late can still use the downloads for a while; then they are freed.
  window.setTimeout(releaseAssets, 15_000);
}

const STEP_OF: Record<string, StepId> = { textures: "world", buildings: "world", props: "props", renderer: "renderer", physics: "physics", shaders: "shaders" };

function buildWorld(loading: Loading): Promise<MapViewer> {
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
    // The crosshair stays the same down the sights; its gap follows the spread.
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
    syncPause();
    match = new MatchState(created.arenaData(), onMatchChange, created.combatWorld());
    match.reset(selfId);
    const canvas = element("map").querySelector("canvas");
    if (canvas) {
      let pointerDown: { x: number; y: number; time: number } | null = null;
      // The right button stabs with the knife, and with a gun aims down its sights while held.
      canvas.addEventListener("contextmenu", (event) => event.preventDefault());
      const press = (event: PointerEvent): void => {
        if (!launched) return;
        if (event.button === 2) {
          if (match?.player(selfId)?.active === "knife") attack("stab");
          else viewer?.setAiming(true);
          return;
        }
        if (event.button !== 0) return;
        if (document.pointerLockElement === canvas) { triggerHeld = true; attack(); }
        else pointerDown = { x: event.clientX, y: event.clientY, time: performance.now() };
      };
      const release = (event: PointerEvent): void => {
        if (event.button === 0) triggerHeld = false;
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
        else if (still && performance.now() - pointerDown.time < 350) attack();
        pointerDown = null;
      });
      canvas.addEventListener("pointercancel", () => { pointerDown = null; });
    }
    peerRoom?.attach(match);
    if (shown) ready(created);
  }).catch(failed);
  return done;
}
