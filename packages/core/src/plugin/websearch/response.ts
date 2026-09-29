export * as WebSearchResponse from "./response.js"

import { parseJSON } from "@opencode/ai/protocols/utils/partial-json"
import { Duration, Effect, Option, Schema, Stream } from "effect"
import { HttpClient, HttpClientError, type HttpClientRequest, type HttpClientResponse } from "effect/unstable/http"

export const MAX_BYTES = 1024 * 1024

// Keeps the status for rate-limit failover and adds the provider's own explanation of the failure.
export const execute = (http: HttpClient.HttpClient, request: HttpClientRequest.HttpClientRequest) =>
  Effect.gen(function* () {
    const response = yield* HttpClient.withScope(http).execute(request)
    if (response.status >= 200 && response.status < 300) return yield* read(response)
    return yield* new HttpClientError.HttpClientError({
      reason: new HttpClientError.StatusCodeError({
        request,
        response,
        description: yield* read(response).pipe(
          Effect.map((body) =>
            payloads(body.text)
              .flatMap((payload) => Option.toArray(json(payload, body.truncated)))
              .map(failure)
              .find((message) => message !== undefined),
          ),
          // The explanation is optional; a slow or broken body must not delay the failure.
          Effect.timeoutOrElse({ duration: Duration.seconds(1), orElse: () => Effect.undefined }),
          Effect.orElseSucceed(() => undefined),
        ),
      }),
    })
  })

// Stops reading at MAX_BYTES instead of failing; parsers keep the results that arrived complete.
const read = (response: HttpClientResponse.HttpClientResponse) =>
  Effect.gen(function* () {
    let size = 0
    const chunks = yield* response.stream.pipe(
      Stream.takeUntil((chunk) => (size += chunk.byteLength) > MAX_BYTES),
      Stream.runCollect,
    )
    return { text: Buffer.concat(chunks).subarray(0, MAX_BYTES).toString("utf8"), truncated: size > MAX_BYTES }
  })

// A JSON body, or the data lines of a server-sent event stream.
export const payloads = (text: string) =>
  [text, ...text.split("\n").flatMap((line) => (line.startsWith("data: ") ? [line.slice(6)] : []))]
    .map((payload) => payload.trim())
    .filter((payload) => payload.startsWith("{"))

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))
const decodePartialJson = Option.liftThrowable(parseJSON)

export const json = (text: string, truncated: boolean) => (truncated ? decodePartialJson(text) : decodeJson(text))

const decodeFailure = Schema.decodeUnknownOption(
  Schema.Union([
    Schema.Struct({ error: Schema.Struct({ message: Schema.String }) }),
    Schema.Struct({
      result: Schema.Struct({
        isError: Schema.Literal(true),
        content: Schema.Array(Schema.Struct({ text: Schema.String })),
      }),
    }),
    Schema.Struct({ detail: Schema.Struct({ error: Schema.String }) }),
    Schema.Struct({ _tag: Schema.String, message: Schema.String }),
  ]),
)

// JSON-RPC errors, MCP tool errors, Tavily's error detail, and OpenCode API errors.
export const failure = (value: unknown) =>
  Option.getOrUndefined(
    Option.map(decodeFailure(value), (decoded) => {
      if ("error" in decoded) return decoded.error.message
      if ("result" in decoded) return decoded.result.content.map((item) => item.text).join("\n")
      if ("detail" in decoded) return decoded.detail.error
      return decoded.message
    }),
  )

// The last item of a truncated response may be cut mid-value, so it is dropped rather than trusted.
export const items = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  values: readonly unknown[],
  truncated: boolean,
) => {
  const decode = Schema.decodeUnknownOption(schema)
  return (truncated ? values.slice(0, -1) : values).flatMap((value) => Option.toArray(decode(value)))
}
