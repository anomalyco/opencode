import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { Effect } from "effect"

export default Runtime.handler(Commands, () =>
  Effect.gen(function* () {
    console.log("TUI is not available. Use 'opencode serve' to run a headless server.")
  }),
)
