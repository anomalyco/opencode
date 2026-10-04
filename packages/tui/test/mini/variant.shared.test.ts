import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
import { describe, expect, test } from "bun:test"
import { cycleVariant, formatModelLabel, pickVariant, resolveVariant } from "../../src/mini/variant.shared"
import type { RunSession } from "../../src/mini/session.shared"
import type { RunProvider } from "../../src/mini/types"

const model = {
  providerID: Provider.ID.make("openai", { disableChecks: true }),
  modelID: Model.ID.make("gpt-5", { disableChecks: true }),
}

const providers: RunProvider[] = [
  {
    id: Provider.ID.make("openai", { disableChecks: true }),
    name: "OpenAI",
    models: {
      "gpt-5": {
        name: "GPT-5",
      },
    },
  },
]

describe("run variant shared", () => {
  test("prefers cli then session then saved variants", () => {
    expect(resolveVariant("max", "high", "low", ["low", "high"])).toBe(
      Model.VariantID.make("max", { disableChecks: true }),
    )
    expect(resolveVariant("default", "high", "low", ["low", "high"])).toBeUndefined()
    expect(resolveVariant(undefined, "high", "low", ["low", "high"])).toBe(
      Model.VariantID.make("high", { disableChecks: true }),
    )
    expect(resolveVariant(undefined, "missing", "low", ["low", "high"])).toBe(
      Model.VariantID.make("low", { disableChecks: true }),
    )
  })

  test("cycles through variants and back to default", () => {
    expect(cycleVariant(undefined, ["low", "high"])).toBe(Model.VariantID.make("low", { disableChecks: true }))
    expect(cycleVariant("default", ["low", "high"])).toBe(Model.VariantID.make("low", { disableChecks: true }))
    expect(cycleVariant("low", ["low", "high"])).toBe(Model.VariantID.make("high", { disableChecks: true }))
    expect(cycleVariant("high", ["low", "high"])).toBeUndefined()
    expect(cycleVariant(undefined, [])).toBeUndefined()
  })

  test("formats model labels", () => {
    expect(formatModelLabel(model, undefined)).toBe("gpt-5 · openai")
    expect(formatModelLabel(model, "high")).toBe("gpt-5 · openai · high")
    expect(formatModelLabel(model, undefined, providers)).toBe("GPT-5 · OpenAI")
    expect(formatModelLabel(model, "high", providers)).toBe("GPT-5 · OpenAI · high")
  })

  test("picks the latest matching variant from session history", () => {
    const session: RunSession = {
      first: false,
      turns: [
        { prompt: { text: "one", parts: [] }, provider: "openai", model: "gpt-5", variant: "high" },
        { prompt: { text: "two", parts: [] }, provider: "anthropic", model: "sonnet", variant: "max" },
        { prompt: { text: "three", parts: [] }, provider: "openai", model: "gpt-5", variant: "minimal" },
      ],
    }

    expect(pickVariant(model, session)).toBe("minimal")
  })
})
