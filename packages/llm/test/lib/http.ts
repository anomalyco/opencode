import { Effect, Layer, Ref } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { RequestExecutor } from "../../src/executor"

export type HandlerInput = {
  readonly request: HttpClientRequest.HttpClientRequest
  readonly text: string
  readonly respond: (body: ConstructorParameters<typeof Response>[0], init?: ResponseInit) => HttpClientResponse.HttpClientResponse
}

export type Handler = (input: HandlerInput) => Effect.Effect<HttpClientResponse.HttpClientResponse>

const handlerLayer = (handler: Handler): Layer.Layer<HttpClient.HttpClient> =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.gen(function* () {
        const web = yield* HttpClientRequest.toWeb(request).pipe(Effect.orDie)
        const text = yield* Effect.promise(() => web.text())
        return yield* handler({
          request,
          text,
          respond: (body, init) => HttpClientResponse.fromWeb(request, new Response(body, init)),
        })
      }),
    ),
  )

const executorWith = (layer: Layer.Layer<HttpClient.HttpClient>) =>
  RequestExecutor.layer.pipe(Layer.provide(layer))

const SSE_HEADERS = { "content-type": "text/event-stream" } as const

/**
 * Layer that returns a single fixed response body. Use for stream-parser
 * fixture tests where the request shape is irrelevant.
 */
export const fixedResponse = (body: string, init: ResponseInit = { headers: SSE_HEADERS }) =>
  executorWith(handlerLayer((input) => Effect.succeed(input.respond(body, init))))

/**
 * Layer that builds a response per request. Useful for echo servers.
 */
export const dynamicResponse = (handler: Handler) => executorWith(handlerLayer(handler))

/**
 * Layer that emits the supplied SSE chunks and then aborts mid-stream. Used to
 * exercise transport errors that surface during parsing.
 */
export const truncatedStream = (chunks: ReadonlyArray<string>) =>
  dynamicResponse((input) =>
    Effect.sync(() => {
      const encoder = new TextEncoder()
      const stream = new ReadableStream({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
          controller.error(new Error("connection reset"))
        },
      })
      return input.respond(stream, { headers: SSE_HEADERS })
    }),
  )

/**
 * Layer that returns successive bodies on each request. Useful for scripting
 * multi-step model exchanges (e.g. tool-call loops). The last body in the
 * array is reused if the test makes more requests than scripted.
 */
export const scriptedResponses = (bodies: ReadonlyArray<string>, init: ResponseInit = { headers: SSE_HEADERS }) => {
  if (bodies.length === 0) throw new Error("scriptedResponses requires at least one body")
  return Layer.unwrap(
    Effect.gen(function* () {
      const cursor = yield* Ref.make(0)
      return dynamicResponse((input) =>
        Effect.gen(function* () {
          const index = yield* Ref.getAndUpdate(cursor, (n) => n + 1)
          return input.respond(bodies[index] ?? bodies[bodies.length - 1], init)
        }),
      )
    }),
  )
}
