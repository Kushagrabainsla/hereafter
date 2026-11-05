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
