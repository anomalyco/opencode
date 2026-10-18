export * as WebSearchMcp from "./mcp.js"

import { Duration, Effect, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import { collectBoundedResponseBody } from "../../tool/http-body.js"

export const MAX_RESPONSE_BYTES = 256 * 1024

// MCP servers report tool failures, such as an exhausted keyless quota, as a 200 response with `isError`.
export class ToolError extends Schema.TaggedError<ToolError>()("WebSearchMcp.ToolError", {
  message: Schema.String,
}) {}

const ToolStatus = Schema.Struct({
  isError: Schema.Boolean.pipe(Schema.optional),
  content: Schema.Array(Schema.Struct({ text: Schema.String.pipe(Schema.optional) })).pipe(Schema.optional),
})

export const parseResponse = <F extends Schema.Struct.Fields>(body: string, result: Schema.Struct<F>) => {
  const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Struct({ result })))
  const parse = (payload: string) => {
    const trimmed = payload.trim()
    if (!trimmed.startsWith("{")) return Effect.undefined
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
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: tool, arguments: value },
      }),
    )
    return yield* Effect.gen(function* () {
      const response = yield* HttpClient.withScope(HttpClient.filterStatusOk(http)).execute(request)
      const body = yield* collectBoundedResponseBody(
        response,
        MAX_RESPONSE_BYTES,
        () => new Error(`${tool} response exceeded ${MAX_RESPONSE_BYTES} bytes`),
      )
      const text = body.toString("utf8")
      const status = yield* parseResponse(text, ToolStatus)
      if (status?.isError)
        return yield* new ToolError({
          message:
            status.content?.flatMap((item) => (item.text ? [item.text] : [])).join("\n") || `${tool} returned an error`,
        })
      return yield* parseResponse(text, schema.output)
    }).pipe(
      Effect.scoped,
      Effect.timeoutOrElse({
        duration: Duration.seconds(25),
        orElse: () => Effect.fail(new Error(`${tool} request timed out`)),
      }),
    )
  })
