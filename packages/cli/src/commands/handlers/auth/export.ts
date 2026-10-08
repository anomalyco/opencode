import { EOL } from "node:os"
import { Effect, Option } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { createClient, loadIntegrations, request, resolveIntegration } from "./shared"
import { errorMessage } from "../../../util/error"

export default Runtime.handler(
  Commands.commands.auth.commands.export,
  Effect.fn("cli.auth.export")(
    function* (input) {
      const client = yield* createClient({ server: Option.getOrUndefined(input.server), standalone: input.standalone })
      const target = Option.getOrUndefined(input.target)
      const integrationID = target ? (yield* resolveIntegration(yield* loadIntegrations(client), target)).id : undefined
      const credentials = (yield* request((signal) => client.credential.list({ signal }))).filter(
        (credential) => !integrationID || credential.integrationID === integrationID,
      )
      if (process.stdout.isTTY)
        process.stderr.write(
          "Warning: the output contains secrets; redirect it to a file or pipe it to auth import" + EOL,
        )
      process.stdout.write(JSON.stringify(credentials, null, 2) + EOL)
    },
    Effect.catch((error) =>
      Effect.sync(() => {
        process.stderr.write(errorMessage(error) + EOL)
        process.exitCode = 1
      }),
    ),
  ),
)
