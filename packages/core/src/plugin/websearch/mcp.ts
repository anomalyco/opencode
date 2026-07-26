export * as WebSearchMcp from "./mcp"

import { Duration, Effect, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { collectBoundedResponseBody } from "../../tool/http-body"

export const MAX_RESPONSE_BYTES = 256 * 1024

export const parseResponse = <F extends Schema.Struct.Fields>(body: string, result: Schema.Struct<F>) => {
  const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Struct({ result })))
  const parse = (payload: string) => {
    const trimmed = payload.trim()
    if (!trimmed.startsWith("{")) return Effect.succeed(undefined)
    return decode(trimmed).pipe(Effect.map((response) => response.result))
  }
  return Effect.gen(function* () {
    const trimmed = body.trim()
    const direct = trimmed ? yield* parse(trimmed) : undefined
    if (direct) return direct
    for (const line of body.split("\n")) {
      if (!line.startsWith("data: ")) continue
      const data = yield* parse(line.substring(6))
      if (data) return data
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
        jsonrpc: "2.0" as const,
        id: 1 as const,
        method: "tools/call" as const,
        params: { name: tool, arguments: value },
      }),
    )
    return yield* Effect.gen(function* () {
      const response = yield* HttpClient.filterStatusOk(http).execute(request)
      const body = yield* collectBoundedResponseBody(
        response,
        MAX_RESPONSE_BYTES,
        () => new Error(`${tool} response exceeded ${MAX_RESPONSE_BYTES} bytes`),
      )
      return yield* parseResponse(body.toString("utf8"), schema.output)
    }).pipe(
      Effect.timeoutOrElse({
        duration: Duration.seconds(25),
        orElse: () => Effect.fail(new Error(`${tool} request timed out`)),
      }),
    )
  })
