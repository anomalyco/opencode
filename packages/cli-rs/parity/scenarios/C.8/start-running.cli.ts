// `service start` with a ready service registered: it is reused, and its URL printed.
import { defineCli } from "../../cli/run"
import { env, info, only, register } from "./fixture"

export default defineCli({
  args: [],
  command: only(["service", "start"]),
  env,
  server: { version: false, routes: [info([])] },
  setup: register,
})
