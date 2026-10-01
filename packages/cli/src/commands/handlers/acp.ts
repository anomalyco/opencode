import { ndJsonStream } from "@agentclientprotocol/sdk"
import { OpenCode } from "@opencode/client/promise"
import { Service } from "@opencode/client/effect/service"
import { CrossSpawnSpawner } from "@opencode/util/cross-spawn-spawner"
import { Effect } from "effect"
import { Writable } from "node:stream"
import { ACP } from "../../acp/agent"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { Standalone } from "../../services/standalone"

export default Runtime.handler(
  Commands.commands.acp,
  Effect.fn("cli.acp")(function* () {
    process.env.OPENCODE_CLIENT = "acp"
    const endpoint = yield* Standalone.start()
    const client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) })
    const connection = yield* ACP.connect(client, ndJsonStream(Writable.toWeb(process.stdout), Bun.stdin.stream()))
    const code = yield* Effect.raceFirst(
      Effect.promise(() => connection.closed).pipe(Effect.as(0)),
      endpoint.exited.pipe(
        Effect.match({
          onSuccess: (code) => `code ${code}`,
          onFailure: (error) =>
            error.cause instanceof CrossSpawnSpawner.KilledBySignal ? `signal ${error.cause.signal}` : error.message,
        }),
        // stdout carries ACP, so the diagnostic goes to stderr.
        Effect.flatMap((reason) =>
          Effect.sync(() => {
            process.stderr.write(`opencode acp: server exited unexpectedly (${reason})\n`)
            return 1
          }),
        ),
      ),
    )
    // Closing the handler scope would wait for the private server's graceful shutdown; its lease pipe already
    // ends the server once this process exits.
    yield* Effect.sync(() => process.exit(code))
  }),
)
