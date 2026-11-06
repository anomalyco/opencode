export * as RemoteHttp from "./remote-http.js"

import { Effect, Scope, Stream } from "effect"
import {
  FetchHttpClient,
  HttpBody,
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
  HttpMethod,
} from "effect/http"

const MAX_REDIRECTS = 5
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
// Headers that name or authenticate the caller. They never follow a redirect to another origin.
const CREDENTIAL_HEADERS = ["authorization", "cookie", "proxy-authorization", "x-org-id"]

export function isHttpUrl(value: string) {
  return URL.canParse(value) && /^https?:$/.test(new URL(value).protocol)
}

/**
 * Sends a request and follows up to five HTTP(S) redirects itself, instead of letting fetch follow them, so the hops
 * are bounded and credentials never cross an origin boundary. A same-origin hop keeps every header; a hop to another
 * origin drops credential headers and every header named in `sensitive`. Fails unless the final response is a 2xx.
 */
export function follow(
  http: HttpClient.HttpClient,
  request: HttpClientRequest.HttpClientRequest,
  sensitive: Iterable<string> = [],
) {
  return hop(http, request, new Set([...CREDENTIAL_HEADERS, ...Array.from(sensitive, (name) => name.toLowerCase())]), 0)
}

/** GETs a configured remote source, sending its headers to the URL and to same-origin redirects only. */
export function get(http: HttpClient.HttpClient, url: string, headers: Readonly<Record<string, string>> = {}) {
  return follow(http, HttpClientRequest.get(url).pipe(HttpClientRequest.setHeaders(headers)), Object.keys(headers))
}

function hop(
  http: HttpClient.HttpClient,
  request: HttpClientRequest.HttpClientRequest,
  strip: ReadonlySet<string>,
  redirects: number,
): Effect.Effect<HttpClientResponse.HttpClientResponse, HttpClientError.HttpClientError | Error, Scope.Scope> {
  // Scoped per hop so a caller's timeout or interruption aborts the request in flight.
  return HttpClient.withScope(http)
    .execute(request)
    .pipe(
      Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" }),
      Effect.flatMap((response) => {
        const location = response.headers.location
        if (!REDIRECT_STATUSES.has(response.status) || !location) return HttpClientResponse.filterStatusOk(response)
        if (redirects >= MAX_REDIRECTS) return Effect.fail(new Error(`Too many redirects (more than ${MAX_REDIRECTS})`))
        return Effect.flatMap(redirectTarget(request, location), (target) =>
          // Release this hop's connection before the next request instead of holding it until the download ends.
          HttpClientResponse.stream(Effect.succeed(response)).pipe(
            Stream.runDrain,
            // The redirect's own body is irrelevant, so failing to read it must not fail the request.
            Effect.ignore,
            Effect.andThen(hop(http, redirected(request, target, response.status, strip), strip, redirects + 1)),
          ),
        )
      }),
    )
}

function redirectTarget(request: HttpClientRequest.HttpClientRequest, location: string) {
  return Effect.try({
    try: () => {
      const target = new URL(location, request.url)
      if (target.protocol !== "http:" && target.protocol !== "https:")
        throw new Error(`redirect to unsupported protocol ${target.protocol}`)
      return target
    },
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  })
}

function redirected(
  request: HttpClientRequest.HttpClientRequest,
  target: URL,
  status: number,
  strip: ReadonlySet<string>,
) {
  // A 303 always, and a 301 or 302 after a POST, become a bodyless GET, as fetch would send them.
  const get = status === 303 || ((status === 301 || status === 302) && request.method === "POST")
  const headers =
    target.origin === new URL(request.url).origin
      ? request.headers
      : Object.fromEntries(Object.entries(request.headers).filter(([name]) => !strip.has(name)))
  // `HttpClientRequest.method` is typed `string`, while `make` only accepts a known method.
  // The `href` string keeps the location's query exactly as sent: a `URL` would decode and re-encode it,
  // which breaks a presigned download whose signature covers the encoding.
  return HttpClientRequest.make(get ? "GET" : (request.method as HttpMethod.HttpMethod))(target.href, {
    headers,
    body: get ? HttpBody.empty : request.body,
  })
}
