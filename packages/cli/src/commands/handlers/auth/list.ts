import { EOL } from "node:os"
import { Effect, Option } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { createClient, loadIntegrations } from "./shared"
import { errorMessage } from "../../../ui/prompt"

export default Runtime.handler(Commands.commands.auth.commands.list, (input) =>
  list(input).pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        process.stderr.write(errorMessage(error) + EOL)
        process.exitCode = 1
      }),
    ),
  ),
)

const list = Effect.fn("cli.auth.list")(function* (input) {
  const client = yield* createClient({ server: Option.getOrUndefined(input.server), standalone: input.standalone })
  const integrations = (yield* loadIntegrations(client)).filter((integration) => integration.connections.length > 0)
  if (input.format === "json") {
    process.stdout.write(
      JSON.stringify(
        integrations.map((integration) => ({
          id: integration.id,
          name: integration.name,
          connections: integration.connections,
        })),
        null,
        2,
      ) + EOL,
    )
    return
  }
  const rows = integrations.flatMap((integration) =>
    integration.connections.map((connection) => ({
      integration: integration.name,
      source: connection.type === "credential" ? connection.label : connection.name,
      type: connection.type === "credential" ? "stored" : "environment",
    })),
  )
  if (rows.length === 0) {
    process.stdout.write("No authenticated integrations" + EOL)
    return
  }
  const width = Math.max(...rows.map((row) => row.integration.length)) + 2
  process.stdout.write(
    rows.map((row) => row.integration.padEnd(width) + row.source.padEnd(28) + row.type).join(EOL) + EOL,
  )
})
