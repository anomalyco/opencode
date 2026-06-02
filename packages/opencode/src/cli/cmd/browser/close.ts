import { EOL } from "os"
import { Effect } from "effect"
import { effectCmd, fail } from "../../effect-cmd"
import { engine } from "@/tool/browser/engine"

export const BrowserCloseCommand = effectCmd({
  command: "close [index]",
  describe: "close a browser session by index or all sessions",
  builder: (yargs) =>
    yargs
      .positional("index", {
        describe: "1-based index of the browser session to close (see `list`)",
        type: "number",
      })
      .option("all", {
        describe: "close all active browser sessions",
        type: "boolean",
        default: false,
      }),
  handler: Effect.fn("Cli.BrowserClose")(function* (args) {
    if (args.all) {
      yield* Effect.promise(() => engine.dispose())
      process.stdout.write("All browser sessions closed" + EOL)
      return
    }

    const index = args.index
    if (index == null) {
      return yield* fail("Provide a session index or use --all to close all sessions")
    }

    if (!Number.isInteger(index) || index < 1) {
      return yield* fail(`Invalid index: ${index}. Index must be a positive integer (1-based)`)
    }

    const sessions = yield* Effect.sync(() => engine.list())

    if (index > sessions.length) {
      return yield* fail(`Index ${index} out of range. There are ${sessions.length} active session(s)`)
    }

    const session = sessions[index - 1]
    yield* Effect.promise(() => engine.close(session.id))
    process.stdout.write(`Browser session ${session.id} closed` + EOL)
  }),
})
