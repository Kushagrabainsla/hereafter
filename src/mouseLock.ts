import { GAME_KEY_CODES } from "./keys";

// Locks the mouse to an element for mouse look. Browsers allow it only during a click or key
// press, refuse it for about a second after the player pressed Esc, and older Safari returns
// nothing instead of a promise.
//
// The lock asks for the mouse's own movement, without the pointer acceleration of the operating
// system (`unadjustedMovement`), so the same hand movement always turns the view the same angle.
// A browser or system that cannot give that refuses the request; the lock is then asked for again
// in the plain way.
export function lockMouse(element: HTMLElement): void {
  const plain = (): void => {
    try {
      const request = element.requestPointerLock() as Promise<void> | undefined;
      request?.catch?.(() => undefined);
    } catch {
      // Pointer lock is unavailable; drag to look still works.
    }
  };
  try {
    const request = (element.requestPointerLock as (options?: { unadjustedMovement?: boolean }) => Promise<void> | undefined).call(element, { unadjustedMovement: true });
    if (request?.catch) request.catch((error: unknown) => { if ((error as { name?: string } | null)?.name === "NotSupportedError") plain(); });
  } catch {
    plain();
  }
}

// In full screen, asks the browser to pass the game's keys to the page, so Ctrl (crouch) with W
// does not close the tab and Ctrl with R does not reload it. Only Chromium browsers have this
// lock, and only in full screen; the lock ends when full screen ends. Escape is not locked.
function lockGameKeys(): void {
  const keyboard = (navigator as Navigator & { keyboard?: { lock?: (codes?: string[]) => Promise<void> } }).keyboard;
  keyboard?.lock?.(GAME_KEY_CODES).catch(() => undefined);
}

// Fills the screen with the game, as it starts and whenever a click takes the player back into
// play (Esc leaves full screen along with the mouse lock). Like the lock, browsers allow it only
// during a click or key press. It is the whole page that fills the screen, not the canvas, so
// the HUD and dialogs stay in view. Older Safari has only the prefixed call; a browser without
// either, or a page in a frame not allowed full screen, plays in its window.
export function fillScreen(): void {
  const page = document as Document & { webkitFullscreenElement?: Element | null };
  if (page.fullscreenElement ?? page.webkitFullscreenElement) return;
  const root = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  try {
    if (root.requestFullscreen) root.requestFullscreen({ navigationUI: "hide" }).then(lockGameKeys).catch(() => undefined);
    else root.webkitRequestFullscreen?.();
  } catch {
    // Full screen is unavailable here.
  }
}
