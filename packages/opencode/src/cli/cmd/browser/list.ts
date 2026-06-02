import { EOL } from "os"
import { Effect } from "effect"
import { effectCmd, fail } from "../../effect-cmd"
import { engine } from "@/tool/browser/engine"

export const BrowserListCommand = effectCmd({
  command: "list",
  describe: "list active browser sessions",
  builder: (yargs) =>
    yargs.option("format", {
      describe: "output format",
      type: "string",
      choices: ["table", "json"],
      default: "table",
    }),
  handler: Effect.fn("Cli.BrowserList")(function* (args) {
    const sessions = yield* Effect.sync(() => engine.list())

    if (sessions.length === 0) {
      return yield* fail("No active browser sessions")
    }

    if (args.format === "json") {
      process.stdout.write(JSON.stringify(sessions, null, 2) + EOL)
      return
    }

    const idWidth = 20
    const urlWidth = 60

    process.stdout.write(
      "ID".padEnd(idWidth) + "URL" + EOL,
    )
    process.stdout.write("─".repeat(idWidth + urlWidth) + EOL)

    for (const session of sessions) {
      const url = session.url.length > urlWidth - 2
        ? session.url.slice(0, urlWidth - 3) + "..."
        : session.url
      process.stdout.write(session.id.padEnd(idWidth) + url + EOL)
    }

    process.stdout.write(EOL + `${sessions.length} session(s) active` + EOL)
  }),
})
