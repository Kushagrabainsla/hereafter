// What the world is made of, and how bullets and blasts treat it. Every client uses the
// same table so the coordinating peer's results match what everyone sees and hears.

export type Material =
  | "glass" | "wood" | "timber" | "metal-thin" | "metal-solid" | "plastic" | "cardboard"
  | "concrete" | "brick" | "ground" | "flesh" | "boundary" | "rubber";

export interface MaterialRule {
  // Penetration power a bullet loses per metre of this material. A pistol round starts
  // with 1, a carbine round with 2; flesh costs a flat 1 per body.
  resistance: number;
  // Share of a bullet's damage, and of a blast's, that reaches an object made of this.
  bullet: number;
  blast: number;
  // How the hit looks and sounds.
  impact: "dust" | "sparks" | "splinters" | "shards" | "puff" | "blood";
}

export const MATERIALS: Record<Material, MaterialRule> = {
  glass: { resistance: 0.05, bullet: 1, blast: 1, impact: "shards" },
  wood: { resistance: 1.2, bullet: 1, blast: 1.2, impact: "splinters" },
  // Solid tree trunks stop rounds outright.
  timber: { resistance: 6, bullet: 0, blast: 0, impact: "splinters" },
  "metal-thin": { resistance: 1.4, bullet: 0.5, blast: 0.8, impact: "sparks" },
  "metal-solid": { resistance: 30, bullet: 0, blast: 0.15, impact: "sparks" },
  plastic: { resistance: 0.4, bullet: 1, blast: 1.5, impact: "puff" },
  cardboard: { resistance: 0.25, bullet: 1.5, blast: 2, impact: "puff" },
  concrete: { resistance: 14, bullet: 0.12, blast: 0.6, impact: "dust" },
  brick: { resistance: 12, bullet: 0, blast: 0, impact: "dust" },
  ground: { resistance: 100, bullet: 0, blast: 0, impact: "dust" },
  flesh: { resistance: 1, bullet: 1, blast: 1, impact: "blood" },
  boundary: { resistance: 0, bullet: 0, blast: 0, impact: "dust" },
  // Tyres: thick rubber over steel belts, enough to stop a pistol round.
  rubber: { resistance: 4, bullet: 1, blast: 0.7, impact: "puff" },
};

// Starting penetration power per weapon; the knife never passes through anything.
export const PENETRATION = { knife: 0, pistol: 1, rifle: 2 } as const;
export const BODY_COST = 1;
