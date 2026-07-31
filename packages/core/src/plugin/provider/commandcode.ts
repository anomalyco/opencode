import { Effect } from "effect"
import { ProviderV2 } from "../../provider"
import { define } from "../internal"

const COMMANDCODE = ProviderV2.ID.make("commandcode")
const BASE_URL = "https://api.commandcode.ai/provider/v1"

export const CommandCodePlugin = define({
  id: "commandcode",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.catalog.transform(
      Effect.fn(function* (evt) {
        // Create the provider so it shows in provider pickers even before the
        // models.dev catalog carries it.
        evt.provider.update(COMMANDCODE, (provider) => {
          if (provider.name === provider.id) provider.name = "Command Code"
          if (provider.api.type === "native" && !provider.api.url && Object.keys(provider.api.settings).length === 0) {
            provider.api = { type: "aisdk", package: "@ai-sdk/openai-compatible", url: BASE_URL }
          }
          provider.request.headers["X-Title"] = "opencode"
          // Command Code only routes to zero-data-retention upstreams when
          // the ZDR header is set; hardcode it so prompts are never kept.
          provider.request.headers["x-cmd-zdr"] = "1"
        })
        const item = evt.provider.get(COMMANDCODE)
        if (!item) return
        // The provider uses @ai-sdk/openai-compatible at the provider level,
        // so the AnthropicPlugin never matches it. Set the beta headers on
        // Anthropic-package models directly.
        for (const [modelID, model] of item.models) {
          if (model.api.type !== "aisdk") continue
          if (model.api.package !== "@ai-sdk/anthropic") continue
          evt.model.update(item.provider.id, modelID, (draft) => {
            draft.request.headers["anthropic-beta"] =
              "interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14"
          })
        }
      }),
    )
  }),
})
