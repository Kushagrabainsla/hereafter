// The light the market is seen in, chosen on the setup screen. It changes only how this player
// sees the market (the layout, the props and the fight are the same), like a graphics setting.
//
//   dusk  the end of a wet afternoon: a low sun down the main alley through haze, rain, puddles,
//         and every lamp, string of bulbs, lantern and sign lit at half strength
//   day   a dry, clear afternoon lit by the sun alone: a higher, whiter sun, a blue sky, no rain
//         or standing water, and the outdoor lamps and signs off (lights inside shops stay on)
export type TimeOfDay = "dusk" | "day";
export const TIMES_OF_DAY: TimeOfDay[] = ["dusk", "day"];

export interface Look {
  time: TimeOfDay;
  // Where the sun lies from the market (any length), its colour and strength.
  sun: { offset: [number, number, number]; color: number; intensity: number };
  // The sky and ground light, and how strongly surfaces reflect the sky.
  fill: { sky: number; ground: number; intensity: number };
  environment: number;
  // Rain, puddles and the lamps' glow in the damp air.
  wet: boolean;
  // Whether the outdoor lamps and signs burn.
  lamps: boolean;
  // The haze: per metre at ground level, its own colour, and how strongly it lights up toward the sun.
  haze: { density: number; color: [number, number, number]; glow: number; tight: number; skyHaze: number };
  // The grade's tint for the shadows and for the highlights (mapViewer.ts, GRADE).
  grade: { shadows: [number, number, number]; lights: [number, number, number] };
}

export const LOOKS: Record<TimeOfDay, Look> = {
  dusk: {
    time: "dusk",
    sun: { offset: [-90, 110, 200], color: 0xffc690, intensity: 4.4 },
    fill: { sky: 0x9aa8c8, ground: 0x2c2a2c, intensity: 0.38 },
    environment: 0.55,
    wet: true,
    lamps: true,
    haze: { density: 0.008, color: [0.02, 0.026, 0.04], glow: 0.4, tight: 0.6, skyHaze: 0.08 },
    grade: { shadows: [0.78, 0.95, 1.28], lights: [1.0, 1.0, 0.99] },
  },
  day: {
    time: "day",
    // Higher in the sky (about 42°) and still from the north-northwest, so it rakes the main alley
    // and leaves the cross alleys in shade; warm white, not gold.
    sun: { offset: [-80, 190, 180], color: 0xffe9cf, intensity: 5.4 },
    // Plenty of neutral sky light into the shade, as a clear afternoon gives, and warm light bounced
    // off the dry street: shade at a quarter to a third of the sunlit brightness, never navy.
    fill: { sky: 0x9aa6b5, ground: 0x8a7a66, intensity: 1.5 },
    environment: 0.85,
    wet: false,
    lamps: false,
    // A warm cream haze that washes the far ends of the alleys out toward the sun.
    haze: { density: 0.006, color: [0.34, 0.31, 0.26], glow: 0.5, tight: 0.5, skyHaze: 0.06 },
    // Nearly neutral: the blue sky light already cools the shade.
    grade: { shadows: [0.97, 1.0, 1.04], lights: [1.02, 1.0, 0.97] },
  },
};
