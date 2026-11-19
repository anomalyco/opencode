// A drag over the prompt text whose release never comes, then a new press, drag and release over "text". The press
// ends the old drag, the new gesture selects and copies "text", and `Z` replaces it (OpenTUI #2065, on both sides
// since 0.9.4).
import { definePty } from "../../pty/run"
import { home, homeMasks, move, press, release } from "./home"

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
    { keys: release(30, 17), settle: 500, checkpoint: "released" },
    { keys: "Z", settle: 400, checkpoint: "typed" },
  ],
  cursor: true,
  osc: [],
  masks: homeMasks,
})
