import { Duration, Effect, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"

export const EXA_URL = process.env.EXA_API_KEY
  ? `https://mcp.exa.ai/mcp?exaApiKey=${encodeURIComponent(process.env.EXA_API_KEY)}`
  : "https://mcp.exa.ai/mcp"
export const PARALLEL_URL = "https://search.parallel.ai/mcp"

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

const McpError = Schema.Struct({
  error: Schema.Struct({
    message: Schema.String,
  }),
})

const decodeResult = Schema.decodeUnknownEffect(Schema.fromJsonString(McpResult))
const decodeError = Schema.decodeUnknownEffect(Schema.fromJsonString(McpError))

// A payload can be the tools/call result, a JSON-RPC error, or an unrelated
// event (progress/notification frames that MCP servers interleave on the same
// stream). Only the first two are meaningful here; anything that fails to
// decode is skipped so a stray frame cannot fail the whole search.
const parsePayload = (payload: string) =>
  Effect.gen(function* () {
    const trimmed = payload.trim()
    if (!trimmed.startsWith("{")) return undefined
    const data = yield* decodeResult(trimmed).pipe(Effect.orElseSucceed(() => undefined))
    if (data) return data.result.content.find((item) => item.text)?.text
    const failure = yield* decodeError(trimmed).pipe(Effect.orElseSucceed(() => undefined))
    if (failure) return yield* Effect.fail(new Error(`Web search failed: ${failure.error.message}`))
    return undefined
  })

export const parseResponse = Effect.fn("McpWebSearch.parseResponse")(function* (body: string) {
  const trimmed = body.trim()
  const direct = trimmed ? yield* parsePayload(trimmed) : undefined
  if (direct) return direct

  for (const line of body.split("\n")) {
    // Per the SSE spec the field name is "data:" and a single leading space in
    // the value is optional — accept both forms.
    if (!line.startsWith("data:")) continue
    const data = yield* parsePayload(line.slice(5).replace(/^ /, ""))
    if (data) return data
  }
  return undefined
})

export const SearchArgs = Schema.Struct({
  query: Schema.String,
  type: Schema.String,
  numResults: Schema.Number,
  livecrawl: Schema.String,
  contextMaxCharacters: Schema.optional(Schema.Number),
})

export const ParallelSearchArgs = Schema.Struct({
  objective: Schema.String,
  search_queries: Schema.Array(Schema.String),
  session_id: Schema.optional(Schema.String),
  model_name: Schema.optional(Schema.String),
})

const McpRequest = <F extends Schema.Struct.Fields>(args: Schema.Struct<F>) =>
  Schema.Struct({
    jsonrpc: Schema.Literal("2.0"),
    id: Schema.Literal(1),
    method: Schema.Literal("tools/call"),
    params: Schema.Struct({
      name: Schema.String,
      arguments: args,
    }),
  })

export const call = <F extends Schema.Struct.Fields>(
  http: HttpClient.HttpClient,
  url: string,
  tool: string,
  args: Schema.Struct<F>,
  value: Schema.Struct.Type<F>,
  timeout: Duration.Input,
  headers?: Record<string, string>,
) =>
  Effect.gen(function* () {
    const request = yield* HttpClientRequest.post(url).pipe(
      HttpClientRequest.accept("application/json, text/event-stream"),
      HttpClientRequest.setHeaders(headers ?? {}),
      HttpClientRequest.schemaBodyJson(McpRequest(args))({
        jsonrpc: "2.0" as const,
        id: 1 as const,
        method: "tools/call" as const,
        params: { name: tool, arguments: value },
      }),
    )
    const response = yield* HttpClient.filterStatusOk(http)
      .execute(request)
      .pipe(
        Effect.timeoutOrElse({ duration: timeout, orElse: () => Effect.die(new Error(`${tool} request timed out`)) }),
      )
    const body = yield* response.text
    return yield* parseResponse(body)
  })
