export * as DSV4RecoveryPlugin from "./dsv4-recovery.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Effect } from "effect"
import { RequestDiagnostic, REQUEST_DIAGNOSTIC_HEADER } from "../provider/request-diagnostic.js"
import type { PluginInternal } from "./internal.js"

export const Plugin = define({
  id: "opencode.dsv4.recovery",
  effect: Effect.fn("DSV4RecoveryPlugin")(function* (ctx) {
    const settles = new WeakMap<Request, (response?: Response) => void>()

    yield* ctx.session.hook("model.request", (event) =>
      Effect.sync(() => {
        const handle = RequestDiagnostic.begin({
          provider: event.model.providerID,
          model: event.model.id,
          sessionID: event.sessionID,
          messageID: "unknown",
        })
        if (handle) event.headers[REQUEST_DIAGNOSTIC_HEADER] = handle.token
      }),
    )

    yield* ctx.session.hook("http.request", (event) =>
      Effect.promise(async () => {
        const prepared = await RequestDiagnostic.prepareRequest(event.request)
        event.request = prepared.request
        settles.set(prepared.request, prepared.settle)
      }),
    )

    yield* ctx.session.hook("http.response", (event) =>
      Effect.sync(() => {
        settles.get(event.request)?.(event.response)
      }),
    )
  }),
} satisfies PluginInternal.InternalPlugin)
