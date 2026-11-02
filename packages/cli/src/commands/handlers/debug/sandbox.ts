import { EOL } from "node:os"
import { ClientError, OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/effect/service"
import { Effect, Predicate } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServerConnection } from "../../../services/server-connection"

export default Runtime.handler(
  Commands.commands.debug.commands.sandbox,
  Effect.fn("cli.debug.sandbox")(function* () {
    const { endpoint } = yield* ServerConnection.resolve()
    const client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) })
    const status = yield* Effect.tryPromise({
      try: (signal) => client.experimental.sandbox.status({ location: { directory: process.cwd() } }, { signal }),
      catch: (cause) =>
        cause instanceof ClientError &&
        cause.reason === "UnexpectedStatus" &&
        Predicate.hasProperty(cause.cause, "status") &&
        cause.cause.status === 404
          ? new Error(
              "The connected server cannot report sandbox status. Update and restart it; enforcement is unknown.",
            )
          : cause,
    })
    process.stdout.write(JSON.stringify(status, null, 2) + EOL)
  }),
)
