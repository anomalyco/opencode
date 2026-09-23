import {
  BLOCK_LOW_COMET,
  BLOCK_SOFT_SLIDE,
  BLOCK_SOFT_SWEEP,
  SEED_LAUNCH,
  WORK_SPINNERS,
} from "../../../ui/one-cell-motion"
import { octantGlyph } from "../../../ui/subcell"
import type { SpinnerFixture } from "./one-cell-spinner.fixtures"

const perimeter = [0, 1, 3, 5, 7, 6, 4, 2]
const patterns = [
  {
    name: "comet",
    description: "Three pixels chase the edge.",
    interval: 100,
    masks: perimeter.map(
      (point, index) => (1 << point) | (1 << perimeter[(index + 7) % 8]!) | (1 << perimeter[(index + 6) % 8]!),
    ),
  },
  {
    name: "orbit",
    description: "Two pixels keep a steady orbit.",
    interval: 140,
    masks: perimeter.map((point, index) => (1 << point) | (1 << perimeter[(index + 7) % 8]!)),
  },
  {
    name: "duet",
    description: "Two pairs circle opposite edges.",
    interval: 180,
    masks: perimeter
      .slice(0, 4)
      .map((_, index) => [0, 3, 4, 7].reduce((mask, offset) => mask | (1 << perimeter[(index + offset) % 8]!), 0)),
  },
  {
    name: "scan",
    description: "A row sweeps down, pauses, and returns.",
    interval: 130,
    masks: [0, 0, 1, 2, 3, 3, 2, 1].map((row) => 3 << (row * 2)),
  },
  {
    name: "weave",
    description: "Four pixels pass from side to side.",
    interval: 200,
    masks: [0x55, 0x69, 0xaa, 0x96],
  },
  {
    name: "tide",
    description: "Rows rise from the floor, then recede.",
    interval: 160,
    masks: [0xc0, 0xc0, 0xf0, 0xfc, 0xff, 0xfc, 0xf0],
  },
  {
    name: "low comet",
    description: "The tail recedes before the head moves. The top row stays empty.",
    motion: BLOCK_LOW_COMET,
    blockOnly: true,
  },
  {
    name: "low duet",
    description: "Two tails recede, then the heads move. The top row stays empty.",
    motion: WORK_SPINNERS["block-low-duet"],
    blockOnly: true,
  },
  // The middle four octants are bits 2-5: left column 0x14, right column 0x28.
  {
    name: "shuttle",
    description: "A narrow bar moves left and right through the middle four.",
    motion: WORK_SPINNERS["block-shuttle"],
    blockOnly: true,
  },
  {
    name: "bridge",
    description: "The bar stretches across the middle four, then settles opposite.",
    motion: WORK_SPINNERS["block-bridge"],
    blockOnly: true,
  },
  {
    name: "soft sweep",
    description: "A staggered wipe crosses the middle four and retraces its path.",
    motion: BLOCK_SOFT_SWEEP,
    blockOnly: true,
  },
  {
    name: "squeeze",
    description: "The middle bar folds, hops sideways, and opens.",
    motion: WORK_SPINNERS["block-squeeze"],
    blockOnly: true,
  },
  {
    name: "soft slide",
    description: "The middle bar softens before each sideways step.",
    blockOnly: true,
    motion: BLOCK_SOFT_SLIDE,
  },
]

export const SUBCELL_SPINNERS: SpinnerFixture[] = patterns.flatMap((pattern) =>
  (pattern.blockOnly ? ["block"] : ["block", "dot"]).map((style) => ({
    name: `${style} ${pattern.name}`,
    description: `${pattern.description} ${style === "block" ? "2x4 octants need a recent font." : "2x4 braille dots."}`,
    ...(pattern.motion ?? {
      interval: pattern.interval!,
      frames: pattern.masks!.map((mask) => {
        if (style === "dot") {
          // Braille numbers its dots by column rather than by raster row.
          const dots = [0, 3, 1, 4, 2, 5, 6, 7].reduce((value, bit, index) => value | (((mask >> index) & 1) << bit), 0)
          return String.fromCodePoint(0x2800 + dots)
        }
        return octantGlyph(mask)
      }),
    }),
    launch: SEED_LAUNCH,
  })),
)
