import { expect, test } from "bun:test"
import type { SessionMessageAssistant } from "@opencode/client"
import { contextUsage } from "../src/usage"

const message = {
  id: "msg_usage",
  type: "assistant",
  time: { created: 1 },
  agent: "build",
  model: { id: "model", providerID: "provider" },
  content: [],
  tokens: { input: 100, output: 20, reasoning: 10, cache: { read: 40, write: 30 } },
} satisfies SessionMessageAssistant

test("counts all token categories against the matching provider model", () => {
  const result = contextUsage(
    [message],
    [
      {
        id: "provider/model",
        modelID: "model",
        providerID: "provider",
        name: "Model",
        limit: { context: 1000, output: 100 },
      },
    ],
    [{ id: "provider", name: "Provider" }],
  )
  expect(result).toMatchObject({
    total: 200,
    input: 100,
    usage: 20,
    limit: 1000,
    modelLabel: "Model",
    providerLabel: "Provider",
  })
})

test("uses the newest metered message and handles missing metadata", () => {
  const result = contextUsage(
    [
      message,
      { ...message, id: "msg_latest", tokens: { ...message.tokens, input: 200 } },
      { ...message, id: "msg_streaming", tokens: undefined },
    ],
    [],
    [],
  )
  expect(result).toMatchObject({
    message: { id: "msg_latest" },
    total: 300,
    usage: null,
    modelLabel: "model",
    providerLabel: "provider",
  })
  expect(contextUsage([], [], [])).toBeUndefined()
})
