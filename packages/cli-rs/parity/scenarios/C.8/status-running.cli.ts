// `service status` of a registered service that answers: its URL.
import { defineCli } from "../../cli/run"
import { env, info, only, register } from "./fixture"

export default defineCli({
  args: [],
  command: only(["service", "status"]),
  env,
  server: { version: false, routes: [info([])] },
  setup: register,
})
