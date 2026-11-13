// OT2065 (parity/deviations/OT2065-lost-mouse-release.md): a drag over the prompt text whose release never comes,
// then a new press, drag and release over "text". TS treats the new gesture as part of the old one: it selects and
// copies nothing, and `Z` goes where the first drag left the cursor. Rust ends the old drag at the press, selects
// and copies "text", and `Z` replaces it.
import { definePty } from "../../pty/run"
import { home, homeMasks, move, press, release } from "./home"

const deviation = { file: "OT2065-lost-mouse-release", lines: 5 }

export default definePty({
  args: [],
  cols: 100,
  rows: 30,
  ...home,
  steps: [
    { until: { screen: "█▀▀█" }, settle: 500, timeout: 30_000 },
    { keys: "copy this text now", until: { screen: "copy this text now" }, settle: 200 },
    { keys: press(17, 17), settle: 50 },
    { keys: move(19, 17) + move(21, 17), settle: 300, checkpoint: "held" },
    { keys: press(27, 17), settle: 50 },
    { keys: move(29, 17) + move(30, 17), settle: 50 },
    { keys: release(30, 17), settle: 500, checkpoint: "released", deviation },
    { keys: "Z", settle: 400, checkpoint: "typed", deviation },
  ],
  cursor: true,
  osc: [],
  masks: homeMasks,
})
