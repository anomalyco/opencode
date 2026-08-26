import { Effect } from "effect"
import { define } from "@opencode-ai/plugin/effect/plugin"
import { Provider } from "../../provider.js"

export const CerebrasPlugin = define({
  id: "opencode.provider.cerebras",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.catalog.transform((evt) => {
      for (const item of evt.provider.list()) {
        const name = Provider.packageName(item.provider.package)
        if (name !== "@ai-sdk/cerebras" && name !== "@opencode-ai/ai/providers/cerebras") continue
        evt.provider.update(item.provider.id, (provider) => {
          provider.headers = { ...provider.headers, "X-Cerebras-3rd-Party-Integration": "opencode" }
        })
      }
    })
  }),
})
