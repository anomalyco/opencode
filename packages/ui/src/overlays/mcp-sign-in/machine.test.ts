import { describe, expect, test } from "bun:test"
import {
  MCP_SIGN_IN_POLL_MS,
  MCP_SIGN_IN_SYNC_TIMEOUT_MS,
  selectMcpSignInView,
  startMcpSignIn,
  transitionMcpSignIn,
  type McpSignInEffect,
  type McpSignInEvent,
  type McpSignInState,
} from "./machine"

const AUTH_URL = "https://auth.example/authorize"

const REDIRECT = "http://127.0.0.1:19876/callback?code=abc"

function replay(events: McpSignInEvent[], state = startMcpSignIn({ url: AUTH_URL, lifetimeMs: 600_000 }).state) {
  return events.reduce<{ state: McpSignInState; effects: readonly McpSignInEffect[] }>(
    (step, event) => transitionMcpSignIn(step.state, event),
    { state, effects: [] },
  )
}

const polled = (pollAttempt: number, outcome: Extract<McpSignInEvent, { type: "polled" }>["outcome"]) =>
  ({ type: "polled", pollAttempt, outcome }) as const

describe("MCP sign-in machine", () => {
  test("starts the deadline and polls at once", () => {
    expect(startMcpSignIn({ url: AUTH_URL, lifetimeMs: 600_000 }).effects).toEqual([
      { type: "deadline.start", delayMs: 600_000 },
      { type: "poll", pollAttempt: 1, delayMs: 0 },
    ])
  })

  test("a failed sync after sign-in shows a retryable failure instead of a stuck spinner", () => {
    const completing = replay([polled(1, { status: "complete" })])

    expect(completing.state.status).toBe("completing")
    expect(completing.effects).toEqual([
      { type: "deadline.clear" },
      { type: "poll.abort" },
      { type: "sync", syncAttempt: 2, timeoutMs: MCP_SIGN_IN_SYNC_TIMEOUT_MS },
    ])

    const failed = transitionMcpSignIn(completing.state, { type: "sync.failed", syncAttempt: 2, message: "502" })

    expect(failed.effects).toEqual([{ type: "sync.clear" }])
    expect(selectMcpSignInView(failed.state)).toMatchObject({
      status: "failed",
      failure: { type: "sync-failed", message: "502" },
      canRetry: true,
      showForm: false,
      showOpenBrowser: false,
    })

    // The sign-in succeeded on the server, so closing now must not cancel it.
    expect(transitionMcpSignIn(failed.state, { type: "disposed" }).effects).toEqual([])

    const retried = transitionMcpSignIn(failed.state, { type: "retry.requested" })

    expect(retried.effects).toEqual([{ type: "sync", syncAttempt: 3, timeoutMs: MCP_SIGN_IN_SYNC_TIMEOUT_MS }])
    expect(transitionMcpSignIn(retried.state, { type: "sync.succeeded", syncAttempt: 2 }).state).toBe(retried.state)

    const done = transitionMcpSignIn(retried.state, { type: "sync.succeeded", syncAttempt: 3 })

    expect(done.state).toEqual({ status: "done" })
    expect(done.effects).toEqual([{ type: "sync.clear" }, { type: "close" }])
  })

  test("a sync that hangs times out into a retryable failure; a stale timeout is ignored", () => {
    const completing = replay([polled(1, { status: "complete" })])

    expect(transitionMcpSignIn(completing.state, { type: "sync.timed-out", syncAttempt: 1 }).state).toBe(
      completing.state,
    )

    const timedOut = transitionMcpSignIn(completing.state, { type: "sync.timed-out", syncAttempt: 2 })

    expect(selectMcpSignInView(timedOut.state)).toMatchObject({ failure: { type: "sync-timed-out" }, canRetry: true })
    // A sync that finishes after its timeout does not undo the failure the user sees.
    expect(transitionMcpSignIn(timedOut.state, { type: "sync.succeeded", syncAttempt: 2 }).state).toBe(timedOut.state)
    expect(transitionMcpSignIn(completing.state, { type: "disposed" }).effects).toEqual([{ type: "sync.clear" }])
  })

  test("Enter twice while a paste is submitting sends it once", () => {
    const submitting = replay([{ type: "paste.changed", value: ` ${REDIRECT} ` }, { type: "paste.submitted" }])

    expect(submitting.effects).toEqual([{ type: "submit", submitAttempt: 2, code: REDIRECT }])
    expect(selectMcpSignInView(submitting.state)).toMatchObject({ locked: true, submitting: true })

    const again = transitionMcpSignIn(submitting.state, { type: "paste.submitted" })

    expect(again.state).toBe(submitting.state)
    expect(again.effects).toEqual([])
    expect(transitionMcpSignIn(submitting.state, { type: "paste.changed", value: "x" }).state).toBe(submitting.state)
  })

  test("a poll that fails the attempt while a paste submits aborts it and ignores its late answer", () => {
    const failed = replay([
      { type: "paste.changed", value: REDIRECT },
      { type: "paste.submitted" },
      polled(1, { status: "failed", message: "denied" }),
    ])

    expect(failed.effects).toEqual([{ type: "deadline.clear" }, { type: "poll.abort" }, { type: "submit.abort" }])
    expect(selectMcpSignInView(failed.state)).toMatchObject({
      failure: { type: "auth-failed", message: "denied" },
      showForm: false,
      submitting: false,
      showOpenBrowser: true,
    })
    expect(transitionMcpSignIn(failed.state, { type: "submit.failed", submitAttempt: 2, message: "x" }).state).toBe(
      failed.state,
    )
    expect(transitionMcpSignIn(failed.state, { type: "submit.succeeded", submitAttempt: 2 }).state).toBe(failed.state)
  })

  test("a rejected paste shows its error and keeps polling", () => {
    const rejected = replay([
      { type: "paste.changed", value: REDIRECT },
      { type: "paste.submitted" },
      { type: "submit.failed", submitAttempt: 2, message: "state mismatch" },
    ])

    expect(selectMcpSignInView(rejected.state)).toMatchObject({
      status: "waiting",
      entryError: { type: "rejected", message: "state mismatch" },
      locked: false,
    })
    expect(transitionMcpSignIn(rejected.state, polled(1, { status: "pending" })).effects).toEqual([
      { type: "poll", pollAttempt: 3, delayMs: MCP_SIGN_IN_POLL_MS },
    ])
  })

  test("an accepted paste polls at once and closing then does not cancel the sign-in", () => {
    const accepted = replay([
      { type: "paste.changed", value: REDIRECT },
      { type: "paste.submitted" },
      { type: "submit.succeeded", submitAttempt: 2 },
    ])

    expect(accepted.effects).toEqual([{ type: "poll", pollAttempt: 3, delayMs: 0 }])
    expect(selectMcpSignInView(accepted.state)).toMatchObject({ status: "waiting", locked: true })
    expect(transitionMcpSignIn(accepted.state, { type: "paste.submitted" }).state).toBe(accepted.state)
    // The poll in flight before the paste is stale now.
    expect(transitionMcpSignIn(accepted.state, polled(1, { status: "pending" })).state).toBe(accepted.state)
    expect(transitionMcpSignIn(accepted.state, { type: "disposed" }).effects).toEqual([
      { type: "deadline.clear" },
      { type: "poll.abort" },
      { type: "refresh" },
    ])
    expect(transitionMcpSignIn(accepted.state, polled(3, { status: "complete" })).state.status).toBe("completing")
  })

  test("the deadline ends an attempt the server keeps reporting as pending", () => {
    const expired = replay([polled(1, { status: "pending" }), { type: "waiting.timed-out" }])

    expect(expired.effects).toEqual([{ type: "deadline.clear" }, { type: "poll.abort" }, { type: "cancel" }])
    expect(selectMcpSignInView(expired.state).failure).toEqual({ type: "auth-expired" })
  })

  test("an unreachable server keeps polling until the deadline, which then shows the request error", () => {
    const unreachable = replay([polled(1, { status: "unreachable", message: "502" })])

    expect(unreachable.effects).toEqual([{ type: "poll", pollAttempt: 2, delayMs: MCP_SIGN_IN_POLL_MS }])

    const expired = transitionMcpSignIn(unreachable.state, { type: "waiting.timed-out" })

    expect(selectMcpSignInView(expired.state).failure).toEqual({ type: "auth-failed", message: "502" })
    // A pending answer in between clears the request error.
    const recovered = transitionMcpSignIn(unreachable.state, polled(2, { status: "pending" }))

    expect(
      selectMcpSignInView(transitionMcpSignIn(recovered.state, { type: "waiting.timed-out" }).state).failure,
    ).toEqual({ type: "auth-expired" })
  })

  test("an empty paste asks for the URL and typing clears the error", () => {
    const empty = replay([{ type: "paste.changed", value: "  " }, { type: "paste.submitted" }])

    expect(empty.effects).toEqual([])
    expect(selectMcpSignInView(empty.state).entryError).toEqual({ type: "required" })
    expect(
      selectMcpSignInView(transitionMcpSignIn(empty.state, { type: "paste.changed", value: "h" }).state).entryError,
    ).toBeUndefined()
  })

  test("closing while waiting cancels the attempt; nothing applies after", () => {
    const disposed = replay([{ type: "disposed" }])

    expect(disposed.effects).toEqual([{ type: "deadline.clear" }, { type: "poll.abort" }, { type: "cancel" }])
    expect(transitionMcpSignIn(disposed.state, polled(1, { status: "complete" })).state).toBe(disposed.state)

    const submitting = replay([
      { type: "paste.changed", value: REDIRECT },
      { type: "paste.submitted" },
      { type: "disposed" },
    ])

    expect(submitting.effects).toEqual([
      { type: "deadline.clear" },
      { type: "poll.abort" },
      { type: "submit.abort" },
      { type: "cancel" },
    ])
  })

  test("the browser reopens while signing in but not once the sign-in is done", () => {
    expect(replay([{ type: "browser.open" }]).effects).toEqual([{ type: "open-external", url: AUTH_URL }])

    const completing = replay([polled(1, { status: "complete" })])

    expect(transitionMcpSignIn(completing.state, { type: "browser.open" }).effects).toEqual([])
  })
})
