import { afterEach, describe, expect } from "bun:test"
import { Effect } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import type { Provider } from "../../src/provider/provider"
import { SystemPrompt } from "../../src/session/system"
import { disposeAllInstances } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(AppNodeBuilder.build(SystemPrompt.node))

function model(id: string, extra?: Partial<Provider.Model>) {
  return { providerID: "test", api: { id }, ...extra } as Provider.Model
}

const environment = (input: Provider.Model) => SystemPrompt.Service.use((svc) => svc.environment(input))

afterEach(async () => {
  await disposeAllInstances()
})

describe("system prompt environment identity line", () => {
  it.instance("keeps the identity line on vendor and default tiers by default", () =>
    Effect.gen(function* () {
      const vendor = yield* environment(model("claude-sonnet-4-5"))
      expect(vendor[0]).toContain("You are powered by the model named claude-sonnet-4-5")

      const fallback = yield* environment(model("some-unknown-model"))
      expect(fallback[0]).toContain("You are powered by the model named some-unknown-model")
    }),
  )

  it.instance("omits the identity line on the minimal tier by default", () =>
    Effect.gen(function* () {
      const env = yield* environment(model("qwen3.5-4b"))
      expect(env[0]).not.toContain("You are powered by")
      expect(env[0]).toContain("<env>")
    }),
  )

  it.instance(
    "config flag omits the identity line everywhere",
    () =>
      Effect.gen(function* () {
        const env = yield* environment(model("claude-sonnet-4-5"))
        expect(env[0]).not.toContain("You are powered by")
      }),
    { config: { experimental: { omit_model_identity: true } } },
  )

  it.instance(
    "explicit false keeps the identity line even on minimal",
    () =>
      Effect.gen(function* () {
        const env = yield* environment(model("qwen3.5-4b"))
        expect(env[0]).toContain("You are powered by the model named qwen3.5-4b")
      }),
    { config: { experimental: { omit_model_identity: false } } },
  )
})
