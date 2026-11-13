import { describe, expect, test } from "bun:test"
import {
  INITIAL_PERMISSION_REPLY_STATE,
  isPermissionReplied,
  isPermissionResponding,
  PERMISSION_REPLY_TIMEOUT_MS,
  transitionPermissionReply,
  type PermissionReplyEvent,
  type PermissionReplyState,
  type PermissionReplyTransition,
} from "./permission-machine"

const decide = (decision: "once" | "always" | "reject" = "once"): PermissionReplyEvent => ({
  type: "decide",
  sessionID: "ses_1",
  decision,
})

const responding = (attempt: number): PermissionReplyState => ({
  status: "responding",
  attempt,
  sessionID: "ses_1",
  decision: "once",
})

function replay(events: PermissionReplyEvent[], from = INITIAL_PERMISSION_REPLY_STATE) {
  return events.reduce<PermissionReplyTransition[]>((steps, event) => {
    steps.push(transitionPermissionReply(steps.at(-1)?.state ?? from, event))

    return steps
  }, [])
}

describe("transitionPermissionReply", () => {
  test("a reply that lands before permission.replied keeps the dock answered and ignores another click", () => {
    const steps = replay([decide("once"), { type: "reply.succeeded", attempt: 1 }])
    const replied = steps[1].state

    expect(steps[0]).toEqual({
      state: responding(1),
      effects: [
        { type: "reply", attempt: 1, sessionID: "ses_1", decision: "once", timeoutMs: PERMISSION_REPLY_TIMEOUT_MS },
      ],
    })
    expect(steps[1].effects).toEqual([{ type: "abort" }])
    expect(isPermissionResponding(replied)).toBe(true)
    expect(isPermissionReplied(replied)).toBe(true)

    const again = transitionPermissionReply(replied, decide("once"))
    expect(again.state).toBe(replied)
    expect(again.effects).toEqual([])
  })

  test("a second click while the reply is in flight sends nothing", () => {
    const state = responding(1)
    const result = transitionPermissionReply(state, decide("always"))

    expect(result.state).toBe(state)
    expect(result.effects).toEqual([])
  })

  test("a failed reply re-enables the dock with a toast, and the retry is a new attempt", () => {
    const steps = replay([decide("always"), { type: "reply.failed", attempt: 1, error: "boom" }, decide("once")])

    expect(steps[1]).toEqual({
      state: { status: "idle", attempt: 1 },
      effects: [{ type: "abort" }, { type: "toast-failed", error: "boom" }],
    })
    expect(isPermissionResponding(steps[1].state)).toBe(false)
    expect(steps[2].state).toEqual({ status: "responding", attempt: 2, sessionID: "ses_1", decision: "once" })
  })

  test("a hung reply times out, and the aborted request's failure is ignored", () => {
    const steps = replay([
      decide("reject"),
      { type: "reply.timed-out", attempt: 1 },
      { type: "reply.failed", attempt: 1, error: "aborted" },
    ])

    expect(steps[1]).toEqual({
      state: { status: "idle", attempt: 1 },
      effects: [{ type: "abort" }, { type: "toast-failed", error: undefined }],
    })
    expect(steps[2].state).toBe(steps[1].state)
    expect(steps[2].effects).toEqual([])
  })

  test("results of an earlier attempt cannot move the current one", () => {
    const state = responding(2)

    for (const event of [
      { type: "reply.succeeded", attempt: 1 },
      { type: "reply.failed", attempt: 1, error: "aborted" },
      { type: "reply.timed-out", attempt: 1 },
    ] satisfies PermissionReplyEvent[]) {
      const result = transitionPermissionReply(state, event)

      expect(result.state).toBe(state)
      expect(result.effects).toEqual([])
    }
  })

  test("permission.replied settles an in-flight reply and is a no-op otherwise", () => {
    expect(transitionPermissionReply(responding(1), { type: "resolved" })).toEqual({
      state: { status: "replied" },
      effects: [{ type: "abort" }],
    })

    for (const state of [INITIAL_PERMISSION_REPLY_STATE, { status: "replied" } satisfies PermissionReplyState]) {
      const result = transitionPermissionReply(state, { type: "resolved" })

      expect(result.state).toBe(state)
      expect(result.effects).toEqual([])
    }
  })

  test("disposal aborts an in-flight reply and is a no-op otherwise", () => {
    expect(transitionPermissionReply(responding(3), { type: "disposed" })).toEqual({
      state: { status: "idle", attempt: 3 },
      effects: [{ type: "abort" }],
    })

    for (const state of [INITIAL_PERMISSION_REPLY_STATE, { status: "replied" } satisfies PermissionReplyState]) {
      const result = transitionPermissionReply(state, { type: "disposed" })

      expect(result.state).toBe(state)
      expect(result.effects).toEqual([])
    }
  })
})
