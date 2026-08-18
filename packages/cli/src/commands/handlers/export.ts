import { autocomplete, cancel, intro, isCancel, log, outro } from "@clack/prompts"
import { OpenCode } from "@opencode-ai/client"
import { Service } from "@opencode-ai/client/effect/service"
import { Effect, Option } from "effect"
import { EOL } from "node:os"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { ServerConnection } from "../../services/server-connection"

export default Runtime.handler(
  Commands.commands.export,
  Effect.fn("cli.export")(function* (input) {
    const server = yield* ServerConnection.resolve({
      server: Option.getOrUndefined(input.server),
      standalone: input.standalone,
    })
    const client = OpenCode.make({
      baseUrl: server.endpoint.url,
      headers: Service.headers(server.endpoint),
    })
    const requested = Option.getOrUndefined(input.session)
    const sessionID = requested
      ? requested
      : yield* Effect.gen(function* () {
          intro("Export session", { output: process.stderr })
          const location = yield* Effect.promise(() => client.location.get({ location: { directory: process.cwd() } }))
          const page = yield* Effect.promise(() =>
            client.session.list({
              directory: location.directory,
              workspace: location.workspaceID,
              parentID: null,
              order: "desc",
              limit: 50,
            }),
          )
          if (page.data.length === 0) {
            log.error("No sessions found", { output: process.stderr })
            outro("Done", { output: process.stderr })
            return undefined
          }
          const selected = yield* Effect.promise(() =>
            autocomplete({
              message: "Select session to export",
              maxItems: 10,
              options: page.data.map((session) => ({
                label: session.title,
                value: session.id,
                hint: `${new Date(session.time.updated).toLocaleString()} - ${session.id.slice(-8)}`,
              })),
              output: process.stderr,
            }),
          )
          if (isCancel(selected)) {
            cancel("Cancelled", { output: process.stderr })
            process.exitCode = 130
            return undefined
          }
          outro("Exporting session...", { output: process.stderr })
          return selected
        })
    if (!sessionID) return
    const data = yield* Effect.promise(() => client.session.export({ sessionID, sanitize: input.sanitize }))
    process.stdout.write(JSON.stringify(data, null, 2) + EOL)
  }),
)
