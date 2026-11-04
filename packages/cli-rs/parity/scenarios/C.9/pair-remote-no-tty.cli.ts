// `pair --remote` for the first time without a terminal and without --yes: the warning, and exit 1. Nothing is
// written and no tunnel is created.
import { defineCli } from "../../cli/run"
import { env, script } from "../C.8/fixture"

export default defineCli({
  args: [],
  command: script([["pair", "--remote"]], { cat: true }),
  env,
})
