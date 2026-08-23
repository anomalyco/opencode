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
        error: { type: "APIError", message: 1 } as never,
      }),
    ).toThrow()
    expect(() =>
      validateTimelineEvent({
        id: "evt_invalid_status",
        created: 1,
        type: "session.status",
        data: { sessionID: "ses_timeline_stability", status: { type: "retry", attempt: 1 } },
      }),
    ).toThrow()
    expect(() => validateTimelineMessages([{ ...userMessage(), id: "invalid" } as never])).toThrow()
    expect(() => validateTimelineMessages([{ ...userMessage(), time: { created: "invalid" } } as never])).toThrow()
    expect(() =>
      validateTimelineMessages([
        userMessage(),
        {
          ...assistantMessage(),
          content: [{ type: "tool", id: "call_invalid", name: "shell", state: { status: "completed" } }],
        } as never,
      ]),
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
    expect(first.id).toMatch(/^evt_timeline_\d{4}$/)
    expect(Number(second.id.slice(-4))).toBe(Number(first.id.slice(-4)) + 1)
  })
})

if (false) {
  const userSeed = { id: "prt_type_user", type: "text", text: "typed" } satisfies PartSeed<"user">
  userMessage([userSeed])

  // @ts-expect-error Tool completion fields are not valid while streaming.
  toolPart("prt_invalid_streaming", "shell", "streaming", {}, { output: "impossible" })
  toolPart("prt_valid_running", "shell", "running", {}, { output: "progressive output" })
  // @ts-expect-error Tool error fields are not valid after completion.
  toolPart("prt_invalid_completed", "shell", "completed", {}, { error: "impossible" })

  assistantMessage([
    // @ts-expect-error Agent references belong to user messages, not assistant messages.
    { id: "prt_invalid_owner", type: "agent", name: "explore", source: { value: "@explore", start: 0, end: 8 } },
  ])

  // @ts-expect-error Retry status events require message and next.
  event("session.status", { sessionID: "ses_timeline_stability", status: { type: "retry", attempt: 1 } })
}
