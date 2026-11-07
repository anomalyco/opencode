import { describe, expect, test } from "bun:test"
import {
  COPY_FEEDBACK_MS,
  COPY_TIMEOUT_MS,
  createCopyState,
  transitionCopy,
  viewCopy,
  type CopyEvent,
  type CopyState,
} from "./copy-machine"

const FIRST = "https://pair.example/auth/connect/first"

const SECOND = "https://pair.example/auth/connect/second"

const replay = (events: readonly CopyEvent[], state: CopyState = createCopyState()) =>
  events.reduce((current, event) => transitionCopy(current, event).state, state)

describe("transitionCopy", () => {
  test("a code that replaces the link drops Copied and the copy error for the old link", () => {
    const copied = replay([
      { type: "copy.requested", url: FIRST },
      { type: "copy.succeeded", attempt: 1 },
    ])

    expect(viewCopy(copied, FIRST)).toMatchObject({ icon: "check", label: "common.copied" })
    expect(viewCopy(copied, SECOND)).toEqual({ icon: "copy", label: "copyLink", disabled: false, error: false })

    const failed = replay([
      { type: "copy.requested", url: FIRST },
      { type: "copy.failed", attempt: 1 },
    ])

    expect(viewCopy(failed, FIRST).error).toBe(true)
    expect(viewCopy(failed, SECOND).error).toBe(false)
    expect(viewCopy(failed, undefined).error).toBe(false)
  })

  test("a copy that finishes after Refresh code never shows Copied", () => {
    const copying = replay([{ type: "copy.requested", url: FIRST }])
    const reset = transitionCopy(copying, { type: "reset" })

    expect(reset.effects).toEqual([{ type: "cancel-timer" }])
    expect(transitionCopy(reset.state, { type: "copy.succeeded", attempt: 1 }).state).toBe(reset.state)
    expect(viewCopy(reset.state, FIRST).icon).toBe("copy")
  })

  test("copying the new link while the old copy runs starts a new attempt", () => {
    const copying = replay([{ type: "copy.requested", url: FIRST }])

    expect(viewCopy(copying, FIRST).disabled).toBe(true)
    expect(viewCopy(copying, SECOND).disabled).toBe(false)
    expect(transitionCopy(copying, { type: "copy.requested", url: FIRST }).state).toBe(copying)

    const next = transitionCopy(copying, { type: "copy.requested", url: SECOND })

    expect(next.effects).toEqual([
      { type: "cancel-timer" },
      { type: "write", attempt: 2, url: SECOND, timeoutMs: COPY_TIMEOUT_MS },
    ])
    expect(transitionCopy(next.state, { type: "copy.succeeded", attempt: 1 }).state).toBe(next.state)
  })

  test("copying again during Copied restarts the feedback and ignores the first timer", () => {
    const copied = replay([
      { type: "copy.requested", url: FIRST },
      { type: "copy.succeeded", attempt: 1 },
    ])

    const again = transitionCopy(copied, { type: "copy.requested", url: FIRST }).state

    expect(transitionCopy(again, { type: "feedback.ended", attempt: 1 }).state).toBe(again)

    const done = transitionCopy(again, { type: "copy.succeeded", attempt: 2 })

    expect(done.effects).toEqual([
      { type: "cancel-timer" },
      { type: "schedule-feedback", attempt: 2, delayMs: COPY_FEEDBACK_MS },
    ])
    expect(transitionCopy(done.state, { type: "feedback.ended", attempt: 2 }).state).toEqual({
      status: "idle",
      attempt: 2,
    })
  })

  test("a failed or timed-out write shows the error and can be tried again", () => {
    const failed = replay([
      { type: "copy.requested", url: FIRST },
      { type: "copy.failed", attempt: 1 },
    ])

    expect(viewCopy(failed, FIRST)).toEqual({ icon: "copy", label: "copyLink", disabled: false, error: true })
    expect(transitionCopy(failed, { type: "copy.requested", url: FIRST }).state).toEqual({
      status: "copying",
      attempt: 2,
      url: FIRST,
    })
  })

  test("disposing cancels the timer and ignores later answers", () => {
    const copying = replay([{ type: "copy.requested", url: FIRST }])
    const disposed = transitionCopy(copying, { type: "disposed" })

    expect(disposed.effects).toEqual([{ type: "cancel-timer" }])
    expect(transitionCopy(disposed.state, { type: "copy.succeeded", attempt: 1 }).state).toBe(disposed.state)
    expect(transitionCopy(disposed.state, { type: "copy.requested", url: FIRST }).state).toBe(disposed.state)
  })
})
