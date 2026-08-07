import { isConflictError, OpenCode, type SessionTransferImportInput } from "@opencode-ai/client"
import { Service } from "@opencode-ai/client/effect/service"
import { SessionTransfer } from "@opencode-ai/schema/session-transfer"
import { Effect, Option, Schema } from "effect"
import { EOL } from "node:os"
import path from "node:path"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { ServerConnection } from "../../services/server-connection"

export default Runtime.handler(
  Commands.commands.import,
  Effect.fn("cli.import")(function* (input) {
    const text = yield* Effect.tryPromise({
      try: () =>
        input.file.startsWith("http://") || input.file.startsWith("https://")
          ? fetch(input.file).then((response) => {
              if (!response.ok) throw new Error(`Failed to fetch session data: ${response.statusText}`)
              return response.text()
            })
          : Bun.file(input.file).text(),
      catch: (cause) =>
        new Error(`Failed to read session data: ${cause instanceof Error ? cause.message : String(cause)}`),
    })
    const data = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(SessionTransfer.Data))(text)
    const encoded = Schema.encodeSync(SessionTransfer.Data)(data) as SessionTransferImportInput
    const server = yield* ServerConnection.resolve({
      server: Option.getOrUndefined(input.server),
      standalone: input.standalone,
    })
    const client = OpenCode.make({
      baseUrl: server.endpoint.url,
      headers: Service.headers(server.endpoint),
    })
    const location = yield* Effect.promise(() =>
      client.location.get({
        location: { directory: path.resolve(Option.getOrElse(input.directory, () => process.cwd())) },
      }),
    )
    const imported = yield* Effect.tryPromise({
      try: () =>
        client.sessionTransfer.import({
          ...encoded,
          location: { directory: location.directory, workspaceID: location.workspaceID },
        }),
      catch: (cause) => cause,
    }).pipe(Effect.catchIf(isConflictError, () => Effect.succeed(undefined)))
    if (!imported) {
      process.stderr.write(`Session already exists${EOL}`)
      return
    }
    process.stdout.write(`Imported session: ${imported.id}${EOL}`)
  }),
)
