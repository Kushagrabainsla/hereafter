// The loading screen after Deploy: a list of steps, a bar and a percentage. Each step owns a
// share of the bar sized by how long it takes: downloads by their bytes at the speed measured
// while the player set up the match, and building steps by their measured times (see
// docs/rendering.md). A step that reports its own progress (bytes, files) fills its share as
// it goes; one that cannot creeps toward the end of its share over its expected time. The bar
// and the number are drawn from one value each frame, so they always agree, and the screen
// stays until both read 100%.

export type StepId = "map" | "sounds" | "world" | "props" | "renderer" | "physics" | "shaders";

interface Step { id: StepId; active: string; done: string; expectedMs: number; reported: number; startedAt: number; state: "wait" | "active" | "done"; li: HTMLLIElement }

// Measured in Chrome with WebGPU on a Mac with the files already downloaded; only their ratios
// matter. Building the shaders in the first frames takes most of the time.
const BUILD_MS: Record<Exclude<StepId, "map" | "sounds">, number> = { world: 190, props: 30, renderer: 10, physics: 55, shaders: 2500 };
// Steps that report how far they are; the others creep along over their expected time.
const REPORTING = new Set<StepId>(["map", "sounds", "shaders"]);

const TIPS = [
  "Press H any time to see every control.",
  "Hold Q or E to lean around cover.",
  "Press G to throw a grenade. It bounces, rolls and bursts after 2.6 seconds.",
  "Press T to throw a smoke grenade: a grey wall about 7 m across for 13 seconds.",
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
  "Doors open inward. Drag furniture or push a drum behind one and it will only open as far as what is in the way.",
  "Shoot a steam pipe to fill the alley around it with cover.",
  "The record shop runs through the middle block. Its boarded back window can be blown out.",
  "Shoot a red fuel drum and get clear: it vents fire, then explodes.",
  "A broken stall leaves a low pile you can still hide behind.",
];

const element = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

export class Loading {
  private steps: Step[] = [];
  private shown = 0;
  private last = 0;
  private frame = 0;
  private tipTimer = 0;
  private failed = false;
  private complete: (() => void) | null = null;
  private readonly root = element<HTMLElement>("loader");
  private readonly fill = element<HTMLElement>("loader-fill");
  private readonly percent = element<HTMLElement>("loader-percent");
  private readonly status = element<HTMLElement>("loader-step");
  private readonly tip = element<HTMLElement>("loader-tip");

  // labels: what each download step says while running and once done.
  constructor(labels: { map: [string, string]; sounds: [string, string] }, expectedMs: { map: number; sounds: number }, status: string) {
    const list = element<HTMLOListElement>("loader-steps");
    list.replaceChildren();
    const make = (id: StepId, active: string, done: string, ms: number): Step => {
      const li = document.createElement("li");
      li.textContent = active;
      list.append(li);
      return { id, active, done, expectedMs: ms, reported: 0, startedAt: 0, state: "wait", li };
    };
    this.steps = [
      make("map", ...labels.map, expectedMs.map),
      make("sounds", ...labels.sounds, expectedMs.sounds),
      make("world", "Building alleys and buildings", "Alleys and buildings", BUILD_MS.world),
      make("props", "Placing stalls, props and lights", "Stalls, props and lights", BUILD_MS.props),
      make("renderer", "Starting the renderer", "Renderer started", BUILD_MS.renderer),
      make("physics", "Building physics", "Physics built", BUILD_MS.physics),
      make("shaders", "Preparing shaders", "Shaders ready", BUILD_MS.shaders),
    ];
    this.status.textContent = status;
    this.root.dataset.state = "loading";
    this.root.classList.remove("done");
    this.root.hidden = false;
    let tip = Math.floor(Math.random() * TIPS.length);
    this.tip.textContent = TIPS[tip];
    this.tipTimer = window.setInterval(() => { tip = (tip + 1) % TIPS.length; this.tip.textContent = TIPS[tip]; }, 4500);
    this.draw(0);
    this.last = performance.now();
    this.frame = requestAnimationFrame(this.tick);
  }

  // Starts a step; every step before it is done. Starting a step again does nothing.
  begin(id: StepId): void {
    const index = this.steps.findIndex((step) => step.id === id);
    if (index < 0 || this.steps[index].state !== "wait") return;
    for (const step of this.steps.slice(0, index)) this.finishStep(step);
    const step = this.steps[index];
    step.state = "active";
    step.startedAt = performance.now();
    step.li.className = "active";
  }

  // How far through a running step is, from 0 to 1.
  progress(id: StepId, fraction: number): void {
    const step = this.steps.find((entry) => entry.id === id);
    if (step) step.reported = Math.max(step.reported, Math.min(1, fraction));
  }

  done(id: StepId): void {
    const step = this.steps.find((entry) => entry.id === id);
    if (step) this.finishStep(step);
  }

  // Every step done: the bar runs to 100%, holds a moment and the screen fades.
  finish(): Promise<void> {
    for (const step of this.steps) this.finishStep(step);
    // A tab in the background draws no frames; the screen still goes.
    window.setTimeout(() => { if (this.complete) { this.shown = 1; this.tick(performance.now()); } }, 2500);
    return new Promise((resolve) => { this.complete = resolve; });
  }

  fail(message: string): void {
    this.failed = true;
    window.clearInterval(this.tipTimer);
    this.root.dataset.state = "error";
    this.root.classList.remove("done");
    this.root.hidden = false;
    this.status.textContent = message;
    this.tip.textContent = "Reload the page to try again. If it keeps happening, add ?renderer=webgl to the address.";
  }

  private finishStep(step: Step): void {
    if (step.state === "done") return;
    step.state = "done";
    step.reported = 1;
    step.li.className = "done";
    step.li.textContent = step.done;
  }

  // Where the bar should be: the shares of the finished steps, and of the running step as
  // far as it has reported or, if it cannot, as far as its expected time suggests.
  private target(now: number): number {
    const total = this.steps.reduce((sum, step) => sum + step.expectedMs, 0) || 1;
    let reached = 0;
    for (const step of this.steps) {
      if (step.state === "done") reached += step.expectedMs;
      else if (step.state === "active") {
        const timed = Math.min(0.9, (now - step.startedAt) / Math.max(1, step.expectedMs));
        reached += step.expectedMs * Math.max(step.reported, REPORTING.has(step.id) ? 0 : timed);
      }
    }
    return Math.min(1, reached / total);
  }

  private draw(value: number): void {
    const shown = Math.floor(value * 1000) / 1000;
    this.fill.style.width = `${(shown * 100).toFixed(1)}%`;
    this.percent.textContent = `${Math.floor(shown * 100)}%`;
  }

  private tick = (now: number): void => {
    if (this.failed) return;
    const seconds = Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    const target = this.target(now);
    // Eases toward where the work is, never backward; a long pause catches up quickly.
    this.shown = Math.min(target, this.shown + Math.max((target - this.shown) * Math.min(1, seconds * 7), seconds * 0.02));
    if (target >= 1 && this.shown > 0.995) this.shown = 1;
    this.draw(this.shown);
    if (this.shown >= 1 && this.complete) {
      const resolve = this.complete;
      this.complete = null;
      window.clearInterval(this.tipTimer);
      window.setTimeout(() => {
        this.root.classList.add("done");
        window.setTimeout(() => { this.root.hidden = true; resolve(); }, 650);
      }, 250);
      return;
    }
    this.frame = requestAnimationFrame(this.tick);
  };

  stop(): void { cancelAnimationFrame(this.frame); }
}
