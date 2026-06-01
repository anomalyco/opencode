import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { MiniMaxPlugin } from "@opencode-ai/core/plugin/provider/minimax"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { it, provider } from "./provider-helper"

describe("MiniMaxPlugin", () => {
  it.effect("adds MiniMax-M3 to MiniMax providers", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const catalog = yield* Catalog.Service
      yield* plugin.add(MiniMaxPlugin)
      const transform = yield* catalog.transform()
      yield* transform((catalog) => {
        for (const id of ["minimax", "minimax-cn", "minimax-coding-plan", "minimax-cn-coding-plan"]) {
          const item = provider(id, {
            endpoint: {
              type: "aisdk",
              package: "@ai-sdk/openai-compatible",
              url: "https://api.minimaxi.com/v1",
            },
          })
          catalog.provider.update(item.id, (draft) => {
            draft.endpoint = item.endpoint
          })
        }
      })

      for (const id of ["minimax", "minimax-cn", "minimax-coding-plan", "minimax-cn-coding-plan"]) {
        const model = yield* catalog.model.get(ProviderV2.ID.make(id), ModelV2.ID.make("MiniMax-M3"))
        expect(model.name).toBe("MiniMax-M3")
        expect(model.limit.context).toBe(512_000)
        expect(model.capabilities.input).toContain("image")
        expect(model.capabilities.input).toContain("video")
      }
    }),
  )
})
