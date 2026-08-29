export * as WellKnownPlugin from "./plugin.js"

import { define } from "@opencode-ai/plugin/effect/plugin"
import { Effect, Stream } from "effect"
import { Bus } from "../bus.js"
import { WellKnown } from "../wellknown.js"

export const Plugin = define({
  id: "opencode.wellknown",
  effect: Effect.fn(function* (ctx) {
    const bus = yield* Bus.Service
    const wellknown = yield* WellKnown.Service
    // Priming the cache is best effort. Failing here would abort the plugin before it registers
    // its transform, permanently hiding every well-known integration until the next restart.
    yield* wellknown
      .entries()
      .pipe(Effect.catch((error) => Effect.logWarning("failed to load wellknown entries", { error })))
    yield* ctx.integration.transform((draft) => {
      wellknown.snapshot().forEach((entry) => {
        if (!entry.manifest.auth) return
        draft.update(entry.integrationID, (integration) => {
          integration.name = new URL(entry.origin).hostname
        })
        draft.method.update({
          integrationID: entry.integrationID,
          method: {
            id: "login",
            type: "command",
            label: "Log in",
            command: [...entry.manifest.auth.command],
          },
        })
      })
    })
    yield* bus.subscribe(WellKnown.Event.Updated).pipe(
      Stream.runForEach(() => ctx.integration.reload()),
      Effect.forkScoped({ startImmediately: true }),
    )
  }),
})
