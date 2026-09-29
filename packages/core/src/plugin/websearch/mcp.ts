export * as WebSearchMcp from "./mcp.js"

import { Duration, Effect, Option, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { WebSearchResponse } from "./response.js"

export const parseResponse = <F extends Schema.Struct.Fields>(
  body: { readonly text: string; readonly truncated: boolean },
  tool: string,
  result: Schema.Struct<F>,
) => {
  const decode = Schema.decodeUnknownEffect(Schema.Struct({ result }))
  return Effect.gen(function* () {
    for (const payload of WebSearchResponse.payloads(body.text)) {
      const message = WebSearchResponse.json(payload, body.truncated)
      if (Option.isNone(message)) return yield* Effect.fail(new Error(`${tool} returned invalid JSON`))
      const failure = WebSearchResponse.failure(message.value)
      if (failure !== undefined) return yield* Effect.fail(new Error(failure))
      return (yield* decode(message.value)).result
    }
  })
}

export const call = <F extends Schema.Struct.Fields, R extends Schema.Struct.Fields>(
  http: HttpClient.HttpClient,
  url: string,
  tool: string,
  schema: { readonly input: Schema.Struct<F>; readonly output: Schema.Struct<R> },
  value: Schema.Struct.Type<F>,
  headers: Record<string, string> = {},
) =>
  Effect.gen(function* () {
    const request = yield* HttpClientRequest.post(url).pipe(
      HttpClientRequest.accept("application/json, text/event-stream"),
      HttpClientRequest.setHeaders(headers),
      HttpClientRequest.schemaBodyJson(
        Schema.Struct({
          jsonrpc: Schema.Literal("2.0"),
          id: Schema.Literal(1),
          method: Schema.Literal("tools/call"),
          params: Schema.Struct({ name: Schema.String, arguments: schema.input }),
        }),
      )({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: tool, arguments: value },
      }),
    )
    return yield* Effect.gen(function* () {
      const body = yield* WebSearchResponse.execute(http, request)
      return { result: yield* parseResponse(body, tool, schema.output), truncated: body.truncated }
    }).pipe(
      Effect.scoped,
      Effect.timeoutOrElse({
        duration: Duration.seconds(25),
        orElse: () => Effect.fail(new Error(`${tool} request timed out`)),
      }),
    )
  })
