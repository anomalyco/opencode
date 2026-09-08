import { describe, expect } from "bun:test"
import { LLM } from "@opencode/ai"
import { compileRequest } from "@opencode/ai/route/client"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/core/provider"
import { ModelResolver } from "@opencode/core/model-resolver"
import { Effect } from "effect"
import { it } from "./lib/effect"

describe("Claude thinking-binding release policy", () => {
  for (const fixture of [
    { id: "claude-new-family-1", released: "2026-09-01", enabled: true },
    { id: "claude-opus-5", released: "2026-08-31", enabled: false },
    { id: "claude-fable-5-1", released: "1970-01-01", enabled: true },
    { id: "kimi-new-1", released: "2027-01-01", enabled: false },
  ]) {
    it.effect(`${fixture.id} released ${fixture.released}`, () =>
      Effect.gen(function* () {
        const selected = yield* ModelResolver.fromCatalogModel(
          Model.Info.make({
            ...Model.Info.default(Provider.ID.anthropic, Model.ID.make(fixture.id)),
            modelID: Model.ID.make(fixture.id),
            package: Provider.aisdk("@ai-sdk/anthropic"),
            time: { released: Date.parse(fixture.released) },
            settings: { apiKey: "test", thinking: { type: "adaptive", display: "summarized" } },
          }),
        )
        const prepared = yield* compileRequest(LLM.request({ model: selected, prompt: "Hello" }))
        expect(prepared.body.thinking).toEqual({
          type: "adaptive",
          display: "summarized",
          ...(fixture.enabled ? { block_binding: { prefix_mismatch_behavior: "drop_block" } } : {}),
        })
      }),
    )
  }
})
