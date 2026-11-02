export * as RequestGuard from "./request-guard"

import { Effect } from "effect"
import { HttpMiddleware, HttpServerRequest, HttpServerResponse } from "effect/http"
import { isAllowedRequestOrigin } from "../cors"
import { isAllowedRequestHost } from "../host"

export type Options = {
  /** The address the server binds to. Undefined means the runtime routes by host itself. */
  readonly hostname?: string
  /** Origins the operator declared trusted through --cors. */
  readonly cors?: ReadonlyArray<string>
  /** Extra trusted hosts, such as the remote tunnel URL the server advertises. */
  readonly hosts?: () => ReadonlyArray<string>
}

/**
 * Rejects requests that name a site the server does not trust.
 *
 * The CORS middleware only decides which origins may read a response; the request itself still
 * reaches the handler, so a page on any site could create a session, run a shell command or
 * write a file on the machine that hosts the server. The Host header closes the same hole for
 * a rebound domain, where the browser sends no Origin header at all.
 */
export const middleware = (options: Options) =>
  HttpMiddleware.make((app) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      const host = request.headers.host
      // A host the operator declared trusted through --cors stays reachable: reverse proxies
      // forward the public host name.
      const hosts = [...(options.hosts?.() ?? []), ...(options.cors ?? [])]
      if (!isAllowedRequestHost(host, { hostname: options.hostname, hosts }))
        return HttpServerResponse.empty({ status: 403 })
      const origin = request.headers.origin
      if (origin !== undefined && !isAllowedRequestOrigin(origin, host, { cors: options.cors }))
        return HttpServerResponse.empty({ status: 403 })
      return yield* app
    }),
  )
