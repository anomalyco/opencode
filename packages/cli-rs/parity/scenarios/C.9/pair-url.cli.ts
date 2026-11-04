// `pair --url`: the given external URL replaces the server's, and there is no SSH hint.
import { defineCli } from "../../cli/run"
import { env, info, only, pairRoute, register } from "../C.8/fixture"

export default defineCli({
  args: [],
  command: only(["pair", "--url", "https://opencode.example/base/"]),
  env,
  server: { version: false, routes: [info(["http://127.0.0.1:4096"]), pairRoute] },
  setup: register,
})
