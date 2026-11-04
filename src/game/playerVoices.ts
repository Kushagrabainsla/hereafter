import catalog from "./voiceLines.json";
import { gameAudio, type Vec3 } from "./gameAudio";
import { type CombatEvent, type CombatPlayer, type LiveGrenade } from "./matchState";

// Players' voices: lines spoken at moments of the match, in the language each player chose,
// and the wordless efforts of jumping, climbing, getting hurt and dying (gameAudio.effort).
// Lines come from src/game/voiceLines.json and are built into public/audio/voice by
// scripts/audio/voices.py. Every peer decides from the same combat events, and picks by a
// hash of the event, so everyone hears the same player say the same line; only a listener
// who has turned the 18+ lines off hears a clean line in place of an 18+ one.

export type VoiceChoice = "hi" | "en" | "grunts";
export const VOICE_CHOICES: VoiceChoice[] = ["hi", "en", "grunts"];
export type VoiceMoment = "roundStart" | "roundWin" | "roundLose" | "reload" | "empty" | "grenade" | "smoke" | "grenadeNear" | "nearMiss" | "hurt" | "lowHealth" | "death" | "kill" | "headshot" | "knifeKill" | "doubleKill" | "revenge" | "respawn";
interface Line { id: string; moment: string; tier: "clean" | "spicy" | "adult"; hi: string; hiLatin: string; en: string }

const LINES = catalog.lines as Line[];
// A player waits this long after one line before the next, so no one chatters.
const LINE_GAP_MS = 2500;
// A second kill this soon after the last is a double kill.
const DOUBLE_KILL_MS = 4000;
// Below this health a hit draws the low-health line, once a life.
const LOW_HEALTH = 25;

// FNV-1a: the same small number on every peer for the same text.
function hash(text: string): number {
  let value = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) value = Math.imul(value ^ text.charCodeAt(i), 0x01000193);
  return value >>> 0;
}

export class PlayerVoices {
  // Whether this listener hears 18+ lines; off, they hear a clean line instead.
  adult = false;
  private quietUntil = new Map<string, number>();
  private lastKill = new Map<string, number>();
  private killedBy = new Map<string, string>();
  private lowSaid = new Set<string>();

  constructor(private selfId: string, private voiceOf: (id: string) => VoiceChoice, private headOf: (id: string) => Vec3 | null) {}

  // Every clip a match can play, for loading after the world.
  static clips(): string[] {
    const efforts = Object.entries(catalog.efforts).flatMap(([kind, count]) => Array.from({ length: count }, (_, index) => `effort/${kind}-${index + 1}`));
    return [...efforts, ...LINES.flatMap((line) => [`en/${line.id}`, `hi/${line.id}`])];
  }

  // A line for a moment, with a chance of saying anything at all; seed makes the choice the
  // same on every peer. The speaker's own voice plays close and unplaced; others' from where they are.
  say(speaker: string, moment: VoiceMoment, seed: number | string, chance = 1, delayMs = 0): void {
    const voice = this.voiceOf(speaker);
    if (voice === "grunts") return;
    const roll = hash(`${seed}:${speaker}:${moment}`);
    if ((roll % 1000) / 1000 >= chance) return;
    const now = performance.now();
    if (now < (this.quietUntil.get(speaker) ?? 0)) return;
    // Every listener picks from all the lines, so all hear the same one; a listener with 18+ lines
    // off hears a clean one in place of an 18+ pick.
    const choices = LINES.filter((line) => line.moment === moment), clean = choices.filter((line) => line.tier !== "adult");
    if (!clean.length) return;
    let line = choices[(roll >>> 10) % choices.length];
    if (line.tier === "adult" && !this.adult) line = clean[(roll >>> 20) % clean.length];
    this.quietUntil.set(speaker, now + delayMs + LINE_GAP_MS);
    window.setTimeout(() => {
      const length = gameAudio.voice(`${voice}/${line.id}`, speaker === this.selfId ? null : this.headOf(speaker), true);
      if (length) this.quietUntil.set(speaker, performance.now() + length * 1000 + LINE_GAP_MS);
    }, delayMs);
  }

  effort(speaker: string, kind: "jump" | "climb" | "pain" | "death", delayMs = 0): void {
    window.setTimeout(() => gameAudio.effort(kind, speaker === this.selfId ? null : this.headOf(speaker)), delayMs);
  }

