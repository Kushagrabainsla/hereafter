import catalog from "./memes.json";
import { gameAudio, type Vec3 } from "./gameAudio";
import { publicExists } from "../assetStore";
import { type VoiceChoice } from "../settings";

// Meme voice lines and sound effects, played on top of the game's own sounds at moments of the
// match. Lines are in the speaker's language (src/game/memes.json); sound effects have no
// words and any player can set them off. A meme plays only once its clip is built into
// public/audio/meme/<code>.mp3 (npm run build:voices), so lines stay silent until recorded.
//
// A player sets off at most one meme every 30 s, and each moment has its own chance. Moments
// of combat are picked by a hash of the event, the same on every peer; moments of movement
// (jumps, sprints, landings) are picked by the moving player's peer, which tells the room.
// Each listener hears memes only with "Meme sounds" on, and 18+ ones only with 18+ lines on,
// hearing a clean meme from the same moment instead where there is one.

export type MemeMoment = keyof typeof catalog.chance;
interface Meme { code: string; lang: string | null; moments: string[]; tier: string; reply?: string }

const MEMES = catalog.memes as Meme[];
const CHANCE = catalog.chance as Record<MemeMoment, number>;
// Moments that belong to no one player, so no one's quiet time holds them back.
const UNHELD = new Set<MemeMoment>(["quietRound", "leave"]);

const available = (meme: Meme): boolean => publicExists(`audio/meme/${meme.code}.mp3`);

// FNV-1a: the same small number on every peer for the same text.
function hash(text: string): number {
  let value = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) value = Math.imul(value ^ text.charCodeAt(i), 0x01000193);
  return value >>> 0;
}

export class Memes {
  // Whether this listener hears memes at all, and 18+ ones.
  on = true;
  adult = false;
  private quietUntil = new Map<string, number>();

  constructor(
    private selfId: string,
    private voiceOf: (id: string) => VoiceChoice,
    private headOf: (id: string) => Vec3 | null,
    // When a player's own voice line ends, so their meme line can follow it.
    private busyUntil: (id: string) => number,
  ) {}

  // The meme clips worth loading for these voices: every built sound effect, and the lines in
  // these languages; 18+ ones only if this listener hears them.
  static clips(voices: Iterable<VoiceChoice>, adult: boolean): string[] {
    const langs = new Set(voices);
    return MEMES.filter((meme) => available(meme) && (meme.lang === null || langs.has(meme.lang as VoiceChoice)) && (adult || meme.tier !== "adult"))
      .map((meme) => `meme/${meme.code}`);
  }

  // A meme for a speaker at a moment, if the roll and their quiet time allow one; returns the
  // code chosen (even when this listener does not hear it), or null.
  say(speaker: string, moment: MemeMoment, seed: number | string, delayMs = 0): string | null {
    const choices = this.choices(speaker, moment);
    if (!choices.length) return null;
    const roll = hash(`meme:${seed}:${speaker}:${moment}`);
    if ((roll % 1000) / 1000 >= CHANCE[moment]) return null;
    const now = performance.now();
    if (!UNHELD.has(moment)) {
      if (now < (this.quietUntil.get(speaker) ?? 0)) return null;
      this.quietUntil.set(speaker, now + delayMs + catalog.gapMs);
    }
    const meme = choices[(roll >>> 10) % choices.length];
    this.play(speaker, meme, roll, delayMs);
    return meme.code;
  }

  // A meme a peer already chose for its own player (a jump, a sprint), or a reply to one.
  hear(speaker: string, code: string, seed: number, delayMs = 0): void {
    const meme = MEMES.find((entry) => entry.code === code);
    if (!meme || !available(meme)) return;
    if (meme.moments.length && !UNHELD.has(meme.moments[0] as MemeMoment)) this.quietUntil.set(speaker, performance.now() + delayMs + catalog.gapMs);
    this.play(speaker, meme, seed, delayMs);
  }

  // A meme for this player's own movement: rolled here, and returned so the room hears it too.
  own(moment: MemeMoment): { code: string; seed: number } | null {
    const seed = Math.floor(Math.random() * 2 ** 31);
    const code = this.say(this.selfId, moment, seed);
    return code ? { code, seed } : null;
  }

  // The reply a meme asks for, such as "NANI?!" after "Omae wa mou shindeiru".
  static replyTo(code: string | null): string | null {
    return (code && MEMES.find((meme) => meme.code === code)?.reply) || null;
  }

  forget(speaker: string): void { this.quietUntil.delete(speaker); }

  private choices(speaker: string, moment: MemeMoment): Meme[] {
    const voice = this.voiceOf(speaker);
    return MEMES.filter((meme) => meme.moments.includes(moment) && available(meme) && (meme.lang === null || meme.lang === voice));
  }

  private play(speaker: string, chosen: Meme, roll: number, delayMs: number): void {
    if (!this.on) return;
    let meme: Meme | undefined = chosen;
    if (meme.tier === "adult" && !this.adult) {
      const clean = this.choices(speaker, (meme.moments[0] ?? "") as MemeMoment).filter((entry) => entry.tier !== "adult");
      meme = clean.length ? clean[(roll >>> 20) % clean.length] : undefined;
    }
    if (!meme) return;
    // A line waits for the speaker's own voice line to end; a sound effect plays at once.
    const wait = meme.lang === null ? delayMs : Math.max(delayMs, this.busyUntil(speaker) - performance.now() + 150);
    const code = meme.code, placed = speaker !== this.selfId;
    window.setTimeout(() => {
      // A player who has left is heard close, as the last thing they say.
      gameAudio.meme(code, placed ? this.headOf(speaker) : null);
    }, Math.max(0, wait));
  }
}
