import { describe, expect, test } from "bun:test"
import type { AssistantMessage, Model } from "@opencode-ai/sdk/v2"
import { contextLimit, formatSessionCost } from "../../src/util/accounting"

function assistant(providerID: string, cost: number): AssistantMessage {
  return {
    id: "message",
    sessionID: "session",
    role: "assistant",
    time: { created: 0 },
    parentID: "user",
    modelID: "model",
    providerID,
    mode: "build",
    agent: "build",
    path: { cwd: "/", root: "/" },
    cost,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  }
}

describe("util.accounting", () => {
  test("converts Copilot and enterprise session USD totals to AI credits", () => {
    expect(formatSessionCost(0.0125, [assistant("github-copilot", 0.0125)])).toBe("1.25 AI credits")
    expect(formatSessionCost(12.34, [assistant("github-copilot-enterprise", 12.34)])).toBe("1,234.00 AI credits")
    expect(formatSessionCost(0, [assistant("github-copilot", 0)])).toBe("0.00 AI credits")
    expect(
      formatSessionCost(0.3, [assistant("github-copilot", 0.1), assistant("github-copilot-enterprise", 0.2)]),
    ).toBe("30.00 AI credits")
  })

  test("keeps USD for other providers, mixed sessions, and unaccounted history", () => {
    expect(formatSessionCost(0.25, [assistant("openai", 0.25)])).toBe("$0.25")
    expect(formatSessionCost(0.25, [assistant("openai", 0.15), assistant("github-copilot", 0.1)])).toBe("$0.25")
    expect(formatSessionCost(0.1, [assistant("openai", 0), assistant("github-copilot", 0.1)])).toBe("$0.10")
    expect(formatSessionCost(0.25, [assistant("github-copilot", 0.1)])).toBe("$0.25")
    expect(formatSessionCost(0, [])).toBe("$0.00")
  })

  const model: Pick<Model, "limit" | "options" | "variants"> = {
    limit: { context: 1_050_000, input: 1_000_000, output: 32_000 },
    options: { copilotContext: { default: 200_000, long: 1_000_000 } },
    variants: {
      "high@default": { copilotContextTier: "default" },
      "high@long": { copilotContextTier: "long" },
      custom: { copilotContextTier: "long" },
    },
  }

  test("uses the response variant's effective context window including output", () => {
    expect(contextLimit(model)).toBe(232_000)
    expect(contextLimit(model, "high@default")).toBe(232_000)
    expect(contextLimit(model, "high@long")).toBe(1_032_000)
    expect(contextLimit(model, "custom")).toBe(1_032_000)
    expect(contextLimit(model, "missing@long")).toBe(1_032_000)
    expect(contextLimit({ ...model, limit: { ...model.limit, context: 1_000_000 } }, "high@long")).toBe(1_000_000)
  })

  test("preserves ordinary context limits and handles missing or invalid metadata", () => {
    expect(contextLimit({ ...model, options: {} }, "high@long")).toBe(model.limit.context)
    expect(contextLimit({ ...model, options: { copilotContext: { default: 0, long: 1_000_000 } } })).toBe(
      model.limit.context,
    )
    expect(contextLimit({ ...model, options: { copilotContext: { default: "200000", long: 1_000_000 } } })).toBe(
      model.limit.context,
    )
    expect(contextLimit(undefined)).toBeUndefined()
  })
})
