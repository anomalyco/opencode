import { describe, expect, test } from "bun:test"
import { RemoteEvent } from "@/remote/event"

describe("remote events", () => {
  test("allows only session-scoped UI refresh events", () => {
    expect(
      RemoteEvent.shouldForward(
        { type: "message.part.updated", data: { sessionID: "ses_target", part: { output: "sensitive" } } },
        "ses_target",
      ),
    ).toBe(true)
    expect(
      RemoteEvent.shouldForward(
        { type: "message.part.updated", data: { sessionID: "ses_other" } },
        "ses_target",
      ),
    ).toBe(false)
    expect(
      RemoteEvent.shouldForward(
        { type: "session.diff", data: { sessionID: "ses_target", diff: "private patch" } },
        "ses_target",
      ),
    ).toBe(false)
    expect(
      RemoteEvent.shouldForward(
        { type: "future.internal.event", data: { sessionID: "ses_target", secret: "private" } },
        "ses_target",
      ),
    ).toBe(false)
  })

  test("recognizes nested session ownership for known event shapes", () => {
    expect(
      RemoteEvent.shouldForward(
        { type: "message.updated", data: { info: { sessionID: "ses_target" } } },
        "ses_target",
      ),
    ).toBe(true)
  })

  test("strips event payloads from the mobile stream", () => {
    const input = {
      id: "evt_1",
      type: "permission.asked",
      data: { sessionID: "ses_target", metadata: { command: "private command" } },
    }
    expect(RemoteEvent.signal(input)).toEqual({ id: "evt_1", type: "permission.asked", properties: {} })
  })
})
