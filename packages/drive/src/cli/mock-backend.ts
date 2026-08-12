import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import type { Backend } from "../client/protocol.js"
import { logError } from "../log.js"
import * as SimulationConnector from "../simulation/connector.js"
import { generateResponse } from "./response-generator.js"
import type { createResponseSettings } from "./response-generator.js"

const connectTimeout = 30_000

export async function connectMockBackend(
  endpoint: string,
  responses: ReturnType<typeof createResponseSettings>,
) {
  const scope = await Effect.runPromise(Scope.make())
  const connect = Effect.gen(function* () {
    const backend = yield* SimulationConnector.backend(endpoint, {
      connectTimeout,
      requestTimeout: connectTimeout,
      attach: false,
    })
    yield* backend.requests.pipe(
      Stream.runForEach((request) =>
        respond(backend, request, responses).pipe(
          Effect.matchCauseEffect({
            onFailure: (cause) => Effect.sync(() => logError(String(cause))),
            onSuccess: () => Effect.void,
          }),
          Effect.forkIn(scope),
        ),
      ),
      Effect.forkIn(scope),
    )
    yield* backend.attach()
  })
  try {
    await Effect.runPromise(connect.pipe(Scope.provide(scope)))
  } catch (cause) {
    await Effect.runPromise(Scope.close(scope, Exit.void))
    throw cause
  }
  return {
    close() {
      Effect.runFork(Scope.close(scope, Exit.void))
    },
  }
}

const respond = Effect.fn("DriveCli.mockRespond")(function* (
  backend: SimulationConnector.BackendConnection,
  request: Backend.OpenedExchange,
  responses: ReturnType<typeof createResponseSettings>,
) {
  const response = generateResponse(responses.current(), request)
  for (const item of response.items) {
    if (item.type !== "textDelta" && item.type !== "reasoningDelta") {
      yield* backend.rpc["llm.chunk"]({ id: request.id, items: [item] })
      continue
    }
    for (const text of splitText(item.text)) {
      yield* backend.rpc["llm.chunk"]({ id: request.id, items: [{ ...item, text }] })
      yield* Effect.sleep(45 + Math.floor(Math.random() * 35))
    }
  }
  yield* backend.rpc["llm.finish"]({ id: request.id, reason: response.finish })
})

export function splitText(text: string) {
  const words = text.match(/\S+\s*/g) ?? [text]
  return Array.from(
    { length: Math.ceil(words.length / 3) },
    (_, index) => words.slice(index * 3, index * 3 + 3).join(""),
  )
}
