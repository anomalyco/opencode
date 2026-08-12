export * as SessionModelHttp from "./model-http.js"

import type { StreamOptions } from "@opencode-ai/ai/route"
import type { Agent } from "@opencode-ai/schema/agent"
import type { Model } from "@opencode-ai/schema/model"
import type { Session } from "@opencode-ai/schema/session"
import { Effect, Stream } from "effect"
import { HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { PluginHooks } from "../plugin/hooks.js"

export const middleware =
  (
    hooks: PluginHooks.Interface,
    input: { readonly sessionID: Session.ID; readonly agent: Agent.ID; readonly model: Model.Ref },
  ): NonNullable<StreamOptions["http"]> =>
  (request, handler) =>
    Effect.gen(function* () {
      const before = yield* hooks.trigger("session", "http.request", {
        ...input,
        request: yield* HttpClientRequest.toWeb(request),
      })
      let sent = HttpClientRequest.fromWeb(before.request)
      if (before.request.body)
        sent = HttpClientRequest.bodyUint8Array(
          sent,
          new Uint8Array(yield* Effect.promise(() => before.request.clone().arrayBuffer())),
          before.request.headers.get("content-type") ?? undefined,
        )
      const response = yield* handler(sent)
      const after = yield* hooks.trigger("session", "http.response", {
        ...input,
        request: before.request,
        response: new Response(
          [204, 205, 304].includes(response.status) ? null : yield* Stream.toReadableStreamEffect(response.stream),
          { status: response.status, headers: response.headers },
        ),
      })
      return HttpClientResponse.fromWeb(sent, after.response)
    }).pipe(Effect.mapError((cause) => (cause instanceof Error ? cause : new Error(String(cause)))))
