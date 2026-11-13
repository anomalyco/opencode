// A click on a `[Pasted ~5 lines]` label expands it in place and selects nothing (`expandPastedText`, whose
// mouse-down handler prevents the default). The release lands on the expanded text and copies nothing, and the next
// key types at the cursor, after the pasted text.
import { definePty } from "../../pty/run"
import { home, homeMasks, paste, press, release } from "../OT/home"

export default definePty({
  args: [],
  cols: 100,
  rows: 30,
  ...home,
  steps: [
    { until: { screen: "█▀▀█" }, settle: 500, timeout: 30_000 },
    { keys: "a", settle: 300 },
    { keys: paste("one\ntwo\nthree\nfour\nfive"), until: { screen: "Pasted" }, settle: 500 },
    { keys: "b", settle: 300, checkpoint: "label" },
    { keys: press(27, 17), settle: 300, checkpoint: "pressed" },
    { keys: release(27, 17), settle: 500, checkpoint: "clicked" },
    { keys: "X", settle: 500, checkpoint: "typed" },
  ],
  cursor: true,
  osc: ["clipboard"],
  masks: homeMasks,
})
