import { describe, expect, test } from "bun:test"
import type { FileDiffInfo } from "@opencode/client/promise"
import {
  INITIAL_REVIEW_DIFF_STATE,
  reviewDiffReady,
  reviewDiffView,
  transitionReviewDiff,
  type ReviewDiffContext,
  type ReviewDiffEffect,
  type ReviewDiffEvent,
  type ReviewDiffState,
  type ReviewDiffTarget,
} from "./machine"

const git: ReviewDiffTarget = {
  kind: "vcs",
  serverID: "local",
  directory: "C:/repo",
  mode: "git",
  branch: "feature",
  defaultBranch: "dev",
}

const branch: ReviewDiffTarget = { ...git, mode: "branch" }

const turn: ReviewDiffTarget = { kind: "turn", serverID: "local", sessionID: "ses_1" }

const alpha: FileDiffInfo[] = [{ file: "src/alpha.ts", patch: "", additions: 1, deletions: 0, status: "modified" }]

const beta: FileDiffInfo[] = [{ file: "src/beta.ts", patch: "", additions: 2, deletions: 1, status: "modified" }]

function ready(target: ReviewDiffTarget, input: { connected?: boolean; demanded?: boolean } = {}): ReviewDiffEvent {
  const context: ReviewDiffContext = {
    kind: "ready",
    target,
    connected: input.connected ?? true,
    demanded: input.demanded ?? true,
  }

  return { type: "context.changed", context }
}

// Replays events through the pure machine and collects every effect it asked for, in order.
function play(state: ReviewDiffState, ...events: ReviewDiffEvent[]) {
  return events.reduce<{ state: ReviewDiffState; effects: readonly ReviewDiffEffect[] }>(
    (result, event) => {
      const next = transitionReviewDiff(result.state, event)

      return { state: next.state, effects: [...result.effects, ...next.effects] }
    },
    { state, effects: [] },
  )
}

// The review panel shows Git changes that loaded as attempt 1.
function loaded() {
  return play(INITIAL_REVIEW_DIFF_STATE, ready(git), {
    type: "fetch.succeeded",
    attempt: 1,
    rows: { rows: alpha, version: 10 },
  }).state
}

describe("a request that fails", () => {
  test("shows the failure with a retry instead of a clean working tree", () => {
    const failed = play(INITIAL_REVIEW_DIFF_STATE, ready(git), {
      type: "fetch.failed",
      attempt: 1,
      message: "git failed",
    })

    expect(failed.effects).toEqual([{ type: "fetch", target: git, attempt: 1 }])
    expect(reviewDiffView(failed.state)).toEqual({
      status: "error",
      failure: { type: "rejected", message: "git failed" },
    })
    expect(reviewDiffReady(failed.state)).toBe(false)

    const retried = play(
      failed.state,
      { type: "retry" },
      {
        type: "fetch.succeeded",
        attempt: 2,
        rows: { rows: alpha, version: 20 },
      },
    )

    expect(retried.effects).toEqual([{ type: "fetch", target: git, attempt: 2 }])
    expect(reviewDiffView(retried.state)).toEqual({ status: "ready", rows: alpha, version: 20 })
    expect(reviewDiffReady(retried.state)).toBe(true)
  })

  test("times out instead of loading forever, and a timed-out refresh keeps the diffs shown", () => {
    const timedOut = play(INITIAL_REVIEW_DIFF_STATE, ready(git), { type: "fetch.timed-out", attempt: 1 }).state

    expect(reviewDiffView(timedOut)).toEqual({ status: "error", failure: { type: "timeout" } })

    const refreshed = play(loaded(), { type: "refresh", source: "vcs" }, { type: "fetch.timed-out", attempt: 2 })

    expect(refreshed.effects).toEqual([{ type: "fetch", target: git, attempt: 2 }])
    expect(reviewDiffView(refreshed.state)).toEqual({ status: "ready", rows: alpha, version: 10 })
  })

  test("a failed refresh keeps the diffs shown", () => {
    const state = play(
      loaded(),
      { type: "window.focused" },
      { type: "fetch.failed", attempt: 2, message: "boom" },
    ).state

    expect(reviewDiffView(state)).toEqual({ status: "ready", rows: alpha, version: 10 })
  })

  test("a retry outside a failure does nothing", () => {
    const state = loaded()

    expect(transitionReviewDiff(state, { type: "retry" }).state).toBe(state)
  })
})

