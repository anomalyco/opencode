// Escape cancels; Clack's alias also flips the answer that the cancelled frame shows.
import { definePty } from "../../pty/run"
import { demo, press } from "./demo"

export default definePty({
  args: [],
  command: demo("confirm"),
  cols: 50,
  rows: 10,
  steps: [{ until: { screen: "Continue?" }, settle: 250 }, press("\x1b", "cancelled", "Cancelled")],
  exits: true,
})
