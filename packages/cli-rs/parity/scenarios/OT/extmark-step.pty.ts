// Left from the end of a paste label after a CJK character puts the cursor on the character's first cell (column 17;
// OpenTUI #2050, on both sides since 0.9.4). The next key goes in front of the character.
import { definePty } from "../../pty/run"
import { home, homeMasks, paste } from "./home"

export default definePty({
  args: [],
  cols: 100,
  rows: 30,
  ...home,
  steps: [
    { until: { screen: "█▀▀█" }, settle: 500, timeout: 30_000 },
    { keys: "a界", settle: 300 },
    { keys: paste("one\ntwo\nthree\nfour\nfive"), until: { screen: "Pasted" }, settle: 500, checkpoint: "pasted" },
    // The first Left crosses the space the paste adds after its label.
    { keys: "\x1b[D", settle: 300 },
    { keys: "\x1b[D", settle: 300, checkpoint: "left" },
    { keys: "X", settle: 500, checkpoint: "typed" },
  ],
  cursor: true,
  masks: homeMasks,
})
