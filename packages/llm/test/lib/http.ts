import { Effect, Layer } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { RequestExecutor } from "../../src/executor"

export type HandlerInput = {
  readonly request: HttpClientRequest.HttpClientRequest
  readonly text: string
}

export type Handler = (input: HandlerInput) => Effect.Effect<Response>

const handlerLayer = (handler: Handler): Layer.Layer<HttpClient.HttpClient> =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.gen(function* () {
        const web = yield* HttpClientRequest.toWeb(request).pipe(Effect.orDie)
        const text = yield* Effect.promise(() => web.text())
        const response = yield* handler({ request, text })
        return HttpClientResponse.fromWeb(request, response)
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
  executorWith(handlerLayer(() => Effect.succeed(new Response(body, init))))

/**
 * Layer that builds a response per request. Useful for echo servers.
 */
export const dynamicResponse = (handler: Handler) => executorWith(handlerLayer(handler))

/**
 * Layer that emits the supplied SSE chunks and then aborts mid-stream. Used to
 * exercise transport errors that surface during parsing.
 */
export const truncatedStream = (chunks: ReadonlyArray<string>) =>
  dynamicResponse(() =>
    Effect.sync(() => {
      const encoder = new TextEncoder()
      const stream = new ReadableStream({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
          controller.error(new Error("connection reset"))
        },
      })
      return new Response(stream, { headers: SSE_HEADERS })
    }),
  )
