import { Effect } from "effect"
import { effectCmd } from "../effect-cmd"
import { UI } from "../ui"

export const HookCommand = effectCmd({
  command: "hook",
  describe: "manage opencode hooks",
  instance: false,
  handler: Effect.fn("Cli.hook")(function* () {
    UI.println("hooks are configured in your opencode config file under the 'hooks' key")
  }),
})
