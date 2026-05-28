import { Duration, Effect, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"

const McpResult = Schema.Struct({
  result: Schema.Struct({
    content: Schema.Array(
      Schema.Struct({
        type: Schema.String,
        text: Schema.String,
      }),
    ),
  }),
})

const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(McpResult))

const parsePayload = (payload: string) =>
  Effect.gen(function* () {
    const trimmed = payload.trim()
    if (!trimmed.startsWith("{")) return undefined
    const data = yield* decode(trimmed)
    return data.result.content.find((item) => item.text)?.text
  })

export const parseResponse = Effect.fn("McpWebSearch.parseResponse")(function* (body: string) {
  const trimmed = body.trim()
  const direct = trimmed ? yield* parsePayload(trimmed) : undefined
  if (direct) return direct

  for (const line of body.split("\n")) {
    if (!line.startsWith("data: ")) continue
    const data = yield* parsePayload(line.substring(6))
    if (data) return data
  }
  return undefined
})

const McpRequest = Schema.Struct({
  jsonrpc: Schema.Literal("2.0"),
  id: Schema.Literal(1),
  method: Schema.Literal("tools/call"),
  params: Schema.Struct({
    name: Schema.String,
    arguments: Schema.Unknown,
  }),
})

export interface CallInput {
  url: string
  tool: string
  args: unknown
  headers?: Record<string, string>
  timeout: Duration.Input
}

export const call = (http: HttpClient.HttpClient, input: CallInput) =>
  Effect.gen(function* () {
    const request = yield* HttpClientRequest.post(input.url).pipe(
      HttpClientRequest.accept("application/json, text/event-stream"),
      HttpClientRequest.setHeaders(input.headers ?? {}),
      HttpClientRequest.schemaBodyJson(McpRequest)({
        jsonrpc: "2.0" as const,
        id: 1 as const,
        method: "tools/call" as const,
        params: { name: input.tool, arguments: input.args },
      }),
    )
    const response = yield* HttpClient.filterStatusOk(http)
      .execute(request)
      .pipe(
        Effect.timeoutOrElse({
          duration: input.timeout,
          orElse: () => Effect.die(new Error(`${input.tool} request timed out`)),
        }),
      )
    const body = yield* response.text
    return yield* parseResponse(body)
  })
