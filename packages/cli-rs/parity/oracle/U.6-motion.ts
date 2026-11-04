// P-ORACLE for U.6: the TUI's pure motion functions over fixed inputs. Writes parity/fixtures/U.6/functions.json;
// crates/ui/tests/motion_oracle.rs evaluates the Rust ports on the same inputs and compares.
//
// - `oneCellFrame` of every work spinner, the seed launch, and the mono spinner at fixed instants, including the
//   seed's intro and the paced slowdown between 30 s and 60 s.
// - `octantGlyph` for every mask.
// - `createFrames` for the default (diamond) scanner and the prompt's block scanner.
import { octantGlyph } from "../../../tui/src/ui/subcell.ts"
import {
  oneCellFrame,
  SEED_LAUNCH,
  SEED_MONO,
  WORK_SPINNERS,
  type OneCellMotion,
} from "../../../tui/src/ui/one-cell-motion.ts"
import { createFrames } from "../../../tui/src/ui/spinner.ts"

const output = new URL("../fixtures/U.6/functions.json", import.meta.url).pathname
const instants = [
  ...Array.from({ length: 400 }, (_, index) => index * 13),
  ...Array.from({ length: 140 }, (_, index) => 28_000 + index * 250),
  ...[0.5, 39.999, 40, 3199.9, 3200, 1e6],
]

const motions: [string, OneCellMotion][] = [
  ...Object.entries(WORK_SPINNERS),
  ["seed-launch", SEED_LAUNCH],
  ["seed-mono", SEED_MONO],
]

const fixture = {
  instants,
  motions: Object.fromEntries(
    motions.map(([name, motion]) => [
      name,
      instants.map((instant) => {
        const frame = oneCellFrame(motion, instant)
        // As a string: serde_json does not always round decimal floats correctly; Rust parses this exactly.
        return [frame.glyph, String(frame.level), frame.complete]
      }),
    ]),
  ),
  octants: Array.from({ length: 256 }, (_, mask) => octantGlyph(mask)),
  scanner: {
    diamonds: createFrames({ color: "#fab283" }),
    blocks: createFrames({ color: "#fab283", style: "blocks", inactiveFactor: 0.6, minAlpha: 0.3 }),
  },
}

await Bun.write(output, JSON.stringify(fixture) + "\n")
console.log(`oracle: U.6 ${motions.length} motions x ${instants.length} instants`)
