import { describe, expect, test } from "bun:test"
import { cycleVariant, formatModelLabel, pickVariant, resolveVariant } from "../../src/mini/variant.shared"
import type { RunSession } from "../../src/mini/session.shared"
import type { RunProvider } from "../../src/mini/types"

const model = {
  providerID: "openai",
  modelID: "gpt-5",
}

const providers: RunProvider[] = [
  {
    id: "openai",
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
    expect(resolveVariant("max", "high", "low", ["low", "high"])).toBe("max")
    expect(resolveVariant("default", "high", "low", ["low", "high"])).toBeUndefined()
    expect(resolveVariant(undefined, "high", "low", ["low", "high"])).toBe("high")
    expect(resolveVariant(undefined, "missing", "low", ["low", "high"])).toBe("low")
  })

  test("cycles through variants and back to default", () => {
    expect(cycleVariant(undefined, ["low", "high"])).toBe("low")
    expect(cycleVariant("default", ["low", "high"])).toBe("low")
    expect(cycleVariant("low", ["low", "high"])).toBe("high")
    expect(cycleVariant("high", ["low", "high"])).toBeUndefined()
    expect(cycleVariant(undefined, [])).toBeUndefined()
  })

  test("formats model labels", () => {
    expect(formatModelLabel(model, undefined)).toBe("gpt-5 · openai")
    expect(formatModelLabel(model, "high")).toBe("gpt-5 · openai · high")
    expect(formatModelLabel(model, undefined, providers)).toBe("GPT-5 · OpenAI")
    expect(formatModelLabel(model, "high", providers)).toBe("GPT-5 · OpenAI · high")
  })

  test("formats model labels like the prompt", () => {
    const sol = { providerID: "console-openai", modelID: "gpt-6.1-sol" }
    const native: RunProvider = {
      id: "opencode",
      name: "Anomaly / OpenCode",
      integrationID: "opencode",
      models: { "gpt-6.1-sol": { name: "GPT-6.1 Sol (latest)" } },
    }
    const managed: RunProvider = {
      id: "console-openai",
      name: "Anomaly / OpenAI",
      integrationID: "opencode",
      canonical: "openai",
      models: { "gpt-6.1-sol": { name: "GPT-6.1 Sol" } },
    }

    expect(formatModelLabel({ providerID: "opencode", modelID: "gpt-6.1-sol" }, "high", [native])).toBe(
      "GPT-6.1 Sol · high",
    )
    expect(formatModelLabel(sol, undefined, [native, managed])).toBe("GPT-6.1 Sol · OpenAI")
    expect(formatModelLabel(sol, undefined, [native, managed, ...providers])).toBe("GPT-6.1 Sol · OpenCode / OpenAI")
    expect(formatModelLabel({ providerID: "openai", modelID: "missing" }, undefined, providers)).toBe(
      "missing · OpenAI",
    )
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
