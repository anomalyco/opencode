import { Effect } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { isAllowedHost, type HostOptions } from "@/server/host"

// Rejects HTTP requests whose Host header isn't one we expect to serve.
// Defends against DNS rebinding attacks where a malicious site convinces the
// browser to resolve attacker.com to the user's loopback or LAN IP — without
// this check, the browser would treat such requests as same-origin with the
// attacker page, bypassing CORS, and the OpenCode server would process them
// (including shell-execution endpoints).
//
// Returns 421 "Misdirected Request" for unknown hosts (RFC 7540), the
// semantically correct status for "this server cannot produce a response for
// the target URI".
//
// In-process requests (tests, `app.request("/...")`) don't carry a wire-level
// Host header; we fall back to the host derived from the request URL, which
// matches what a browser would put in Host on the wire.
export const hostGuard = (options?: HostOptions) =>
  HttpRouter.middleware(
    (httpApp) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const host = request.headers.host ?? hostFromUrl(request.url)
        if (!isAllowedHost(host, options)) {
          return HttpServerResponse.empty({ status: 421 })
        }
        return yield* httpApp
      }),
    { global: true },
  )

function hostFromUrl(url: string): string | undefined {
  try {
    return new URL(url, "http://localhost").host
  } catch {
    return undefined
  }
}
