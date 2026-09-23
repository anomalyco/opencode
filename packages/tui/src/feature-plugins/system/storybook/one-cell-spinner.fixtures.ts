import { SEED_LAUNCH, SEED_WORK, WORK_SPINNERS, type OneCellMotion } from "../../../ui/one-cell-motion"
import { SUBCELL_SPINNERS } from "./subcell-spinner.fixtures"

export type SpinnerFixture = OneCellMotion & {
  name: string
  description: string
  launch?: OneCellMotion
}

function heldFrames(glyphs: string, holds: number[] = []) {
  return Array.from(glyphs).flatMap((glyph, index) => Array.from({ length: holds[index] ?? 1 }, () => glyph))
}

function sequence(
  name: string,
  description: string,
  glyphs: string,
  interval: number,
  holds?: number[],
): SpinnerFixture {
  return { name, description, frames: heldFrames(glyphs, holds), interval }
}

function pulse(
  name: string,
  description: string,
  glyphs: string,
  duration: number,
  level: (phase: number) => number,
  holds?: number[],
): SpinnerFixture {
  const shapes = heldFrames(glyphs, holds)
  const phases = Array.from({ length: duration / 40 }, (_, index) => index / (duration / 40))
  return {
    name,
    description,
    frames: phases.map((phase) => shapes[Math.floor(phase * shapes.length)]!),
    interval: 40,
    // Keep a visible floor: a working indicator must never blink out entirely.
    levels: phases.map((phase) => 0.3 + 0.7 * level(phase)),
  }
}

const breathe = (phase: number) => (1 - Math.cos(phase * 2 * Math.PI)) / 2
const ember = (phase: number) => (phase < 0.1 ? phase / 0.1 : ((1 - phase) / 0.9) ** 3)
const seedBreathe = pulse("Seed breathe", "A still seed carries a slow breath of light.", "\u25aa", 1600, breathe)
const seedToggle = pulse(
  "Seed toggle",
  "An outline fills with light, then opens again.",
  "\u25ab\u25aa\u25aa\u25ab",
  1600,
  breathe,
)
export const ONE_CELL_SPINNERS: SpinnerFixture[] = [
  {
    ...WORK_SPINNERS["small-toggle"],
    name: "Small toggle",
    description: "A small square opens and closes in an even rhythm.",
  },
  {
    ...WORK_SPINNERS["square-toggle"],
    name: "Square toggle",
    description: "A larger square opens and closes at a slower pace.",
  },
  {
    ...WORK_SPINNERS["grow-shrink"],
    name: "Grow / shrink",
    description: "An outline fills, grows, and returns to a seed.",
  },
  sequence(
    "Inset bloom",
    "A square within a square opens into a full bloom.",
    "\u25ab\u25aa\u25a3\u25a0\u25a3\u25aa",
    120,
    [3],
  ),
  sequence("Hollow bloom", "The outline grows before its center fills.", "\u25ab\u25a1\u25a3\u25a0\u25a3\u25a1", 160, [
    3,
  ]),
  sequence(
    "Corner orbit",
    "A small square traces four corners without leaving its cell.",
    "\u25f0\u25f3\u25f2\u25f1",
    160,
  ),
  {
    ...WORK_SPINNERS["quadrant-orbit"],
    name: "Quadrant orbit",
    description: "Four corners take their turn, clockwise.",
  },
  sequence("Half rotation", "Light and shade circle a still square.", "\u25e7\u2b12\u25e8\u2b13", 200),
  { ...WORK_SPINNERS.crosshatch, name: "Crosshatch", description: "Diagonal threads cross, then change direction." },
  {
    ...WORK_SPINNERS["density-wave"],
    name: "Density wave",
    description: "Grain gathers into a block, then thins. The color stays still.",
  },
  sequence(
    "Fill / drain",
    "A narrow tide rises, then returns.",
    "\u2581\u2582\u2583\u2584\u2585\u2586\u2587\u2588\u2587\u2586\u2585\u2584\u2583\u2582",
    80,
    [2, 2, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1, 2],
  ),
  sequence(
    "Double beat",
    "Two quick swells, then a quiet seed.",
    "\u25aa\u25a0\u25aa\u25a0\u25aa",
    100,
    [1, 1, 2, 1, 11],
  ),
  sequence("Beacon", "One large flash settles into a seed that stays in sight.", "\u25a0\u25a3\u25aa", 120, [1, 1, 12]),
  sequence(
    "Held bloom",
    "A seed swells, holds its bloom, then rests.",
    "\u25aa\u25a3\u25a0\u25a3\u25aa",
    160,
    [4, 1, 2, 1, 2],
  ),
  seedBreathe,
  pulse("Square breathe", "A larger square takes a longer breath.", "\u25a0", 2400, breathe),
  pulse("Inset breathe", "A square within a square holds a soft breath of light.", "\u25a3", 2000, breathe),
  pulse(
    "Bloom + glow",
    "A small bloom grows with the light, then recedes.",
    "\u25aa\u25a3\u25a0\u25a3\u25aa",
    1600,
    breathe,
    [6, 3, 2, 3, 6],
  ),
  pulse("Soft heartbeat", "Two soft beats of light, then a quiet glow.", "\u25aa", 1600, (phase) =>
    Math.max(Math.exp(-(((phase - 0.2) / 0.08) ** 2)), 0.75 * Math.exp(-(((phase - 0.4) / 0.08) ** 2))),
  ),
  pulse("Ember", "A quick spark leaves a long glow in a still square.", "\u25a3", 1600, ember),
  { ...seedToggle, launch: SEED_LAUNCH },
  pulse("Seed ember", "A small, still seed catches light and lets it linger.", "\u25aa", 1600, ember),
  {
    ...SEED_WORK,
    name: "Seed handoff",
    description: "A spark lingers, then the breath grows quiet.",
    launch: SEED_LAUNCH,
  },
  ...SUBCELL_SPINNERS,
]
