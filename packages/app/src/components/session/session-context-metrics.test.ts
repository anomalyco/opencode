import { describe, expect, test } from "bun:test"
import type { Message } from "@opencode-ai/sdk/v2/client"
import { getSessionContext } from "./session-context-metrics"

const assistant = (
  id: string,
  tokens: { input: number; output: number; reasoning: number; read: number; write: number },
  cost: number,
  providerID = "openai",
  modelID = "gpt-4.1",
) => {
  return {
    id,
    role: "assistant",
    providerID,
    modelID,
    cost,
    tokens: {
      input: tokens.input,
      output: tokens.output,
      reasoning: tokens.reasoning,
      cache: {
        read: tokens.read,
        write: tokens.write,
      },
    },
    time: { created: 1 },
  } as unknown as Message
}

const user = (id: string) => {
  return {
    id,
    role: "user",
    cost: 0,
    time: { created: 1 },
  } as unknown as Message
}

describe("getSessionContext", () => {
  test("computes token totals and usage from latest assistant with tokens", () => {
    const messages = [
      user("u1"),
      assistant("a1", { input: 600, output: 200, reasoning: 100, read: 50, write: 50 }, 0.5),
      assistant("a2", { input: 300, output: 100, reasoning: 50, read: 25, write: 25 }, 1.25),
    ]
    const providers = [
      {
        id: "openai",
        name: "OpenAI",
        models: {
          "gpt-4.1": {
            name: "GPT-4.1",
            limit: { context: 1000 },
          },
        },
      },
    ]

    const ctx = getSessionContext(messages, providers)

    expect(ctx?.message.id).toBe("a2")
    expect(ctx?.total).toBe(500)
    expect(ctx?.input).toBe(300)
    expect(ctx?.usage).toBe(50)
    expect(ctx?.providerLabel).toBe("OpenAI")
    expect(ctx?.modelLabel).toBe("GPT-4.1")
  })

  test("preserves fallback labels and null usage when model metadata is missing", () => {
    const messages = [assistant("a1", { input: 40, output: 10, reasoning: 0, read: 0, write: 0 }, 0.1, "p-1", "m-1")]
    const providers = [{ id: "p-1", models: {} }]

    const ctx = getSessionContext(messages, providers)

    expect(ctx?.providerLabel).toBe("p-1")
    expect(ctx?.modelLabel).toBe("m-1")
    expect(ctx?.limit).toBeUndefined()
    expect(ctx?.usage).toBeNull()
  })

  test("recomputes when message array is mutated in place", () => {
    const messages = [assistant("a1", { input: 10, output: 10, reasoning: 10, read: 10, write: 10 }, 0.25)]
    const providers = [{ id: "openai", models: {} }]

    const one = getSessionContext(messages, providers)
    messages.push(assistant("a2", { input: 100, output: 20, reasoning: 0, read: 0, write: 0 }, 0.75))
    const two = getSessionContext(messages, providers)

    expect(one?.message.id).toBe("a1")
    expect(two?.message.id).toBe("a2")
  })

  test("returns undefined when inputs are undefined", () => {
    const ctx = getSessionContext(undefined, undefined)

    expect(ctx).toBeUndefined()
  })

  test("prefers the provider-reported total over the token sum", () => {
    const messages = [
      {
        id: "a1",
        role: "assistant",
        providerID: "openai",
        modelID: "gpt-4.1",
        cost: 0.5,
        tokens: { total: 800, input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: 1 },
      } as unknown as Message,
    ]
    const providers = [{ id: "openai", models: { "gpt-4.1": { limit: { context: 1000 } } } }]

    const ctx = getSessionContext(messages, providers)

    expect(ctx?.message.id).toBe("a1")
    expect(ctx?.total).toBe(800)
    expect(ctx?.usage).toBe(80)
  })

  test("skips an interrupt estimate when a reported value exists", () => {
    const messages = [
      {
        id: "reported",
        role: "assistant",
        providerID: "openai",
        modelID: "gpt-4.1",
        cost: 0.5,
        tokens: { total: 800, input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: 1 },
      } as unknown as Message,
      {
        id: "estimated",
        role: "assistant",
        providerID: "openai",
        modelID: "gpt-4.1",
        cost: 0,
        error: { name: "MessageAbortedError" },
        tokens: { input: 100, output: 10, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: 2 },
      } as unknown as Message,
    ]
    const providers = [{ id: "openai", models: { "gpt-4.1": { limit: { context: 1000 } } } }]

    const ctx = getSessionContext(messages, providers)

    expect(ctx?.message.id).toBe("reported")
  })

  test("uses an interrupt estimate when no reported usage exists", () => {
    const messages = [
      {
        id: "estimated",
        role: "assistant",
        providerID: "openai",
        modelID: "gpt-4.1",
        cost: 0,
        error: { name: "MessageAbortedError" },
        tokens: { input: 100, output: 10, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: 1 },
      } as unknown as Message,
    ]
    const providers = [{ id: "openai", models: { "gpt-4.1": { limit: { context: 1000 } } } }]

    const ctx = getSessionContext(messages, providers)

    expect(ctx?.message.id).toBe("estimated")
  })
})
