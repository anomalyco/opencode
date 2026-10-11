export * as ConfigWebSearchPlugin from "./websearch.js"

import { define } from "@opencode/plugin/effect/plugin"
import type { Entry } from "@opencode/schema/config"
import type { WebSearch } from "@opencode/schema/websearch"
import { Effect } from "effect"
import { Config } from "../../config.js"
import { ConfigEntryObserver } from "./entry-observer.js"

export const Plugin = define({
  id: "opencode.config.websearch",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Config.Service
    const loaded = yield* ConfigEntryObserver.observe(config, ctx.event, ctx.websearch.reload())
    yield* ctx.websearch.transform((websearch) => {
      const resolved = resolveProviderSettings(loaded.entries)
      websearch.settings.clear()
      if (resolved.disabled) {
        websearch.default.set(false)
        return
      }
      if (resolved.provider !== undefined) websearch.default.set(resolved.provider)
      resolved.providers.forEach((settings, id) => websearch.settings.set(id, settings))
    })
  }),
})

// Resolve `provider` and `providers` independently: a higher-priority document that only selects a
// provider must not drop endpoints or keys shipped by a lower-priority managed document.
function resolveProviderSettings(entries: readonly Entry[]) {
  const values = entries.flatMap((entry) =>
    entry.type === "document" && entry.info.websearch !== undefined ? [entry.info.websearch] : [],
  )
  const latest = values.at(-1)
  const disabled = latest === false
  const providers = new Map<string, WebSearch.Settings>()
  if (!disabled)
    values.forEach((value) => {
      if (value === false) return
      Object.entries(value.providers ?? {}).forEach(([id, settings]) => {
        providers.set(id, { ...providers.get(id), ...settings })
      })
    })
  return {
    disabled,
    provider: latest === false || latest === undefined ? undefined : latest.provider,
    providers,
  }
}
