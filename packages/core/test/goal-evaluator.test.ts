import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { GoalEvaluator } from "@opencode-ai/opencode/session/goal-evaluator"
import { testEffect } from "./lib/effect"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { SessionV1 } from "@opencode-ai/core/v1/session"

const it = testEffect(GoalEvaluator.defaultLayer)

describe("GoalEvaluator", () => {
  const defaultProviderID = ProviderV2.ID.make("test-provider")
  const defaultModelID = ModelV2.ID.make("test-model")

  it.effect("evaluate returns met: false for empty transcript", () =>
    Effect.gen(function* () {
      const evaluator = yield* GoalEvaluator.Service
      const result = yield* evaluator.evaluate({
        condition: "All tests pass",
        messages: [],
        defaultProviderID,
        defaultModelID,
      })
      expect(result.met).toBe(false)
      expect(result.reason).toBeDefined()
    }),
  )

  it.effect("evaluate returns met: false when condition not demonstrated", () =>
    Effect.gen(function* () {
      const evaluator = yield* GoalEvaluator.Service
      const messages: SessionV1.WithParts[] = [
        {
          info: {
            id: "msg-1",
            sessionID: "session-1",
            role: "user",
            time: { created: Date.now() },
          },
          parts: [
            {
              type: "text",
              id: "part-1",
              messageID: "msg-1",
              sessionID: "session-1",
              text: "Run the tests",
            },
          ],
        },
        {
          info: {
            id: "msg-2",
            sessionID: "session-1",
            role: "assistant",
            time: { created: Date.now() },
          },
          parts: [
            {
              type: "text",
              id: "part-2",
              messageID: "msg-2",
              sessionID: "session-1",
              text: "I'll run the tests now.",
            },
          ],
        },
      ]
      const result = yield* evaluator.evaluate({
        condition: "All tests pass",
        messages,
        defaultProviderID,
        defaultModelID,
      })
      expect(result.met).toBe(false)
    }),
  )

  it.effect("evaluate handles custom evaluator model", () =>
    Effect.gen(function* () {
      const evaluator = yield* GoalEvaluator.Service
      const result = yield* evaluator.evaluate({
        condition: "All tests pass",
        messages: [],
        evaluatorModel: { providerID: "anthropic", modelID: "claude-3-haiku" },
        defaultProviderID,
        defaultModelID,
      })
      expect(result).toBeDefined()
      expect(typeof result.met).toBe("boolean")
      expect(typeof result.reason).toBe("string")
    }),
  )
})
