import { Effect, Ref, Stream } from "effect"
import { Headers, HttpClientRequest } from "effect/unstable/http"
import { Auth } from "../auth"
import { render as renderEndpoint } from "../endpoint"
import { Framing, type Framing as FramingDef } from "../framing"
import type { Transport, TransportPrepareInput } from "./index"
import * as ProviderShared from "../../protocols/shared"
import { mergeJsonRecords, type LLMRequest } from "../../schema"

export type JsonRequestInput<Body> = TransportPrepareInput<Body>

export interface JsonRequestParts<Body = unknown> {
  readonly url: string
  readonly jsonBody: Body | Record<string, unknown>
  readonly bodyText: string
  readonly headers: Headers.Headers
}

export interface HttpPrepared<Frame> {
  readonly request: HttpClientRequest.HttpClientRequest
  readonly framing: FramingDef<Frame>
  /**
   * Side-channel populated by `frames()` with a subset of HTTP response
   * headers that carry provider-level metadata not available in the body.
   * Currently captures LiteLLM cost headers so the caller can enrich the
   * `finish` event's `providerMetadata` with authoritative billing data.
   */
  readonly responseHeaders: Ref.Ref<Record<string, string>>
}

const applyQuery = (url: string, query: Record<string, string> | undefined) => {
  if (!query) return url
  const next = new URL(url)
  Object.entries(query).forEach(([key, value]) => next.searchParams.set(key, value))
  return next.toString()
}

const PROTOCOL_BODY_OVERLAY_DENYLIST = new Set([
  "content",
  "contents",
  "frequencyPenalty",
  "frequency_penalty",
  "generationConfig",
  "inferenceConfig",
  "input",
  "maxTokens",
  "max_tokens",
  "messages",
  "model",
  "presencePenalty",
  "presence_penalty",
  "responseFormat",
  "response_format",
  "seed",
  "stop",
  "stopSequences",
  "stop_sequences",
  "stream",
  "streamOptions",
  "stream_options",
  "system",
  "systemInstruction",
  "system_instruction",
  "temperature",
  "thinking",
  "toolChoice",
  "toolConfig",
  "tool_choice",
  "tool_config",
  "tools",
  "topK",
  "topP",
  "top_k",
  "top_p",
])

const forbiddenBodyOverlayKeys = (body: Record<string, unknown>) =>
  Object.keys(body).filter((key) => PROTOCOL_BODY_OVERLAY_DENYLIST.has(key))

const bodyWithOverlay = <Body>(body: Body, request: LLMRequest, encodeBody: (body: Body) => string) =>
  Effect.gen(function* () {
    if (request.http?.body === undefined) return { jsonBody: body, bodyText: encodeBody(body) }
    const forbiddenKeys = forbiddenBodyOverlayKeys(request.http.body)
    if (forbiddenKeys.length > 0)
      return yield* ProviderShared.invalidRequest(
        `http.body cannot overlay protocol-owned field(s): ${forbiddenKeys.join(", ")}`,
      )
    if (ProviderShared.isRecord(body)) {
      const overlaid = mergeJsonRecords(body, request.http.body) ?? {}
      return { jsonBody: overlaid, bodyText: ProviderShared.encodeJson(overlaid) }
    }
    return yield* ProviderShared.invalidRequest("http.body can only overlay JSON object request bodies")
  })

export const jsonRequestParts = <Body>(input: JsonRequestInput<Body>) =>
  Effect.gen(function* () {
    const url = applyQuery(
      renderEndpoint(input.endpoint, { request: input.request, body: input.body }).toString(),
      input.request.http?.query,
    )
    const body = yield* bodyWithOverlay(input.body, input.request, input.encodeBody)
    const headers = yield* Auth.toEffect(input.auth)({
      request: input.request,
      method: "POST",
      url,
      body: body.bodyText,
      headers: Headers.fromInput({
        ...input.headers?.({ request: input.request }),
        ...input.request.http?.headers,
      }),
    })
    return { url, jsonBody: body.jsonBody, bodyText: body.bodyText, headers }
  })

export interface HttpJsonInput<_Body, Frame> {
  readonly framing: FramingDef<Frame>
}

export type HttpJsonPatch<Body, Frame> = Partial<HttpJsonInput<Body, Frame>>

export interface HttpJsonTransport<Body, Frame> extends Transport<Body, HttpPrepared<Frame>, Frame> {
  readonly with: (patch: HttpJsonPatch<Body, Frame>) => HttpJsonTransport<Body, Frame>
}

/**
 * Extracts LiteLLM billing headers from an HTTP response, falling back from
 * `x-litellm-response-cost` to `x-litellm-response-cost-original` when the
 * primary header is absent (LiteLLM 1.98+ omits the primary header when the
 * value equals the original, causing callers that only read the primary header
 * to record $0.00 for those responses).
 *
 * Returns an empty object when no LiteLLM cost headers are present so callers
 * can skip the `providerMetadata` merge entirely.
 */
const litellmCostHeaders = (headers: Headers.Headers): Record<string, string> => {
  const cost =
    Headers.get(headers, "x-litellm-response-cost")._tag === "Some"
      ? Headers.get(headers, "x-litellm-response-cost").value
      : Headers.get(headers, "x-litellm-response-cost-original")._tag === "Some"
        ? Headers.get(headers, "x-litellm-response-cost-original").value
        : undefined
  if (cost === undefined) return {}
  const result: Record<string, string> = { "x-litellm-response-cost": cost }
  const spend = Headers.get(headers, "x-litellm-key-spend")
  if (spend._tag === "Some") result["x-litellm-key-spend"] = spend.value
  return result
}

export const httpJson = <Body, Frame>(input: HttpJsonInput<Body, Frame>): HttpJsonTransport<Body, Frame> => ({
  id: "http-json",
  with: (patch) => httpJson({ ...input, ...patch }),
  prepare: (prepareInput) =>
    Effect.gen(function* () {
      const parts = yield* jsonRequestParts({ ...prepareInput })
      const responseHeaders = yield* Ref.make<Record<string, string>>({})
      return {
        request: ProviderShared.jsonPost({ url: parts.url, body: parts.bodyText, headers: parts.headers }),
        framing: input.framing,
        responseHeaders,
      }
    }),
  frames: (prepared, request, runtime) =>
    Stream.unwrap(
      runtime.http
        .execute(prepared.request)
        .pipe(
          Effect.tap((response) => {
            const litellm = litellmCostHeaders(response.headers)
            return Object.keys(litellm).length > 0 ? Ref.set(prepared.responseHeaders, litellm) : Effect.void
          }),
          Effect.map((response) =>
            prepared.framing.frame(
              response.stream.pipe(
                Stream.mapError((error) =>
                  ProviderShared.eventError(
                    `${request.model.provider}/${request.model.route.id}`,
                    `Failed to read ${request.model.provider}/${request.model.route.id} stream`,
                    ProviderShared.errorText(error),
                  ),
                ),
              ),
            ),
          ),
        ),
    ),
})

export const sseJson = {
  id: "http-json/sse",
  with: <Body>() => httpJson<Body, string>({ framing: Framing.sse }),
} as const
