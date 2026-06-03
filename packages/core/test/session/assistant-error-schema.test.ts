import { describe, expect, test } from "bun:test"
import { DateTime, Schema } from "effect"
import { EventV2 } from "@opencode-ai/core/event"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionSchema } from "@opencode-ai/core/session/schema"

const sessionID = SessionSchema.ID.make("ses_assistant_error_schema")
const model = {
  id: ModelV2.ID.make("model"),
  providerID: ProviderV2.ID.make("provider"),
}
const millis = Date.parse("2026-01-01T00:00:00.000Z")
const eventTime = DateTime.makeUnsafe(millis)

const errors: SessionEvent.AssistantError[] = [
  { type: "aborted", message: "Aborted" },
  {
    type: "api",
    message: "provider returned 429",
    statusCode: 429,
    isRetryable: true,
    responseHeaders: { "retry-after": "1" },
    responseBody: "rate limited",
    metadata: { provider: "test" },
  },
  { type: "auth", providerID: "test", message: "missing API key" },
  { type: "context_overflow", message: "too many tokens", responseBody: "..." },
  { type: "output_length" },
  { type: "structured_output", message: "schema mismatch", retries: 2 },
  { type: "unknown", message: "boom" },
]

function failedStep(error: SessionEvent.AssistantError) {
  return { sessionID, timestamp: eventTime, error }
}

function assistantMessage(error: unknown) {
  return {
    id: EventV2.ID.make("evt_assistant_error_schema"),
    type: "assistant",
    agent: "build",
    model,
    content: [],
    error,
    time: { created: millis, completed: millis },
  }
}

describe("assistant rich error schema", () => {
  for (const error of errors) {
    test(`roundtrips ${error.type} assistant errors through event and message schemas`, () => {
      const decoded = EventV2.decodeData(SessionEvent.Step.Failed, EventV2.encodeData(SessionEvent.Step.Failed, failedStep(error)))
      expect(decoded.error).toEqual(error)

      expect(Schema.decodeUnknownSync(SessionMessage.Message)(assistantMessage(error))).toMatchObject({ error })
    })
  }

  test("rejects invalid rich assistant error shapes", () => {
    expect(() =>
      EventV2.decodeData(SessionEvent.Step.Failed, {
        sessionID,
        timestamp: millis,
        error: { type: "api", message: "provider returned 429", statusCode: 429 },
      }),
    ).toThrow()

    expect(() =>
      Schema.decodeUnknownSync(SessionMessage.Message)(assistantMessage({ type: "provider", message: "boom" })),
    ).toThrow()
  })

  test("keeps tool failures limited to unknown errors", () => {
    expect(
      EventV2.decodeData(SessionEvent.Tool.Failed, {
        sessionID,
        timestamp: millis,
        callID: "call_1",
        error: { type: "unknown", message: "tool failed" },
        provider: { executed: true },
      }).error,
    ).toEqual({ type: "unknown", message: "tool failed" })

    expect(() =>
      EventV2.decodeData(SessionEvent.Tool.Failed, {
        sessionID,
        timestamp: millis,
        callID: "call_1",
        error: { type: "api", message: "provider returned 429", statusCode: 429, isRetryable: true },
        provider: { executed: true },
      }),
    ).toThrow()
  })
})
