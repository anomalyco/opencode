import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { LLMEvent } from "@opencode-ai/llm"
import type { EventV2 } from "@opencode-ai/core/event"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionToolBudgetError } from "@opencode-ai/core/session/error"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { createLLMEventPublisher } from "@opencode-ai/core/session/runner/publish-llm-event"
import { ToolBudget } from "@opencode-ai/core/session/runner/tool-budget"
import { testEffect } from "../../lib/effect"

const it = testEffect(Layer.empty)
const SESSION_ID = ("ses_" + "0".repeat(64)) as SessionSchema.ID
const LIMIT = 5

describe("ToolBudget.observe", () => {
  test("accumulates failures without a success", () => {
    expect(ToolBudget.observe(0, { succeeded: false, trailingFailures: 3 }, LIMIT)).toEqual({
      streak: 3,
      exceeded: false,
    })
  })

  test("trips exactly at the limit", () => {
    expect(ToolBudget.observe(4, { succeeded: false, trailingFailures: 1 }, LIMIT)).toEqual({
      streak: 5,
      exceeded: true,
    })
  })

  test("a success breaks the streak keeping only the trailing tail", () => {
    expect(ToolBudget.observe(4, { succeeded: true, trailingFailures: 2 }, LIMIT)).toEqual({
      streak: 2,
      exceeded: false,
    })
    expect(ToolBudget.observe(4, { succeeded: true, trailingFailures: 0 }, LIMIT)).toEqual({
      streak: 0,
      exceeded: false,
    })
  })

  test("empty outcomes preserve the streak", () => {
    expect(ToolBudget.observe(2, { succeeded: false, trailingFailures: 0 }, LIMIT)).toEqual({
      streak: 2,
      exceeded: false,
    })
  })
})

describe("SessionToolBudgetError", () => {
  test("carries the sessionID, failure count, and limit", () => {
    const err = new SessionToolBudgetError({ sessionID: SESSION_ID, failures: 5, limit: LIMIT })
    expect(err._tag).toBe("Session.ToolBudget")
    expect(err.sessionID).toBe(SESSION_ID)
    expect(err.failures).toBe(5)
    expect(err.limit).toBe(LIMIT)
    expect(err.message).toMatch(/max consecutive tool failures/)
  })
})

describe("publisher tool outcomes", () => {
  const makePublisher = () => {
    const published: Array<{ definition: unknown; payload: unknown }> = []
    const events = {
      publish: (definition: unknown, payload: unknown) => {
        published.push({ definition, payload })
        return Effect.succeed({ definition, payload })
      },
    } as unknown as EventV2.Interface
    const publisher = createLLMEventPublisher(events, {
      sessionID: SESSION_ID,
      agent: "test-agent",
      model: {
        id: ModelV2.ID.make("test-model" as ModelV2.ID),
        providerID: ProviderV2.ID.make("test-provider" as ProviderV2.ID),
      },
    })
    const failed = () => published.filter((event) => event.definition === SessionEvent.Tool.Failed).length
    return { publisher, failed }
  }

  const failTool = (publisher: ReturnType<typeof createLLMEventPublisher>, n: number) =>
    Effect.gen(function* () {
      yield* publisher.publish(LLMEvent.toolCall({ id: `call-${n}`, name: "echo", input: { text: "hi" } }))
      yield* publisher.publish(
        LLMEvent.toolResult({ id: `call-${n}`, name: "echo", result: { type: "error", value: "boom" } }),
      )
    })

  const succeedTool = (publisher: ReturnType<typeof createLLMEventPublisher>, n: number) =>
    Effect.gen(function* () {
      yield* publisher.publish(LLMEvent.toolCall({ id: `call-ok-${n}`, name: "echo", input: { text: "hi" } }))
      yield* publisher.publish(
        LLMEvent.toolResult({ id: `call-ok-${n}`, name: "echo", result: { type: "text", value: "ok" } }),
      )
    })

  it.effect("counts consecutive failures and resets on success", () =>
    Effect.gen(function* () {
      const { publisher, failed } = makePublisher()
      yield* failTool(publisher, 1)
      yield* failTool(publisher, 2)
      expect(publisher.toolOutcomes()).toEqual({ succeeded: false, trailingFailures: 2 })
      expect(failed()).toBe(2)
      yield* succeedTool(publisher, 1)
      expect(publisher.toolOutcomes()).toEqual({ succeeded: true, trailingFailures: 0 })
      yield* failTool(publisher, 3)
      expect(publisher.toolOutcomes()).toEqual({ succeeded: true, trailingFailures: 1 })
      expect(failed()).toBe(3)
    }),
  )

  it.effect("counts tool-error events and unsettled tools as failures", () =>
    Effect.gen(function* () {
      const { publisher, failed } = makePublisher()
      yield* publisher.publish(LLMEvent.toolCall({ id: "call-err", name: "echo", input: { text: "hi" } }))
      yield* publisher.publish(LLMEvent.toolError({ id: "call-err", name: "echo", message: "handler failed" }))
      yield* publisher.publish(LLMEvent.toolCall({ id: "call-pending", name: "echo", input: { text: "hi" } }))
      yield* publisher.failUnsettledTools("interrupted")
      expect(publisher.toolOutcomes()).toEqual({ succeeded: false, trailingFailures: 2 })
      expect(failed()).toBe(2)
    }),
  )
})
