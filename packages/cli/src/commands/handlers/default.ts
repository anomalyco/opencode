import { App } from "../../tui/app"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { Effect } from "effect"

export default Runtime.handler(Commands, () =>
  Effect.gen(function* () {
    yield* App
  }),
)
