import { Effect, Stream } from "effect"
import { Headers, HttpClientRequest } from "effect/unstable/http"
import { Auth, type Auth as AuthDef } from "../auth"
import { type Endpoint, render as renderEndpoint } from "../endpoint"
import type { Framing } from "../framing"
import type { Transport, TransportContext } from "./index"
import * as ProviderShared from "../../protocols/shared"
import { mergeJsonRecords, type LLMRequest } from "../../schema"

export interface JsonRequestInput<Payload> {
  readonly payload: Payload
  readonly context: TransportContext
  readonly endpoint: Endpoint<Payload>
  readonly auth: AuthDef
  readonly encodePayload: (payload: Payload) => string
  readonly headers?: (input: { readonly request: LLMRequest }) => Record<string, string>
}

export interface JsonRequestParts {
  readonly url: string
  readonly body: string
  readonly headers: Headers.Headers
}

export interface HttpPrepared<Frame> extends JsonRequestParts {
  readonly request: HttpClientRequest.HttpClientRequest
  readonly framing: Framing<Frame>
}

const applyQuery = (url: string, query: Record<string, string> | undefined) => {
  if (!query) return url
  const next = new URL(url)
  Object.entries(query).forEach(([key, value]) => next.searchParams.set(key, value))
  return next.toString()
}

const bodyWithOverlay = <Payload>(payload: Payload, request: LLMRequest, encodePayload: (payload: Payload) => string) => Effect.gen(function* () {
  if (request.http?.body === undefined) return encodePayload(payload)
  if (ProviderShared.isRecord(payload)) return ProviderShared.encodeJson(mergeJsonRecords(payload, request.http.body) ?? {})
  return yield* ProviderShared.invalidRequest("http.body can only overlay JSON object request bodies")
})

export const jsonRequestParts = <Payload>(input: JsonRequestInput<Payload>) =>
  Effect.gen(function* () {
    const url = applyQuery(
      (yield* renderEndpoint(input.endpoint, { request: input.context.request, payload: input.payload })).toString(),
      input.context.request.http?.query,
    )
    const body = yield* bodyWithOverlay(input.payload, input.context.request, input.encodePayload)
    const headers = yield* Auth.toEffect(Auth.isAuth(input.context.request.model.auth) ? input.context.request.model.auth : input.auth)({
      request: input.context.request,
      method: "POST",
      url,
      body,
      headers: Headers.fromInput({
        ...(input.headers?.({ request: input.context.request }) ?? {}),
        ...input.context.request.model.headers,
        ...input.context.request.http?.headers,
      }),
    })
    return { url, body, headers }
  })

export interface HttpJsonInput<Payload, Frame> {
  readonly endpoint: Endpoint<Payload>
  readonly auth?: AuthDef
  readonly framing: Framing<Frame>
  readonly encodePayload: (payload: Payload) => string
  readonly headers?: (input: { readonly request: LLMRequest }) => Record<string, string>
}

export type HttpJsonPatch<Payload, Frame> = Partial<HttpJsonInput<Payload, Frame>>

export interface HttpJsonTransport<Payload, Frame> extends Transport<Payload, HttpPrepared<Frame>, Frame> {
  readonly with: (patch: HttpJsonPatch<Payload, Frame>) => HttpJsonTransport<Payload, Frame>
}

export const httpJson = <Payload, Frame>(input: HttpJsonInput<Payload, Frame>): HttpJsonTransport<Payload, Frame> => ({
  id: "http-json",
  with: (patch) => httpJson({ ...input, ...patch }),
  prepare: (payload, context) =>
    jsonRequestParts({
      payload,
      context,
      endpoint: input.endpoint,
      auth: input.auth ?? Auth.bearer(),
      encodePayload: input.encodePayload,
      headers: input.headers,
    }).pipe(
      Effect.map((parts) => ({
        ...parts,
        request: ProviderShared.jsonPost(parts),
        framing: input.framing,
      })),
    ),
  frames: (prepared, context, runtime) =>
    Stream.unwrap(
      runtime.http.execute(prepared.request).pipe(
        Effect.map((response) =>
          prepared.framing.frame(
            response.stream.pipe(
              Stream.mapError((error) =>
                ProviderShared.chunkError(
                  `${context.request.model.provider}/${context.request.model.route}`,
                  `Failed to read ${context.request.model.provider}/${context.request.model.route} stream`,
                  ProviderShared.errorText(error),
                )
              ),
            ),
          )
        ),
      ),
    ),
})
