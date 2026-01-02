import { describe, expect, test } from "bun:test"
import type { Hooks } from "@opencode-ai/plugin"
import type { Model } from "@opencode-ai/sdk"

describe("chat.variant hook", () => {
  test("should accept valid hook definition with variant override", async () => {
    // #given
    const hook: Hooks["chat.variant"] = async (input, output) => {
      output.variant = "high"
    }

    const input = {
      sessionID: "test-session",
      agent: "build",
      model: { id: "claude-sonnet-4" } as Model,
      currentVariant: undefined,
      availableVariants: ["high", "max"],
    }
    const output = { variant: undefined as string | undefined, options: {} }

    // #when
    await hook!(input, output)

    // #then
    expect(output.variant).toBe("high")
  })

  test("should accept valid hook definition with options override", async () => {
    // #given
    const hook: Hooks["chat.variant"] = async (input, output) => {
      output.options = { thinking: { budget_tokens: 50000 } }
    }

    const input = {
      sessionID: "test-session",
      agent: "build",
      model: { id: "claude-sonnet-4" } as Model,
      currentVariant: "high",
      availableVariants: ["high", "max"],
    }
    const output = { variant: "high" as string | undefined, options: {} as Record<string, any> }

    // #when
    await hook!(input, output)

    // #then
    expect(output.options).toEqual({ thinking: { budget_tokens: 50000 } })
  })

  test("should preserve currentVariant when hook does not modify output", async () => {
    // #given
    const hook: Hooks["chat.variant"] = async (_input, _output) => {}

    const input = {
      sessionID: "test-session",
      agent: "build",
      model: { id: "claude-sonnet-4" } as Model,
      currentVariant: "max",
      availableVariants: ["high", "max"],
    }
    const output = { variant: "max" as string | undefined, options: {} }

    // #when
    await hook!(input, output)

    // #then
    expect(output.variant).toBe("max")
  })

  test("should receive correct input parameters", async () => {
    // #given
    let receivedInput: Parameters<NonNullable<Hooks["chat.variant"]>>[0] | undefined

    const hook: Hooks["chat.variant"] = async (input, _output) => {
      receivedInput = input
    }

    const input = {
      sessionID: "ses_123",
      agent: "plan",
      model: { id: "gpt-4", providerID: "openai" } as Model,
      currentVariant: "high",
      availableVariants: ["low", "high", "max"],
    }
    const output = { variant: "high" as string | undefined, options: {} }

    // #when
    await hook!(input, output)

    // #then
    expect(receivedInput).toBeDefined()
    expect(receivedInput!.sessionID).toBe("ses_123")
    expect(receivedInput!.agent).toBe("plan")
    expect(receivedInput!.model.id).toBe("gpt-4")
    expect(receivedInput!.currentVariant).toBe("high")
    expect(receivedInput!.availableVariants).toEqual(["low", "high", "max"])
  })
})
