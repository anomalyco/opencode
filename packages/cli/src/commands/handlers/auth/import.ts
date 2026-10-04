import { EOL } from "node:os"
import { isConflictError, type CredentialCreateInput } from "@opencode/client"
import { Credential } from "@opencode/schema/credential"
import { Effect, Option, Schema } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { createClient, request } from "./shared"
import { errorMessage } from "../../../util/error"
import { readStdin } from "../../../util/io"

export default Runtime.handler(
  Commands.commands.auth.commands.import,
  Effect.fn("cli.auth.import")(
    function* (input) {
      const file = Option.getOrUndefined(input.file)
      if (!file && process.stdin.isTTY)
        return yield* Effect.fail(new Error("Pipe auth export output into stdin or pass a file to import"))
      const text = yield* request(() => (file ? Bun.file(file).text() : readStdin()))
      const credentials = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Array(Credential.Entry)))(text)
      const client = yield* createClient({ server: Option.getOrUndefined(input.server), standalone: input.standalone })
      const existing = yield* request((signal) => client.credential.list({ signal }))
      const ids = new Set(existing.map((credential) => credential.id))
      const integrations = new Set(existing.map((credential) => credential.integrationID))
      const results = yield* Effect.forEach(credentials, (credential) => {
        if (ids.has(credential.id)) return Effect.succeed(false)
        return request((signal) =>
          client.credential.create(
            {
              id: credential.id,
              integrationID: credential.integrationID,
              label: credential.label,
              // Stored metadata is JSON, but the credential schema types it as unknown while the generated client expects JSON.
              value: credential.value as CredentialCreateInput["value"],
              // Keep the destination's current selections; only integrations new to it adopt the exported selection.
              activate: credential.active && !integrations.has(credential.integrationID),
            },
            { signal },
          ),
        ).pipe(
          Effect.as(true),
          Effect.catchIf(isConflictError, () => Effect.succeed(false)),
        )
      })
      const imported = results.filter(Boolean).length
      process.stderr.write(
        `Imported ${imported} ${imported === 1 ? "credential" : "credentials"}` +
          (results.length > imported ? `, skipped ${results.length - imported} already present` : "") +
          EOL,
      )
    },
    Effect.catch((error) =>
      Effect.sync(() => {
        process.stderr.write(errorMessage(error) + EOL)
        process.exitCode = 1
      }),
    ),
  ),
)
