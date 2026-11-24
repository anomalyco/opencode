// A missing file fails before anything is created, as a JSON error envelope with no session.
import { defineCli } from "../../cli/run"
import { nowMask, server } from "./fixture"

export default defineCli({
  args: ["run", "--format", "json", "hi", "-f", "nope.txt"],
  server: server(),
  masks: [nowMask],
})
