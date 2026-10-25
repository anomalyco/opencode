import { Effect } from "effect"
import { define } from "@opencode/plugin/effect/plugin"

// Chat-completions `prompt_cache_key` body support for catalog providers
// without a dedicated AI package. Audited per provider (docs + OpenAPI +
// SDK request types); only unscoped body-key support is listed. Scoped-only
// support is left off because the boolean cannot express route scope:
// fastrouter (GPT-5.6 routes only), frogbot (Google/Vertex routes only).
const providerIDs = [
  "abliteration-ai",
  "aihubmix",
  "anyapi",
  "auriko",
  "edenai",
  "jalapeno",
  "llama",
  "morph",
  "snowflake-cortex",
  "tencent-tokenhub",
  "upstage",
  "venice",
] as const

export const PromptCacheKeyPlugin = define({
  id: "opencode.provider.prompt-cache-key",
  effect: Effect.fn(function* (ctx) {
    // Set on the provider so configured provider and model compatibility can override it.
    yield* ctx.provider.transform((providers) => {
      for (const id of providerIDs) {
        if (!providers.get(id)) continue
        providers.update(id, (provider) => {
          provider.compatibility = { ...provider.compatibility, supportsPromptCacheKey: true }
        })
      }
    })
  }),
})