  // What the players say about the newest events, read as one batch so a near miss can tell
  // whether the round actually hit.
  events(fresh: CombatEvent[], players: Readonly<Record<string, CombatPlayer>>, grenades: LiveGrenade[]): void {
    for (const event of fresh) {
      const actor = event.actor, target = event.target;
      if (event.kind === "throw") {
        this.say(actor, event.smoke ? "smoke" : "grenade", event.id, 0.85);
        const rest = !event.smoke ? grenades.find((grenade) => grenade.id === event.grenade)?.position : undefined;
        // The player nearest where a frag will land, within 6 m, shouts to run.
        if (rest) {
          const near = Object.keys(players).filter((id) => id !== actor && (players[id]?.health ?? 0) > 0).map((id) => ({ id, at: this.headOf(id) }))
            .map(({ id, at }) => ({ id, distance: at ? Math.hypot(at.x - rest.x, at.z - rest.z) : Infinity })).sort((a, b) => a.distance - b.distance)[0];
          if (near && near.distance < 6) this.say(near.id, "grenadeNear", event.id, 0.9, 500);
        }
      } else if (event.kind === "reload") this.say(actor, "reload", event.id, 0.35);
      else if (event.kind === "hit" && target) {
        this.effort(target, "pain");
        const health = players[target]?.health ?? 100;
        if (health > 0 && health <= LOW_HEALTH && !this.lowSaid.has(target)) { this.lowSaid.add(target); this.say(target, "lowHealth", event.id, 0.8, 400); }
        else this.say(target, "hurt", event.id, 0.15, 300);
      } else if (event.kind === "death" && target) {
        this.effort(target, "death");
        this.lowSaid.delete(target);
        this.quietUntil.delete(target);
        this.say(target, "death", event.id, 0.3, 1300);
        if (actor && actor !== target && event.cause !== "fall") this.killLine(event, actor, target);
      } else if (event.kind === "respawn") {
        this.lowSaid.delete(actor);
        this.say(actor, "respawn", event.id, 0.4, 700);
      } else if (event.kind === "round") {
        this.lowSaid.clear();
        for (const id of Object.keys(players)) this.say(id, "roundStart", event.id, 0.5, 400 + hash(`${event.id}:${id}`) % 1400);
      } else if (event.kind === "shot" && event.shot && event.weapon !== "knife") this.nearMiss(event, fresh, players);
    }
  }

  // The round's winner crows; some of the rest grumble.
  roundOver(winner: string, players: string[], seed: number): void {
    if (winner) this.say(winner, "roundWin", seed, 1, 600);
    for (const id of players) if (id !== winner) this.say(id, "roundLose", seed, 0.35, 1200 + hash(`${seed}:${id}`) % 1500);
  }

  // A double kill, a revenge kill, a knife or a headshot gets its own line; others sometimes one.
  private killLine(event: CombatEvent, killer: string, victim: string): void {
    const now = performance.now(), previous = this.lastKill.get(killer);
    this.lastKill.set(killer, now);
    const revenge = this.killedBy.get(killer) === victim;
    this.killedBy.set(victim, killer);
    this.killedBy.delete(killer);
    const moment: VoiceMoment = previous !== undefined && now - previous < DOUBLE_KILL_MS ? "doubleKill" : revenge ? "revenge"
      : event.cause === "knife" ? "knifeKill" : event.zone === "head" ? "headshot" : "kill";
    // A killer's own pending line gives way to this one.
    this.quietUntil.delete(killer);
    this.say(killer, moment, event.id, moment === "kill" ? 0.6 : 0.95, 450);
  }

  // A player a round passes within 1.5 m of, who was not hit by it, may react.
  private nearMiss(event: CombatEvent, fresh: CombatEvent[], players: Readonly<Record<string, CombatPlayer>>): void {
    const shot = event.shot!, origin = shot.origin, direction = shot.direction;
    const hit = new Set(fresh.filter((other) => (other.kind === "hit" || other.kind === "death") && other.actor === event.actor && other.id > event.id && other.id <= event.id + 12).map((other) => other.target));
    for (const id of Object.keys(players)) {
      if (id === event.actor || hit.has(id) || (players[id]?.health ?? 0) <= 0) continue;
      const head = id === this.selfId ? gameAudio.listenerPosition() : this.headOf(id);
      if (!head) continue;
      const along = (head.x - origin.x) * direction.x + (head.y - origin.y) * direction.y + (head.z - origin.z) * direction.z;
      if (along < 2 || along > shot.distance + 1) continue;
      const miss = Math.hypot(head.x - origin.x - direction.x * along, head.y - origin.y - direction.y * along, head.z - origin.z - direction.z * along);
      if (miss < 1.5) this.say(id, "nearMiss", event.id, 0.35, 250);
    }
  }
}
