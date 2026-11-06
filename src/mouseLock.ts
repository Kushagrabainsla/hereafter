// Locks the mouse to an element for mouse look. Browsers allow it only during a click or key
// press, refuse it for about a second after the player pressed Esc, and older Safari returns
// nothing instead of a promise.
export function lockMouse(element: HTMLElement): void {
  try {
    const request = element.requestPointerLock() as Promise<void> | undefined;
    request?.catch?.(() => undefined);
  } catch {
    // Pointer lock is unavailable; drag to look still works.
  }
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
    if (root.requestFullscreen) root.requestFullscreen({ navigationUI: "hide" }).catch(() => undefined);
    else root.webkitRequestFullscreen?.();
  } catch {
    // Full screen is unavailable here.
  }
}
