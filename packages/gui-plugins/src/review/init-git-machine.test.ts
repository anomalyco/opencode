import { describe, expect, test } from "bun:test"
import {
  REVIEW_INIT_GIT_TIMEOUT_MS,
  createReviewInitGitState,
  isInitializingGit,
  transitionReviewInitGit,
  type ReviewInitGitEffect,
  type ReviewInitGitEvent,
  type ReviewInitGitState,
} from "./init-git-machine"

// Replays events through the pure machine and collects every effect it asked for, in order.
function play(state: ReviewInitGitState, ...events: ReviewInitGitEvent[]) {
  return events.reduce<{ state: ReviewInitGitState; effects: readonly ReviewInitGitEffect[] }>(
    (result, event) => {
      const next = transitionReviewInitGit(result.state, event)

      return { state: next.state, effects: [...result.effects, ...next.effects] }
    },
    { state, effects: [] },
  )
}

const requested = (sessionKey: string): ReviewInitGitEvent => ({ type: "init.requested", sessionKey, ready: true })

const syncing = () =>
  play(createReviewInitGitState(), requested("alpha"), { type: "init.succeeded", sessionKey: "alpha", attempt: 1 })

describe("after the repository is created", () => {
  test("the button stays busy while the caches refresh, then releases without an error", () => {
    const state = syncing()

    expect(state.effects).toEqual([
      { type: "vcs.init", sessionKey: "alpha", attempt: 1, timeoutMs: REVIEW_INIT_GIT_TIMEOUT_MS },
      { type: "attempt.abort", attempt: 1 },
      { type: "caches.sync", sessionKey: "alpha", attempt: 2, timeoutMs: REVIEW_INIT_GIT_TIMEOUT_MS },
    ])
    expect(isInitializingGit(state.state, "alpha")).toBe(true)

    // The driver settles the refresh whether or not a sync rejected.
    const settled = play(state.state, { type: "sync.settled", sessionKey: "alpha", attempt: 2 })

    expect(settled.effects).toEqual([{ type: "attempt.abort", attempt: 2 }])
    expect(isInitializingGit(settled.state, "alpha")).toBe(false)
  })

  test("a refresh that runs long releases the button without an error", () => {
    const timedOut = play(syncing().state, { type: "sync.timed-out", sessionKey: "alpha", attempt: 2 })

    expect(timedOut.effects).toEqual([{ type: "attempt.abort", attempt: 2 }])
    expect(isInitializingGit(timedOut.state, "alpha")).toBe(false)
  })
})

describe("initializing", () => {
  test("a hung request times out, releases the button and ignores its late answer", () => {
    const timedOut = play(createReviewInitGitState(), requested("alpha"), {
      type: "init.timed-out",
      sessionKey: "alpha",
      attempt: 1,
      routedSessionKey: "alpha",
    })

    expect(timedOut.effects.slice(1)).toEqual([
      { type: "attempt.abort", attempt: 1 },
      { type: "toast.failed", reason: "timeout" },
    ])
    expect(isInitializingGit(timedOut.state, "alpha")).toBe(false)

    const late = transitionReviewInitGit(timedOut.state, { type: "init.succeeded", sessionKey: "alpha", attempt: 1 })

    expect(late.state).toBe(timedOut.state)
    expect(late.effects).toEqual([])
  })

  test("a failure shows only while its session is routed", () => {
    const failed = (routedSessionKey: string) =>
      play(createReviewInitGitState(), requested("alpha"), {
        type: "init.failed",
        sessionKey: "alpha",
        attempt: 1,
        routedSessionKey,
        message: "not allowed",
      })

    expect(failed("alpha").effects.slice(1)).toEqual([
      { type: "attempt.abort", attempt: 1 },
      { type: "toast.failed", reason: "rejected", message: "not allowed" },
    ])

    const elsewhere = failed("beta")

    expect(elsewhere.effects.slice(1)).toEqual([{ type: "attempt.abort", attempt: 1 }])
    expect(isInitializingGit(elsewhere.state, "alpha")).toBe(false)
  })

  test("a timeout shows nothing while another session is routed", () => {
    const timedOut = play(createReviewInitGitState(), requested("alpha"), {
      type: "init.timed-out",
      sessionKey: "alpha",
      attempt: 1,
      routedSessionKey: "beta",
    })

    expect(timedOut.effects.slice(1)).toEqual([{ type: "attempt.abort", attempt: 1 }])
  })

  test("sessions initialize independently, and a second click on a busy one does nothing", () => {
    const both = play(createReviewInitGitState(), requested("alpha"), requested("beta"), requested("alpha"))

    expect(both.effects).toEqual([
      { type: "vcs.init", sessionKey: "alpha", attempt: 1, timeoutMs: REVIEW_INIT_GIT_TIMEOUT_MS },
      { type: "vcs.init", sessionKey: "beta", attempt: 2, timeoutMs: REVIEW_INIT_GIT_TIMEOUT_MS },
    ])

    const syncingAlpha = play(both.state, { type: "init.succeeded", sessionKey: "alpha", attempt: 1 }).state

    expect(transitionReviewInitGit(syncingAlpha, requested("alpha")).state).toBe(syncingAlpha)
    // Another session's attempt id never answers for this one.
    expect(transitionReviewInitGit(syncingAlpha, { type: "sync.settled", sessionKey: "alpha", attempt: 2 }).state).toBe(
      syncingAlpha,
    )
  })

  test("a session without a known location or server reports the failure and stays idle", () => {
    const state = createReviewInitGitState()
    const unavailable = transitionReviewInitGit(state, { type: "init.requested", sessionKey: "alpha", ready: false })

    expect(unavailable.state).toBe(state)
    expect(unavailable.effects).toEqual([{ type: "toast.failed", reason: "unavailable" }])
  })
})

describe("disposed", () => {
  test("aborts every running attempt and ignores late answers", () => {
    const running = play(syncing().state, requested("beta"))
    const disposed = transitionReviewInitGit(running.state, { type: "disposed" })

    expect(disposed.effects).toEqual([
      { type: "attempt.abort", attempt: 2 },
      { type: "attempt.abort", attempt: 3 },
    ])

    const late = play(
      disposed.state,
      { type: "sync.settled", sessionKey: "alpha", attempt: 2 },
      { type: "init.failed", sessionKey: "beta", attempt: 3, routedSessionKey: "beta" },
      requested("gamma"),
    )

    expect(late.state).toBe(disposed.state)
    expect(late.effects).toEqual([])
  })
})
