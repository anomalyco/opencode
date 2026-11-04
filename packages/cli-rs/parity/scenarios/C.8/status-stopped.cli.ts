// `service status` and `service stop` with nothing registered.
import { defineCli } from "../../cli/run"
import { env, script } from "./fixture"

export default defineCli({
  args: [],
  command: script([["service", "status"], ["service", "stop"], ["service", "status"]]),
  env,
})
