import { expect, test } from "bun:test"
import { ProviderUsage } from "../../src/provider/usage"
import { MessageID, SessionID } from "../../src/session/schema"
import { ModelID, ProviderID } from "../../src/provider/schema"

function assistant(input: { providerID: ProviderID; time: number; input: number; output: number }) {
  return {
    id: MessageID.ascending(),
    sessionID: SessionID.descending(),
    role: "assistant" as const,
    time: {
      created: input.time,
    },
    parentID: MessageID.ascending(),
    modelID: ModelID.make("test"),
    providerID: input.providerID,
    mode: "build",
    agent: "build",
    path: {
      cwd: "/tmp",
      root: "/tmp",
    },
    cost: 0,
    tokens: {
      input: input.input,
      output: input.output,
      reasoning: 0,
      cache: {
        read: 0,
        write: 0,
      },
    },
  }
}

test("summarize aggregates usage by provider", () => {
  const now = new Date("2026-03-20T20:00:00.000Z").getTime()
  const rows = [
    {
      time_created: now - 5 * 60 * 1000,
      data: assistant({
        providerID: ProviderID.openai,
        time: now - 5 * 60 * 1000,
        input: 100,
        output: 50,
      }),
    },
    {
      time_created: now - 4 * 60 * 1000,
      data: assistant({
        providerID: ProviderID.openai,
        time: now - 4 * 60 * 1000,
        input: 20,
        output: 10,
      }),
    },
  ]

  const result = ProviderUsage.summarize(rows, now)
  expect(result[ProviderID.openai]).toBeDefined()
  expect(result[ProviderID.openai].state).toBe("fresh")
  expect(result[ProviderID.openai].ageMinutes).toBe(4)
  expect(result[ProviderID.openai].recentInputTokens).toBe(120)
  expect(result[ProviderID.openai].recentOutputTokens).toBe(60)
})

test("summarize marks stale usage", () => {
  const now = new Date("2026-03-20T20:00:00.000Z").getTime()
  const rows = [
    {
      time_created: now - 2 * 60 * 60 * 1000,
      data: assistant({
        providerID: ProviderID.anthropic,
        time: now - 2 * 60 * 60 * 1000,
        input: 10,
        output: 5,
      }),
    },
  ]

  const result = ProviderUsage.summarize(rows, now)
  expect(result[ProviderID.anthropic]).toBeDefined()
  expect(result[ProviderID.anthropic].state).toBe("stale")
  expect(result[ProviderID.anthropic].ageMinutes).toBe(120)
})

test("summarize ignores invalid and non-assistant rows", () => {
  const now = new Date("2026-03-20T20:00:00.000Z").getTime()
  const rows = [
    {
      time_created: now - 60_000,
      data: {
        role: "user",
      },
    },
    {
      time_created: now - 60_000,
      data: {
        role: "assistant",
      },
    },
  ]

  const result = ProviderUsage.summarize(rows, now)
  expect(Object.keys(result)).toHaveLength(0)
})