describe("a disconnected server", () => {
  test("shows offline instead of loading forever, and loads once it reconnects", () => {
    const unresolved = play(INITIAL_REVIEW_DIFF_STATE, { type: "context.changed", context: { kind: "offline" } })

    expect(reviewDiffView(unresolved.state)).toEqual({ status: "offline" })
    expect(unresolved.effects).toEqual([])

    const offline = play(unresolved.state, ready(git, { connected: false }))

    expect(reviewDiffView(offline.state)).toEqual({ status: "offline" })
    expect(offline.effects).toEqual([])

    const reconnected = play(offline.state, ready(git))

    expect(reviewDiffView(reconnected.state)).toEqual({ status: "loading" })
    expect(reconnected.effects).toEqual([{ type: "fetch", target: git, attempt: 1 }])
  })

  test("a disconnect ends the request and drops its late answer", () => {
    const state = play(INITIAL_REVIEW_DIFF_STATE, ready(git), ready(git, { connected: false }), {
      type: "fetch.succeeded",
      attempt: 1,
      rows: { rows: alpha, version: 10 },
    })

    expect(state.effects).toEqual([{ type: "fetch", target: git, attempt: 1 }, { type: "abort" }])
    expect(reviewDiffView(state.state)).toEqual({ status: "offline" })
  })

  test("keeps loaded diffs while disconnected and refreshes them on reconnect", () => {
    const disconnected = play(loaded(), ready(git, { connected: false }))

    expect(reviewDiffView(disconnected.state)).toEqual({ status: "ready", rows: alpha, version: 10 })
    expect(transitionReviewDiff(disconnected.state, { type: "side.opened" }).state).toBe(disconnected.state)

    const reconnected = play(disconnected.state, ready(git))

    expect(reconnected.effects).toEqual([{ type: "fetch", target: git, attempt: 2 }])
    expect(reviewDiffView(reconnected.state)).toEqual({ status: "ready", rows: alpha, version: 10 })
  })
})

describe("the side region opening", () => {
  test("waits for the session store before it requests the stored mode", () => {
    const waiting = play(INITIAL_REVIEW_DIFF_STATE, { type: "context.changed", context: { kind: "waiting" } }).state
    const opened = transitionReviewDiff(waiting, { type: "side.opened" })

    expect(opened.state).toBe(waiting)
    expect(opened.effects).toEqual([])

    const idle = play(waiting, ready(branch, { demanded: false }), { type: "side.opened" })

    expect(idle.effects).toEqual([{ type: "fetch", target: branch, attempt: 1 }])
  })

  test("does not request again while a request runs", () => {
    const loading = play(INITIAL_REVIEW_DIFF_STATE, ready(git)).state

    expect(transitionReviewDiff(loading, { type: "side.opened" }).state).toBe(loading)
  })
})

describe("another target", () => {
  test("aborts the running request and drops its answers", () => {
    const switched = play(
      INITIAL_REVIEW_DIFF_STATE,
      ready(git),
      ready(branch),
      { type: "fetch.succeeded", attempt: 1, rows: { rows: alpha, version: 10 } },
      { type: "fetch.failed", attempt: 1, message: "aborted" },
    )

    expect(switched.effects).toEqual([
      { type: "fetch", target: git, attempt: 1 },
      { type: "abort" },
      { type: "fetch", target: branch, attempt: 2 },
    ])
    expect(reviewDiffView(switched.state)).toEqual({ status: "loading" })

    const settled = play(switched.state, { type: "fetch.succeeded", attempt: 2, rows: { rows: beta, version: 20 } })

    expect(reviewDiffView(settled.state)).toEqual({ status: "ready", rows: beta, version: 20 })
  })

  test("shows what an earlier request loaded for it while it loads again", () => {
    const state = play(loaded(), {
      type: "context.changed",
      context: { kind: "ready", target: branch, connected: true, demanded: true, cached: { rows: beta, version: 5 } },
    })

    expect(state.effects).toEqual([{ type: "fetch", target: branch, attempt: 2 }])
    expect(reviewDiffView(state.state)).toEqual({ status: "ready", rows: beta, version: 5 })
  })

  test("never carries the previous target's failure", () => {
    const failed = play(INITIAL_REVIEW_DIFF_STATE, ready(git), { type: "fetch.failed", attempt: 1, message: "boom" })
    const switched = play(failed.state, ready(turn))

    expect(reviewDiffView(switched.state)).toEqual({ status: "loading" })
  })
})

