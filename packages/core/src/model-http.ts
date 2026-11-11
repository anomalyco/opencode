export * as ModelHttp from "./model-http.js"

import type { HttpMiddleware } from "@opencode/ai/route"
import type { ModelRequestScope } from "@opencode/plugin/effect/model"
import { Effect, Stream } from "effect"
import { HttpClientRequest, HttpClientResponse } from "effect/http"
import type { PluginHooks } from "./plugin/hooks.js"

/**
 * Per-call middleware that runs the model `experimental.http.*` hooks, and the session `http.*` hooks when a Session
 * makes the request. Model hooks wrap session hooks. Undefined when no hook applies.
 */
export const middleware = Effect.fnUntraced(function* (hooks: PluginHooks.Interface, scope: ModelRequestScope) {
  const providerID = scope.model.providerID
  // The session hooks' own event shape, for requests a Session makes.
  const session = scope.session && {
    sessionID: scope.session.id,
    agent: scope.session.agent,
    model: scope.model,
    kind: scope.kind,
  }
  const any =
    (yield* hooks.has("model", "experimental.http.request", providerID)) ||
    (yield* hooks.has("model", "experimental.http.response", providerID)) ||
    (session !== undefined &&
      ((yield* hooks.has("session", "http.request", providerID)) ||
        (yield* hooks.has("session", "http.response", providerID))))
  if (!any) return undefined
  const http: HttpMiddleware = (req, handler) =>
    Effect.gen(function* () {
      const request = yield* HttpClientRequest.toWeb(req)
      const outer = yield* hooks.trigger("model", "experimental.http.request", { ...scope, request })
      const before = session
        ? yield* hooks.trigger("session", "http.request", { ...session, request: outer.request })
        : outer
      // A hook that kept the request object cannot have replaced its body, so the original body is sent as is.
      // Reading it back would hold a second full copy of the request, screenshots included, for the whole call.
      const sent =
        before.request === request
          ? HttpClientRequest.setBody(HttpClientRequest.fromWeb(request), req.body)
          : before.request.body
            ? HttpClientRequest.bodyUint8Array(
                HttpClientRequest.fromWeb(before.request),
                new Uint8Array(yield* Effect.promise(() => before.request.clone().arrayBuffer())),
                before.request.headers.get("content-type") ?? undefined,
              )
            : HttpClientRequest.fromWeb(before.request)
      const res = yield* handler(sent)
      const response = new Response(
        [204, 205, 304].includes(res.status) ? null : yield* Stream.toReadableStreamEffect(res.stream),
        { status: res.status, headers: res.headers },
      )
      const inner = session
        ? yield* hooks.trigger("session", "http.response", { ...session, request: before.request, response })
        : { response }
      const after = yield* hooks.trigger("model", "experimental.http.response", {
        ...scope,
        request: before.request,
        response: inner.response,
      })
      return HttpClientResponse.fromWeb(sent, after.response)
    })
  return http
})
