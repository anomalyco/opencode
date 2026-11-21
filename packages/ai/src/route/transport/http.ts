import { Duration, Effect, Stream } from "effect"
import { Headers, HttpClientRequest } from "effect/http"
import { Auth } from "../auth.js"
import { render as renderEndpoint } from "../endpoint.js"
import { Framing } from "../framing.js"
import type { HttpMiddleware, Transport, TransportPrepareInput } from "./index.js"
import * as ProviderShared from "../../protocols/shared.js"
import {
  AIError,
  DEFAULT_CHUNK_TIMEOUT_MS,
  mergeJsonRecords,
  timeoutConfig,
  TransportError,
  type HttpTimeout,
  type LLMRequest,
} from "../../schema/index.js"
import { RequestExecutor } from "../executor.js"

export type JsonRequestInput<Body> = TransportPrepareInput<Body>

export interface JsonRequestParts<Body = unknown> {
  readonly url: string
  readonly jsonBody: Body | Record<string, unknown>
  readonly bodyText: string
  readonly headers: Headers.Headers
}

export interface HttpPrepared<Frame> {
  readonly request: HttpClientRequest.HttpClientRequest
  readonly framing: Framing.Definition<Frame>
  readonly middleware?: HttpMiddleware
}

const bodyWithOverlay = <Body>(body: Body, request: LLMRequest, encodeBody: (body: Body) => string) =>
  Effect.gen(function* () {
    if (request.http?.body === undefined) return { jsonBody: body, bodyText: encodeBody(body) }
    if (ProviderShared.isRecord(body)) {
      const overlaid = mergeJsonRecords(body, request.http.body) ?? {}
      return { jsonBody: overlaid, bodyText: ProviderShared.encodeJson(overlaid) }
    }
    return yield* ProviderShared.invalidRequest("http.body can only overlay JSON object request bodies")
  })

export const jsonRequestParts = <Body>(input: JsonRequestInput<Body>) =>
  Effect.gen(function* () {
    const endpoint = renderEndpoint(input.endpoint, { request: input.request, body: input.body })
    if (input.request.http?.query) {
      Object.entries(input.request.http.query).forEach(([key, value]) => endpoint.searchParams.set(key, value))
    }
    const url = endpoint.toString()
    const body = yield* bodyWithOverlay(input.body, input.request, input.encodeBody)
    const headers = yield* Auth.toEffect(input.auth)({
      request: input.request,
      method: "POST",
      url,
      body: body.bodyText,
      headers: Headers.fromInput({
        ...input.headers?.({ request: input.request }),
        ...input.request.headers,
      }),
    })
    return { url, jsonBody: body.jsonBody, bodyText: body.bodyText, headers }
  })

export interface HttpJsonInput<_Body, Frame> {
  readonly framing: Framing.Definition<Frame>
}

export type HttpJsonPatch<Body, Frame> = Partial<HttpJsonInput<Body, Frame>>

export interface HttpJsonTransport<Body, Frame> extends Transport<Body, HttpPrepared<Frame>, Frame> {
  readonly with: (patch: HttpJsonPatch<Body, Frame>) => HttpJsonTransport<Body, Frame>
}

export const httpJson = <Body, Frame>(input: HttpJsonInput<Body, Frame>): HttpJsonTransport<Body, Frame> => ({
  id: "http-json",
  with: (patch) => httpJson({ ...input, ...patch }),
  prepare: (prepareInput) =>
    Effect.gen(function* () {
      const parts = yield* jsonRequestParts({ ...prepareInput })
      const request = ProviderShared.jsonPost({
        url: parts.url,
        body: parts.bodyText,
        headers: parts.headers,
        encoding: prepareInput.request.http?.encoding,
      })
      return {
        request,
        framing: input.framing,
        middleware: prepareInput.middleware,
      }
    }),
  execute: (prepared, request, runtime) =>
    Effect.gen(function* () {
      const limits = timeoutConfig(request.timeout)
      // The executor still bounds headers and the whole request; the chunk limit moves to frames below.
      const response = yield* RequestExecutor.withTimeout(
        RequestExecutor.withTls(runtime.http.execute, request.http?.tls),
        { ...limits, chunk: false },
      )(prepared.request, prepared.middleware)
      const http = RequestExecutor.responseHttp(response)
      return {
        // The chunk timeout runs on frames, not bytes, so SSE comments and keepalives don't count as progress.
        frames: prepared.framing.frame(RequestExecutor.responseStream(response)).pipe(
          Stream.timeoutOrElse({
            duration: timeoutDuration(limits.chunk),
            orElse: () =>
              Stream.fail(
                new AIError({
                  reason: new TransportError({
                    message: "Timed out waiting for response data",
                    transport: "http",
                    operation: "read",
                    code: "Timeout",
                    url: prepared.request.url,
                    http,
                  }),
                }),
              ),
          }),
        ),
        http,
        body: prepared.framing.body,
        raw: prepared.framing.raw,
      }
    }),
})

const timeoutDuration = (value: HttpTimeout | undefined) =>
  value === false ? Duration.infinity : Duration.millis(value ?? DEFAULT_CHUNK_TIMEOUT_MS)

export const sseJson = {
  id: "http-json/sse",
  with: <Body>() => httpJson<Body, string>({ framing: Framing.sse }),
} as const
