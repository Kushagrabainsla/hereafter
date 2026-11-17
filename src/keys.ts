// The game reads each key by its place on the keyboard (event.code), not by the letter printed
// on it. The controls then sit under the same fingers on every layout: on an AZERTY keyboard, the
// key marked Z walks forward. The name returned is the key's letter on a US keyboard, in lower
// case, as the handlers have always used: "w", "1", " ", "shift", "control", "arrowup", "enter".
const NAMED: Record<string, string> = {
  Space: " ", ShiftLeft: "shift", ShiftRight: "shift", ControlLeft: "control", ControlRight: "control",
  ArrowUp: "arrowup", ArrowDown: "arrowdown", ArrowLeft: "arrowleft", ArrowRight: "arrowright",
  Enter: "enter", NumpadEnter: "enter", Tab: "tab", Escape: "escape",
};

export function gameKey(event: KeyboardEvent): string {
  const code = event.code;
  if (code.length === 4 && code.startsWith("Key")) return code[3].toLowerCase();
  if (code.length === 6 && code.startsWith("Digit")) return code[5];
  // A key with no code (some on-screen keyboards) falls back to its letter.
  return NAMED[code] ?? event.key.toLowerCase();
}

// The keys the game uses, by code. In full screen the browser passes these to the game even
// with Ctrl held (crouch), where Ctrl+W would close the tab and Ctrl+R would reload it. Escape is
// left out on purpose: it still leaves full screen and frees the mouse at once.
export const GAME_KEY_CODES = [
  "KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE", "KeyR", "KeyF", "KeyG", "KeyT", "KeyB", "KeyC", "KeyH", "KeyM", "KeyN",
  "Digit1", "Digit2", "Space", "Tab", "Enter",
];
