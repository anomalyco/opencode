import { Effect } from "effect"
import { Headers, HttpClientRequest } from "effect/unstable/http"
import { Auth } from "./auth.js"
import { Endpoint } from "./endpoint.js"
import type { Interface } from "./executor-service.js"
import { MediaProtocol } from "./media-protocol.js"
import { ProviderShared } from "../protocols/shared.js"
import { AIError, HttpOptions, ProviderID, mergeHttpOptions } from "../schema/index.js"
import { sanitizeSurrogates } from "../utils/sanitize.js"

export type Execute = Interface["execute"]

/** The minimum a media request must carry for the route to build a transport request. */
export interface MediaRequest {
  readonly model: { readonly id: string; readonly provider: ProviderID; readonly http?: HttpOptions }
  readonly http?: HttpOptions
}

/** Deployment inputs every media model factory accepts; provider facades fill these from `configure(...)`. */
export interface ModelInput {
  readonly id: string
  readonly auth: Auth.Definition
  readonly baseURL?: string
  readonly headers?: Record<string, string>
  readonly http?: HttpOptions
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export interface Route<Request extends MediaRequest, Response> {
  readonly id: string
  readonly provider: ProviderID
  readonly protocol: string
  readonly generate: (request: Request, execute: Execute) => Effect.Effect<Response, AIError>
}

export interface MakeInput<Request extends MediaRequest, Response> {
  readonly id: string
  readonly provider: string | ProviderID
  readonly protocol: MediaProtocol.Inline<Request, Response>
  readonly endpoint: Endpoint.Definition<MediaProtocol.Body, Request>
  readonly auth: Auth.Definition
  /** Deployment headers applied before transport authentication. */
  readonly headers?: Record<string, string>
}

/**
 * Compose an inline media protocol with an endpoint and auth into a runnable route. The route owns the transport
 * plumbing every media protocol would otherwise duplicate: option merging, surrogate sanitizing, unsupported-field rejection, URL and query
 * rendering, auth headers, JSON vs multipart encoding, and handing the response back to the protocol for decoding.
 */
export const make = <Request extends MediaRequest, Response>(
  input: MakeInput<Request, Response>,
): Route<Request, Response> => {
  const provider = ProviderID.make(input.provider)
  const routeHttp = input.headers === undefined ? undefined : new HttpOptions({ headers: input.headers })
  const authorize = Auth.toEffect(input.auth)
  return {
    id: input.id,
    provider,
    protocol: input.protocol.id,
    generate: Effect.fn(`MediaRoute.generate`)(function* (request: Request, execute: Execute) {
      yield* rejectUnsupported(input.id, provider, request, input.protocol.unsupported)
      const http = mergeHttpOptions(routeHttp, request.model.http, request.http)
      // Sanitize after merging so model-level overlays are covered; the model value is restored, not sanitized.
      const resolved: Request = { ...sanitizeSurrogates({ ...request, http }), model: request.model }
      const body = yield* input.protocol.body.from(resolved)
      const url = Endpoint.render(input.endpoint, { request: resolved, body })
      for (const [key, value] of Object.entries(http?.query ?? {})) url.searchParams.set(key, value)
      const encoded = body.type === "json" ? ProviderShared.encodeJson(body.value) : "[multipart/form-data]"
      const baseHeaders = Headers.fromInput(http?.headers)
      const headers = yield* authorize({
        request: resolved,
        method: "POST",
        url: url.toString(),
        body: encoded,
        // The HTTP client sets the multipart boundary; a caller-supplied content-type would corrupt it.
        headers: body.type === "multipart" ? Headers.remove(baseHeaders, "content-type") : baseHeaders,
      })
      const transport = HttpClientRequest.post(url.toString()).pipe(
        HttpClientRequest.setHeaders(headers),
        body.type === "json"
          ? HttpClientRequest.bodyText(encoded, "application/json")
          : HttpClientRequest.bodyFormData(body.value),
      )
      const response = yield* execute(transport)
      return yield* input.protocol.response.decode(response, { request: resolved, body })
    }),
  }
}

/** Common fields are never silently dropped: a present field the protocol declared unsupported fails typed. */
const rejectUnsupported = <Request extends object>(
  route: string,
  provider: ProviderID,
  request: Request,
  unsupported: ReadonlyArray<keyof Request & string> | undefined,
): Effect.Effect<void, AIError> => {
  const present = (unsupported ?? []).filter((field) => {
    const value = request[field]
    return Array.isArray(value) ? value.length > 0 : value !== undefined
  })
  if (present.length === 0) return Effect.void
  return Effect.fail(
    ProviderShared.unsupportedOperation({
      operation: `media.${present[0]}`,
      provider,
      route,
      message: `${provider}/${route} does not support ${present.join(", ")}`,
    }),
  )
}

export * as MediaRoute from "./media.js"
