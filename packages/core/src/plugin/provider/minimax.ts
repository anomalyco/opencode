import { DateTime, Effect } from "effect"
import { ModelV2 } from "../../model"
import { PluginV2 } from "../../plugin"
import { ProviderV2 } from "../../provider"

const provider = ProviderV2.ID.make("minimax")
const m3 = ModelV2.ID.make("MiniMax-M3")

export const MiniMaxPlugin = PluginV2.define({
  id: PluginV2.ID.make("minimax"),
  effect: Effect.gen(function* () {
    return {
      "catalog.transform": Effect.fn(function* (evt) {
        const item = evt.provider.get(provider)
        if (!item) return
        evt.model.update(provider, m3, (model) => {
          model.name = "MiniMax-M3"
          model.family = ModelV2.Family.make("minimax")
          model.endpoint = { type: "unknown" }
          model.capabilities = {
            tools: true,
            input: ["text", "image", "video"],
            output: ["text"],
          }
          model.time.released = DateTime.makeUnsafe(Date.parse("2026-05-31"))
          model.cost = [
            {
              input: 0.6,
              output: 2.4,
              cache: {
                read: 0.12,
                write: 0,
              },
            },
          ]
          model.limit = {
            context: 512_000,
            output: 131_072,
          }
          model.enabled = true
          model.status = "active"
        })
      }),
    }
  }),
})
