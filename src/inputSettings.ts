// How the player looks around: kept in this browser and changed in the Settings dialog during
// play. The view reads `INPUT` every time the mouse moves, so a change shows at once.

export interface InputSettings {
  // The mouse's speed, as a multiple of the game's own 0.18 degrees for each count of the mouse.
  sensitivity: number;
  // The mouse's speed while fully aimed, as a multiple of the speed above. The sights' own zoom
  // slows the view too, so 1 keeps the same hand movement for the same distance on the screen.
  aimSensitivity: number;
  // The field of view up and down, in degrees, when standing still. A sprint widens it a little
  // and a crouch narrows it.
  fov: number;
  // Whether moving the mouse away looks down.
  invertY: boolean;
}

// The least, the most, the step of its slider and the value on a first visit.
export const INPUT_RANGE = {
  sensitivity: { min: 0.2, max: 3, step: 0.05, start: 1 },
  aimSensitivity: { min: 0.3, max: 1.5, step: 0.05, start: 1 },
  fov: { min: 60, max: 100, step: 1, start: 75 },
};
// The field of view the hands and the gun are drawn with, whatever the view's own is.
export const HAND_FOV = 75;

const KEYS = { sensitivity: "hereafter.sensitivity", aimSensitivity: "hereafter.aimSensitivity", fov: "hereafter.fov", invertY: "hereafter.invertY" };
const read = (key: string): string | null => { try { return window.localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string): void => { try { window.localStorage.setItem(key, value); } catch { /* unavailable */ } };
const within = (value: number, { min, max, start }: { min: number; max: number; start: number }): number => (Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : start);
const number = (key: string, range: { min: number; max: number; start: number }): number => { const kept = read(key); return kept === null ? range.start : within(Number(kept), range); };

export const INPUT: InputSettings = {
  sensitivity: number(KEYS.sensitivity, INPUT_RANGE.sensitivity),
  aimSensitivity: number(KEYS.aimSensitivity, INPUT_RANGE.aimSensitivity),
  fov: number(KEYS.fov, INPUT_RANGE.fov),
  invertY: read(KEYS.invertY) === "1",
};

// Changes one or more of the settings, keeps them in range, and saves them.
export function setInput(change: Partial<InputSettings>): void {
  if (change.sensitivity !== undefined) INPUT.sensitivity = within(change.sensitivity, INPUT_RANGE.sensitivity);
  if (change.aimSensitivity !== undefined) INPUT.aimSensitivity = within(change.aimSensitivity, INPUT_RANGE.aimSensitivity);
  if (change.fov !== undefined) INPUT.fov = within(change.fov, INPUT_RANGE.fov);
  if (change.invertY !== undefined) INPUT.invertY = change.invertY;
  write(KEYS.sensitivity, String(INPUT.sensitivity));
  write(KEYS.aimSensitivity, String(INPUT.aimSensitivity));
  write(KEYS.fov, String(INPUT.fov));
  write(KEYS.invertY, INPUT.invertY ? "1" : "0");
}