describe("background refreshes", () => {
  test("follow the source that changed while something shows the changes", () => {
    const state = loaded()

    expect(play(state, { type: "refresh", source: "vcs" }).effects).toEqual([
      { type: "fetch", target: git, attempt: 2 },
    ])
    expect(transitionReviewDiff(state, { type: "refresh", source: "turn" }).state).toBe(state)

    const hidden = play(state, ready(git, { demanded: false })).state

    expect(transitionReviewDiff(hidden, { type: "refresh", source: "vcs" }).state).toBe(hidden)
    expect(transitionReviewDiff(hidden, { type: "window.focused" }).state).toBe(hidden)
    expect(play(hidden, ready(git)).effects).toEqual([{ type: "fetch", target: git, attempt: 2 }])
  })

  test("a focused window refreshes Git changes but not a finished turn", () => {
    const changes = play(INITIAL_REVIEW_DIFF_STATE, ready(turn), {
      type: "fetch.succeeded",
      attempt: 1,
      rows: { rows: alpha, version: 10 },
    }).state

    expect(transitionReviewDiff(changes, { type: "window.focused" }).state).toBe(changes)
    expect(play(changes, { type: "refresh", source: "turn" }).effects).toEqual([
      { type: "fetch", target: turn, attempt: 2 },
    ])
  })

  test("files that keep changing during the first load cannot hold it off: it keeps its request, then loads once more", () => {
    const changing = play(
      INITIAL_REVIEW_DIFF_STATE,
      ready(git),
      ...Array.from({ length: 5 }, (): ReviewDiffEvent => ({ type: "refresh", source: "vcs" })),
    )

    expect(changing.effects).toEqual([{ type: "fetch", target: git, attempt: 1 }])

    const settled = play(changing.state, { type: "fetch.succeeded", attempt: 1, rows: { rows: alpha, version: 10 } })

    expect(settled.effects).toEqual([{ type: "fetch", target: git, attempt: 2 }])
    expect(reviewDiffView(settled.state)).toEqual({ status: "ready", rows: alpha, version: 10 })

    const final = play(settled.state, { type: "fetch.succeeded", attempt: 2, rows: { rows: beta, version: 20 } })

    expect(final.effects).toEqual([])
    expect(reviewDiffView(final.state)).toEqual({ status: "ready", rows: beta, version: 20 })
  })

  test("the first load still times out while files keep changing", () => {
    const state = play(
      INITIAL_REVIEW_DIFF_STATE,
      ready(git),
      { type: "refresh", source: "vcs" },
      { type: "refresh", source: "vcs" },
      { type: "fetch.timed-out", attempt: 1 },
    )

    expect(state.effects).toEqual([{ type: "fetch", target: git, attempt: 1 }])
    expect(reviewDiffView(state.state)).toEqual({ status: "error", failure: { type: "timeout" } })
  })

  test("a change while shown diffs refresh restarts the refresh", () => {
    const state = play(loaded(), { type: "refresh", source: "vcs" }, { type: "refresh", source: "vcs" })

    expect(state.effects).toEqual([
      { type: "fetch", target: git, attempt: 2 },
      { type: "abort" },
      { type: "fetch", target: git, attempt: 3 },
    ])
  })
})

test("disposal aborts the running request and ignores every later event", () => {
  const disposed = play(INITIAL_REVIEW_DIFF_STATE, ready(git), { type: "disposed" })

  expect(disposed.effects).toEqual([{ type: "fetch", target: git, attempt: 1 }, { type: "abort" }])

  const late = play(
    disposed.state,
    { type: "fetch.succeeded", attempt: 1, rows: { rows: alpha, version: 10 } },
    ready(branch),
    { type: "retry" },
  )

  expect(late.state).toBe(disposed.state)
  expect(late.effects).toEqual([])
})

test("a project without a repository is ready without a request", () => {
  const state = play(loaded(), { type: "context.changed", context: { kind: "no-vcs" } })

  expect(state.effects).toEqual([])
  expect(reviewDiffView(state.state)).toEqual({ status: "no-vcs" })
  expect(reviewDiffReady(state.state)).toBe(true)
})
