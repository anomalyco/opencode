import { describe, expect, test } from "bun:test"
import {
  assistantMessage,
  event,
  toolPart,
  userMessage,
  validateTimelineEvent,
  validateTimelineMessages,
  type PartSeed,
} from "./fixture"

describe("timeline fixture validation", () => {
  test("accepts a valid timeline", () => {
    expect(validateTimelineMessages([userMessage(), assistantMessage()])).toHaveLength(2)
  })

  test("rejects malformed SDK values at runtime", () => {
    expect(() =>
      assistantMessage([], {
        error: { name: "APIError", data: { message: "failed" } } as never,
      }),
    ).toThrow()
    expect(() =>
      validateTimelineEvent({
        directory: "C:/OpenCode/TimelineStability",
        payload: {
          id: "evt_invalid_status",
          type: "session.status",
          properties: { sessionID: "ses_timeline_stability", status: { type: "retry", attempt: 1 } },
        },
      }),
    ).toThrow()
  })

  test("rejects duplicate IDs and orphan assistants", () => {
    expect(() => validateTimelineMessages([userMessage(), userMessage()])).toThrow(/duplicate message ID/)
    expect(() =>
      validateTimelineMessages([userMessage(), assistantMessage([], { parentID: "msg_missing_parent" })]),
    ).toThrow(/parent user/)
  })

  test("assigns deterministic event IDs", () => {
    const first = event("session.status", { sessionID: "ses_timeline_stability", status: { type: "busy" } })
    const second = event("session.status", { sessionID: "ses_timeline_stability", status: { type: "idle" } })
    expect(first.payload.id).toMatch(/^evt_timeline_\d{4}$/)
    expect(Number(second.payload.id.slice(-4))).toBe(Number(first.payload.id.slice(-4)) + 1)
  })
})

if (false) {
  const userSeed = { id: "prt_type_user", type: "text", text: "typed" } satisfies PartSeed<"user">
  userMessage([userSeed])

  // @ts-expect-error Tool completion fields are not valid while pending.
  toolPart("prt_invalid_pending", "bash", "pending", {}, { output: "impossible" })
  // @ts-expect-error Tool completion fields are not valid while running.
  toolPart("prt_invalid_running", "bash", "running", {}, { output: "impossible" })
  // @ts-expect-error Tool error fields are not valid after completion.
  toolPart("prt_invalid_completed", "bash", "completed", {}, { error: "impossible" })

  assistantMessage([
    // @ts-expect-error Agent references belong to user messages, not assistant messages.
    { id: "prt_invalid_owner", type: "agent", name: "explore", source: { value: "@explore", start: 0, end: 8 } },
  ])

  // @ts-expect-error Retry status events require message and next.
  event("session.status", { sessionID: "ses_timeline_stability", status: { type: "retry", attempt: 1 } })
}
