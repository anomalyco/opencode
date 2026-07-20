import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Provider } from "@/provider/provider"
import { estimateContext, resolveBuildModel, tokenCount } from "@/tool/plan-context"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import type { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import { ProviderTest } from "../fake/provider"

const config: ConfigV1.Info = {}

function tokens(input: Partial<SessionV1.Assistant["tokens"]> = {}): SessionV1.Assistant["tokens"] {
  return {
    input: 0,
    output: 0,
    reasoning: 0,
    cache: { read: 0, write: 0 },
    ...input,
  }
}

describe("plan context", () => {
  test("preserves total token accounting and falls back to component totals", () => {
    expect(tokenCount(tokens({ total: 12, input: 20, output: 3 }))).toBe(12)
    expect(tokenCount(tokens({ input: 20, output: 3, cache: { read: 4, write: 5 } }))).toBe(32)
  })

  test("calculates usage from the input limit and recommends at overflow", () => {
    const model = ProviderTest.model({ limit: { context: 100, output: 10 } })

    expect(estimateContext({ cfg: config, model, tokens: tokens({ input: 90 }) })).toEqual({
      percent: 90,
      recommended: true,
    })

    const inputLimited = ProviderTest.model({ limit: { context: 200, input: 100, output: 10 } })
    expect(estimateContext({ cfg: config, model: inputLimited, tokens: tokens({ input: 75 }) })).toEqual({
      percent: 75,
      recommended: false,
    })
  })

  test("returns no estimate for zero context or unavailable usage", () => {
    const model = ProviderTest.model({ limit: { context: 0, output: 10 } })
    expect(estimateContext({ cfg: config, model, tokens: tokens({ input: 10 }) })).toBeUndefined()

    const bounded = ProviderTest.model({ limit: { context: 100, output: 10 } })
    expect(estimateContext({ cfg: config, model: bounded, tokens: tokens() })).toBeUndefined()
  })

  test("resolves the build model and falls back to the provider default", async () => {
    const explicit = ProviderTest.model({ id: ModelV2.ID.make("explicit-model") })
    const fallback = ProviderTest.model({ id: ModelV2.ID.make("fallback-model") })
    const provider = {
      defaultModel: () => Effect.succeed({ providerID: fallback.providerID, modelID: fallback.id }),
      getModel: (_providerID: string, modelID: string) => Effect.succeed(modelID === explicit.id ? explicit : fallback),
    } satisfies Pick<Provider.Interface, "defaultModel" | "getModel">

    await expect(
      Effect.runPromise(
        resolveBuildModel({
          agent: { model: { providerID: explicit.providerID, modelID: explicit.id } },
          provider,
        }),
      ),
    ).resolves.toBe(explicit)

    await expect(Effect.runPromise(resolveBuildModel({ agent: {}, provider }))).resolves.toBe(fallback)
  })

  test("does not block when model resolution fails", async () => {
    const provider = {
      defaultModel: () => Effect.fail(new Provider.NoProvidersError()),
      getModel: (providerID: string, modelID: string) =>
        Effect.fail(
          new Provider.ModelNotFoundError({
            providerID: ProviderV2.ID.make(providerID),
            modelID: ModelV2.ID.make(modelID),
          }),
        ),
    } satisfies Pick<Provider.Interface, "defaultModel" | "getModel">

    await expect(Effect.runPromise(resolveBuildModel({ agent: {}, provider }))).resolves.toBeUndefined()
  })
})
