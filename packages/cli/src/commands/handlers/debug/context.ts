import { Effect } from "effect"
import { effectCmd, fail } from "../../effect-cmd"
import { UI } from "../../ui"

export const ContextCommand = effectCmd({
  command: "context <sessionID> [turn]",
  describe: "inspect exactly what the model saw for a past turn",
  builder: (yargs) =>
    yargs
      .positional("sessionID", {
        describe: "session ID to inspect",
        type: "string",
        demandOption: true,
      })
      .positional("turn", {
        describe: "recorded turn number from the listing; omit to list recorded turns",
        type: "number",
      }),
  handler: Effect.fn("Cli.debug.context")(function* (args) {
    const { SessionReplay } = yield* Effect.promise(() => import("@/session/replay"))
    const entries = yield* Effect.promise(() => SessionReplay.list(args.sessionID))
    if (!entries.length)
      return yield* fail(
        `No recorded context for session ${args.sessionID}. Set experimental.context_replay to true to record requests.`,
      )
    if (args.turn === undefined) {
      entries.forEach((entry, index) => {
        UI.println(`${index + 1}  ${entry}`)
      })
      return
    }
    const entry = entries[args.turn - 1]
    if (!entry) return yield* fail(`Turn ${args.turn} not found (${entries.length} recorded)`)
    const item = yield* Effect.promise(() => SessionReplay.load(args.sessionID, entry))
    process.stdout.write(JSON.stringify(item, null, 2) + "\n")
  }),
})
