import { Effect } from "effect"
import { define } from "@opencode/plugin/effect/plugin"
import { Provider } from "../../provider.js"
import { configuredSettings } from "./configured.js"

const providerID = Provider.ID.make("anthropic")

export const AnthropicPlugin = define({
  id: "opencode.provider.anthropic",
  effect: Effect.fn(function* (ctx) {
    // Config applies after provider plugins, so read it here: a custom baseURL may not decode gzip.
    const configured = yield* configuredSettings(providerID)
    if (configured?.baseURL !== undefined) return
    yield* ctx.provider.transform((providers) => {
      if (!providers.get(providerID)) return
      providers.update(providerID, (provider) => {
        // api.anthropic.com decodes gzip bodies (not zstd or br), and every step resends the whole transcript.
        provider.settings = Provider.mergeOverlay(provider.settings, {
          encoding: provider.settings?.encoding ?? "gzip",
        })
      })
    })
  }),
})
