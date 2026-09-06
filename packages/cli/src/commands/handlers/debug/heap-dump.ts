import { ClientError, OpenCode } from "@opencode-ai/client"
import { Service } from "@opencode-ai/client/effect/service"
import { Effect, Predicate } from "effect"
import { EOL } from "node:os"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServiceConfig } from "../../../services/service-config"
import { errorMessage } from "../../../util/error"

export default Runtime.handler(
  Commands.commands.debug.commands["heap-dump"],
  Effect.fn("cli.debug.heap-dump")(
    function* () {
      const options = yield* ServiceConfig.options()
      const endpoint = yield* Service.discover({ ...options, version: undefined })
      if (!endpoint) return yield* Effect.fail(new Error("Could not connect to a running OpenCode background server."))
      const client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) })
      const snapshot = yield* Effect.tryPromise({
        try: (signal) => client.debug.heapDump({ signal }),
        catch: (cause) =>
          cause instanceof ClientError &&
          cause.reason === "UnexpectedStatus" &&
          Predicate.hasProperty(cause.cause, "status") &&
          cause.cause.status === 404
            ? new Error("The running server does not support heap-dump. Update and restart it first.")
            : new Error(errorMessage(cause), { cause }),
      })
      return yield* Effect.sync(() => {
        process.stdout.write(snapshot.path + EOL)
      })
    },
    Effect.catch((error) =>
      Effect.sync(() => {
        process.stderr.write(errorMessage(error) + EOL)
        process.exitCode = 1
      }),
    ),
  ),
)
