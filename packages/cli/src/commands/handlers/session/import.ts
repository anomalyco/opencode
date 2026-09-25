import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/effect/service"
import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import { SessionTransfer } from "@opencode/schema/session-transfer"
import { Effect, Option, Predicate, Schema } from "effect"
import { EOL } from "node:os"
import path from "node:path"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServerConnection } from "../../../services/server-connection"

export default Runtime.handler(
  Commands.commands.session.commands.import,
  Effect.fn("cli.session.import")(function* (input) {
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
    const raw = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))(text)
    // Exports written before provider blobs were renamed to `native` still carry the old keys.
    const data = yield* Schema.decodeUnknownEffect(SessionTransfer.Data)(
      Predicate.isObject(raw) && Array.isArray(raw.messages)
        ? { ...raw, messages: raw.messages.map(SessionMessage.persisted) }
        : raw,
    )
    const encoded = Schema.encodeSync(SessionTransfer.Data)(data)
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
    const response = yield* Effect.promise(() =>
      fetch(new URL("/api/experimental/session/import", server.endpoint.url), {
        method: "POST",
        headers: { ...Service.headers(server.endpoint), "content-type": "application/json" },
        body: JSON.stringify({
          ...encoded,
          location: { directory: location.directory },
        }),
      }),
    )
    if (response.status === 409) {
      process.stderr.write(`Session already exists${EOL}`)
      return
    }
    if (!response.ok) yield* Effect.fail(new Error(`Failed to import session: ${response.statusText}`))
    const imported = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Struct({ data: Session.Info })))(
      yield* Effect.promise(() => response.text()),
    )
    process.stdout.write(`Imported session: ${imported.data.id}${EOL}`)
  }),
)
