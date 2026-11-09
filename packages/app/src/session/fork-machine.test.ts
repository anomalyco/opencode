import { describe, expect, test } from "bun:test"
import type { SessionInfo } from "@opencode/client/promise"
import {
  createSessionForkState,
  FORK_TIMEOUT_MS,
  selectSessionForkView,
  transitionSessionFork,
  type SessionForkDraft,
  type SessionForkEvent,
  type SessionForkState,
  type SessionForkSurface,
  type SessionForkTransition,
} from "./fork-machine"

/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion -- the machine passes the forked session through untouched */
const forked = { id: "ses_fork", location: { directory: "C:/repo" } } as SessionInfo

const draft: SessionForkDraft = { prompt: [{ type: "text", content: "retry this", start: 0, end: 10 }], context: [] }

const request = (messageID = "msg_1"): SessionForkEvent => ({
  type: "fork.requested",
  sessionID: "ses_1",
  messageID,
  draft,
})

function replay(events: SessionForkEvent[], from: SessionForkState) {
  return events.reduce<SessionForkTransition[]>((steps, event) => {
    steps.push(transitionSessionFork(steps.at(-1)?.state ?? from, event))

    return steps
  }, [])
}

function forking(surface: SessionForkSurface) {
  return transitionSessionFork(createSessionForkState(surface), request()).state
}

describe("transitionSessionFork", () => {
  test("a second Enter or row click while a fork runs sends nothing", () => {
    const [first, second, other] = replay([request(), request(), request("msg_2")], createSessionForkState("dialog"))

    expect(first?.effects).toEqual([
      { type: "fork.start", attempt: 1, sessionID: "ses_1", messageID: "msg_1", timeoutMs: FORK_TIMEOUT_MS },
    ])
    expect(second?.state).toBe(first!.state)
    expect(second?.effects).toEqual([])
    expect(other?.state).toBe(first!.state)
    expect(other?.effects).toEqual([])
    expect(selectSessionForkView(first!.state)).toEqual({ disabled: true, pendingMessageID: "msg_1" })
  })

  test("dismissing the dialog mid-fork cancels it, and its late result neither navigates nor toasts", () => {
    const [closed, succeeded, failed] = replay(
      [
        { type: "disposed" },
        { type: "fork.succeeded", attempt: 1, session: forked },
        { type: "fork.failed", attempt: 1, message: "boom" },
      ],
      forking("dialog"),
    )

    expect(closed?.state).toEqual({ status: "closed", surface: "dialog", attempt: 1 })
    expect(closed?.effects).toEqual([{ type: "fork.cancel", attempt: 1 }])
    expect(succeeded?.state).toBe(closed!.state)
    expect(succeeded?.effects).toEqual([])
    expect(failed?.state).toBe(closed!.state)
    expect(failed?.effects).toEqual([])
  })

  test("the dialog opens its fork, closes once, and stays disabled through its exit animation", () => {
    const [opened, disposed] = replay(
      [{ type: "fork.succeeded", attempt: 1, session: forked }, { type: "disposed" }],
      forking("dialog"),
    )

    expect(opened?.effects).toEqual([
      { type: "fork.open", attempt: 1, session: forked, draft },
      { type: "dialog.close" },
    ])
    expect(selectSessionForkView(opened!.state)).toEqual({ disabled: true, pendingMessageID: undefined })
    expect(disposed?.state).toBe(opened!.state)
    expect(disposed?.effects).toEqual([])
  })

  test("the timeline opens its fork without a dialog and can fork again", () => {
    const [opened, again] = replay(
      [{ type: "fork.succeeded", attempt: 1, session: forked }, request("msg_2")],
      forking("inline"),
    )

    expect(opened?.state).toEqual({ status: "idle", surface: "inline", attempt: 1 })
    expect(opened?.effects).toEqual([{ type: "fork.open", attempt: 1, session: forked, draft }])
    expect(again?.effects).toEqual([
      { type: "fork.start", attempt: 2, sessionID: "ses_1", messageID: "msg_2", timeoutMs: FORK_TIMEOUT_MS },
    ])
  })

  test("a failed fork toasts and lets the user pick again", () => {
    const [failed, retried] = replay(
      [{ type: "fork.failed", attempt: 1, message: "500" }, request()],
      forking("dialog"),
    )

    expect(failed?.state).toEqual({ status: "idle", surface: "dialog", attempt: 1 })
    expect(failed?.effects).toEqual([{ type: "fork.fail", attempt: 1, message: "500" }])
    expect(selectSessionForkView(failed!.state).disabled).toBe(false)
    expect(retried?.state).toMatchObject({ status: "forking", attempt: 2 })
  })

  test("a hung fork times out, and a result from the timed-out request is dropped", () => {
    const [timedOut, retried, late, current] = replay(
      [
        { type: "fork.timed-out", attempt: 1 },
        request(),
        { type: "fork.succeeded", attempt: 1, session: forked },
        { type: "fork.succeeded", attempt: 2, session: forked },
      ],
      forking("inline"),
    )

    expect(timedOut?.state).toEqual({ status: "idle", surface: "inline", attempt: 1 })
    expect(timedOut?.effects).toEqual([
      { type: "fork.cancel", attempt: 1 },
      { type: "fork.fail", attempt: 1 },
    ])
    expect(late?.state).toBe(retried!.state)
    expect(late?.effects).toEqual([])
    expect(current?.effects).toEqual([{ type: "fork.open", attempt: 2, session: forked, draft }])
  })

  test("another session closes the picker, cancelling its fork", () => {
    const idle = createSessionForkState("dialog")
    const fromIdle = transitionSessionFork(idle, { type: "session.changed" })
    const fromForking = transitionSessionFork(forking("dialog"), { type: "session.changed" })

    expect(fromIdle.state).toEqual({ status: "closed", surface: "dialog", attempt: 0 })
    expect(fromIdle.effects).toEqual([{ type: "dialog.close" }])
    expect(fromForking.effects).toEqual([{ type: "fork.cancel", attempt: 1 }, { type: "dialog.close" }])
  })

  test("another session cancels a timeline fork, and the fork's own navigation does not", () => {
    const cancelled = transitionSessionFork(forking("inline"), { type: "session.changed" })
    const opened = transitionSessionFork(forking("inline"), { type: "fork.succeeded", attempt: 1, session: forked })
    const navigated = transitionSessionFork(opened.state, { type: "session.changed" })

    expect(cancelled.state).toEqual({ status: "idle", surface: "inline", attempt: 1 })
    expect(cancelled.effects).toEqual([{ type: "fork.cancel", attempt: 1 }])
    expect(navigated.state).toBe(opened.state)
    expect(navigated.effects).toEqual([])
  })
})
