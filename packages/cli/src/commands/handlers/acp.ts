import { MessageTooLargeError, ndJsonStream } from "@agentclientprotocol/sdk"
import { OpenCode } from "@opencode/client/effect"
import { Service } from "@opencode/client/effect/service"
import { CrossSpawnSpawner } from "@opencode/util/cross-spawn-spawner"
import { Effect } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http"
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
    const client = yield* OpenCode.make({ baseUrl: endpoint.url }).pipe(
      Effect.provideServiceEffect(
        HttpClient.HttpClient,
        HttpClient.HttpClient.pipe(
          Effect.map(HttpClient.mapRequest(HttpClientRequest.setHeaders(Service.headers(endpoint) ?? {}))),
        ),
      ),
      Effect.provide(FetchHttpClient.layer),
    )
    const connection = yield* ACP.connect(client, ndJsonStream(Writable.toWeb(process.stdout), Bun.stdin.stream()))
    const failure = yield* Effect.raceFirst(
      Effect.promise(() => connection.closed).pipe(
        Effect.map(() =>
          connection.signal.reason instanceof MessageTooLargeError
            ? `incoming message exceeded the ${connection.signal.reason.maxMessageBytes / 1024 / 1024} MiB limit`
            : undefined,
        ),
      ),
      endpoint.exited.pipe(
        Effect.match({
          onSuccess: (code) => `code ${code}`,
          onFailure: (error) =>
            error.cause instanceof CrossSpawnSpawner.KilledBySignal ? `signal ${error.cause.signal}` : error.message,
        }),
        Effect.map((reason) => `server exited unexpectedly (${reason})`),
      ),
    )
    // Exit directly: closing the scope would wait on the server's graceful shutdown, and its lease pipe ends it anyway.
    yield* Effect.sync(() => {
      if (failure) process.stderr.write(`opencode acp: ${failure}\n`)
      process.exit(failure ? 1 : 0)
    })
  }),
)
