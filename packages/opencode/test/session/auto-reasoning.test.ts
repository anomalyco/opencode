import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import type { ModelMessage } from "ai"
import { AutoReasoning } from "@/session/auto-reasoning"
import { LLMRequestPrep } from "@/session/llm/request"

describe("AutoReasoning.classify", () => {
  test("short simple prompts resolve to low", () => {
    expect(AutoReasoning.classify("what time is it", 0)).toBe("low")
  })

  test("implementation work resolves above low", () => {
    expect(AutoReasoning.classify("implement a migration to the new auth architecture", 0)).toBe("medium")
    expect(
      AutoReasoning.classify("implement a migration and debug the race condition in the auth architecture", 0),
    ).toBe("high")
  })

  test("explicit override wins", () => {
    expect(AutoReasoning.classify("[think:xhigh] rename this file", 0)).toBe("xhigh")
    expect(AutoReasoning.classify("[reasoning:low] refactor the entire auth system", 0)).toBe("low")
  })

  test("attachments raise the effort", () => {
    expect(AutoReasoning.classify("look at this", 2)).not.toBe("low")
  })
})

describe("AutoReasoning.selectVariant", () => {
  test("picks the closest available effort", () => {
    const variants = { low: {}, medium: {}, high: {} }
    expect(AutoReasoning.selectVariant(variants, "low")).toBe("low")
    expect(AutoReasoning.selectVariant(variants, "high")).toBe("high")
  })

  test("clamps when the exact effort is missing", () => {
    const variants = { low: {}, high: {} }
    expect(AutoReasoning.selectVariant(variants, "medium")).toBe("low")
    expect(AutoReasoning.selectVariant(variants, "xhigh")).toBe("high")
  })

  test("ignores the auto sentinel and default", () => {
    const variants = { auto: {}, default: {}, low: {}, max: {} }
    expect(AutoReasoning.selectVariant(variants, "xhigh")).toBe("max")
  })

  test("returns undefined when no effort variants exist", () => {
    expect(AutoReasoning.selectVariant({ auto: {} }, "high")).toBeUndefined()
  })
})

describe("AutoReasoning.promptText", () => {
  test("reads the last user message", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "first" },
      { role: "assistant", content: "reply" },
      { role: "user", content: "second" },
    ]
    expect(AutoReasoning.promptText(messages).text).toBe("second")
  })

  test("joins text parts and counts attachments", () => {
    const messages: ModelMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "describe " },
          { type: "text", text: "this" },
          { type: "file", data: "data:image/png;base64,AAAA", mediaType: "image/png" },
        ],
      },
    ]
    expect(AutoReasoning.promptText(messages)).toEqual({ text: "describe this", attachments: 1 })
  })
})

describe("AutoReasoning in LLMRequestPrep", () => {
  const model = {
    id: "openai/gpt-5",
    providerID: "openai",
    api: { id: "gpt-5", url: "https://api.openai.com/v1", npm: "@ai-sdk/openai" },
    name: "GPT-5",
    capabilities: { temperature: false, reasoning: true, attachment: true, toolcall: true },
    options: {},
    limit: { context: 400_000, output: 128_000 },
    variants: {
      low: { reasoningEffort: "low" },
      medium: { reasoningEffort: "medium" },
      high: { reasoningEffort: "high" },
    },
  }

  function prepare(content: string, variant: string = AutoReasoning.VARIANT) {
    return Effect.runPromise(
      LLMRequestPrep.prepare({
        user: {
          id: "msg_user",
          sessionID: "session",
          role: "user",
          time: { created: Date.now() },
          agent: "test",
          model: { providerID: "openai", modelID: "gpt-5", variant },
        } as any,
        sessionID: "session",
        model: model as any,
        agent: { name: "test", mode: "primary", options: {}, permission: [] } as any,
        system: [],
        messages: [{ role: "user", content }],
        tools: {},
        provider: { id: "openai", options: {} } as any,
        auth: undefined,
        plugin: {
          trigger: (_name: string, _input: unknown, output: unknown) => Effect.succeed(output),
          list: () => Effect.succeed([]),
          init: () => Effect.void,
        } as any,
        flags: { outputTokenMax: 32_000, client: "test" } as any,
        isWorkflow: false,
      }),
    )
  }

  test("simple prompt selects the low effort variant", async () => {
    expect((await prepare("what time is it")).params.options.reasoningEffort).toBe("low")
  })

  test("complex prompt selects the high effort variant", async () => {
    const text = "implement a migration of the auth architecture and debug the race condition"
    expect((await prepare(text)).params.options.reasoningEffort).toBe("high")
  })

  test("a literal variant still wins when configured", async () => {
    expect((await prepare("what time is it", "high")).params.options.reasoningEffort).toBe("high")
  })
})
