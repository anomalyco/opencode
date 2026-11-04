// The spinner's final lines: success and cancel codes, between intro and outro.
import { definePty } from "../../pty/run"
import { demo } from "./demo"

export default definePty({
  args: [],
  command: demo("spinner"),
  cols: 50,
  rows: 12,
  steps: [{ until: { screen: "Done" }, settle: 300, checkpoint: "done" }],
  exits: true,
})
