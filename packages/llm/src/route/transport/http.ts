import { Effect, Stream } from "effect"
import { Headers, HttpClientRequest } from "effect/unstable/http"
import { Auth, type Auth as AuthDef } from "../auth"
import { type Endpoint, render as renderEndpoint } from "../endpoint"
import type { Framing } from "../framing"
import type { Transport, TransportContext } from "./index"
import * as ProviderShared from "../../protocols/shared"
import { mergeJsonRecords, type LLMRequest } from "../../schema"

export interface JsonRequestInput<Body> {
  readonly body: Body
  readonly context: TransportContext
  readonly endpoint: Endpoint<Body>
  readonly auth: AuthDef
  readonly encodeBody: (body: Body) => string
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

const bodyWithOverlay = <Body>(body: Body, request: LLMRequest, encodeBody: (body: Body) => string) => Effect.gen(function* () {
  if (request.http?.body === undefined) return encodeBody(body)
  if (ProviderShared.isRecord(body)) return ProviderShared.encodeJson(mergeJsonRecords(body, request.http.body) ?? {})
  return yield* ProviderShared.invalidRequest("http.body can only overlay JSON object request bodies")
})

export const jsonRequestParts = <Body>(input: JsonRequestInput<Body>) =>
  Effect.gen(function* () {
    const url = applyQuery(
      (yield* renderEndpoint(input.endpoint, { request: input.context.request, body: input.body })).toString(),
      input.context.request.http?.query,
    )
    const body = yield* bodyWithOverlay(input.body, input.context.request, input.encodeBody)
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

export interface HttpJsonInput<Body, Frame> {
  readonly endpoint: Endpoint<Body>
  readonly auth?: AuthDef
  readonly framing: Framing<Frame>
  readonly encodeBody: (body: Body) => string
  readonly headers?: (input: { readonly request: LLMRequest }) => Record<string, string>
}

export type HttpJsonPatch<Body, Frame> = Partial<HttpJsonInput<Body, Frame>>

export interface HttpJsonTransport<Body, Frame> extends Transport<Body, HttpPrepared<Frame>, Frame> {
  readonly with: (patch: HttpJsonPatch<Body, Frame>) => HttpJsonTransport<Body, Frame>
}

export const httpJson = <Body, Frame>(input: HttpJsonInput<Body, Frame>): HttpJsonTransport<Body, Frame> => ({
  id: "http-json",
  with: (patch) => httpJson({ ...input, ...patch }),
  prepare: (body, context) =>
    jsonRequestParts({
      body,
      context,
      endpoint: input.endpoint,
      auth: input.auth ?? Auth.bearer(),
      encodeBody: input.encodeBody,
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
                ProviderShared.eventError(
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
