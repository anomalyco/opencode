import { Duration, Effect, Stream } from "effect"
import { Headers, HttpClientRequest } from "effect/unstable/http"
import { Auth } from "../auth.js"
import { render as renderEndpoint } from "../endpoint.js"
import { Framing } from "../framing.js"
import type { HttpMiddleware, Transport, TransportPrepareInput } from "./index.js"
import * as ProviderShared from "../../protocols/shared.js"
import {
  AIError,
  DEFAULT_HTTP_TIMEOUT_MS,
  mergeJsonRecords,
  TransportError,
  type HttpContext,
  type HttpTimeout,
  type LLMRequest,
  type TransportOperation,
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

const applyQuery = (url: string, query: Record<string, string> | undefined) => {
  if (!query) return url
  const next = new URL(url)
  Object.entries(query).forEach(([key, value]) => next.searchParams.set(key, value))
  return next.toString()
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
      })
      return {
        request,
        framing: input.framing,
        middleware: prepareInput.middleware,
      }
    }),
  execute: (prepared, request, runtime) =>
    Effect.gen(function* () {
      const headerTimeout = timeoutDuration(request.http?.headerTimeout)
      const chunkTimeout = timeoutDuration(request.http?.chunkTimeout)
      const execute = runtime.http.execute(prepared.request, prepared.middleware)
      const response = yield* headerTimeout
        ? execute.pipe(
            Effect.timeoutOrElse({
              duration: headerTimeout,
              orElse: () =>
                Effect.fail(
                  timeoutError(
                    prepared.request.url,
                    "request",
                    `Timed out waiting for response headers after ${Duration.format(headerTimeout)}`,
                  ),
                ),
            }),
          )
        : execute
      const http = RequestExecutor.responseHttp(response)
      const bytes = RequestExecutor.responseStream(response)
      return {
        frames: prepared.framing.frame(
          chunkTimeout
            ? bytes.pipe(
                Stream.timeoutOrElse({
                  duration: chunkTimeout,
                  orElse: () =>
                    Stream.fail(
                      timeoutError(
                        prepared.request.url,
                        "read",
                        `Timed out waiting for response data after ${Duration.format(chunkTimeout)}`,
                        http,
                      ),
                    ),
                }),
              )
            : bytes,
        ),
        http,
        body: prepared.framing.body,
      }
    }),
})

// `false` disables a timer; an unset value uses the shared default.
const timeoutDuration = (value: HttpTimeout | undefined) =>
  value === false ? undefined : Duration.millis(value ?? DEFAULT_HTTP_TIMEOUT_MS)

const timeoutError = (url: string, operation: TransportOperation, message: string, http?: HttpContext) =>
  new AIError({
    reason: new TransportError({ message, transport: "http", operation, code: "Timeout", url, http }),
  })

export const sseJson = {
  id: "http-json/sse",
  with: <Body>() => httpJson<Body, string>({ framing: Framing.sse }),
} as const
