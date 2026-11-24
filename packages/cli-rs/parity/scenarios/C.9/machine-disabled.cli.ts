// `machine` needs the background service: with it disabled, each subcommand says so before connecting.
import { defineCli } from "../../cli/run"
import { env, script, writeConfig } from "../C.8/fixture"

export default defineCli({
  args: [],
  command: script([
    ["machine", "list"],
    ["machine", "remove", "gpu"],
  ]),
  env,
  setup: (root) => writeConfig(root, { disabled: true }),
})
