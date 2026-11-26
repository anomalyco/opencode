import { describe, expect, test } from "bun:test"
import type { FileDiffInfo } from "@opencode/client/promise"
import {
  INITIAL_REVIEW_DETAIL_STATE,
  reviewDetailView,
  transitionReviewDetail,
  type ReviewDetailEffect,
  type ReviewDetailEvent,
  type ReviewDetailState,
  type ReviewDetailTarget,
} from "./detail-machine"

const turnA: ReviewDetailTarget = {
  kind: "turn",
  serverID: "local",
  sessionID: "ses_a",
  file: "src/big.ts",
  additions: 900,
  deletions: 10,
  version: 1,
}

const turnB: ReviewDetailTarget = { ...turnA, sessionID: "ses_b" }

const nested: ReviewDetailTarget = {
  kind: "vcs",
  serverID: "local",
  mode: "git",
  branch: "feature",
  defaultBranch: "dev",
  root: "C:/repo",
  scoped: "C:/repo/src",
  file: "src/big.ts",
  additions: 900,
  deletions: 10,
  version: 1,
}

const patch = (target: ReviewDetailTarget): FileDiffInfo => ({
  file: target.file,
  patch: "@@ -1 +1 @@\n-a\n+b",
  additions: target.additions,
  deletions: target.deletions,
  status: "modified",
})

const needed = (target: ReviewDetailTarget, connected = true, cached?: FileDiffInfo): ReviewDetailEvent => ({
  type: "context.changed",
  context: { kind: "needed", target, connected, cached },
})

const failed = (attempt: number): ReviewDetailEvent => ({ type: "fetch.failed", attempt, message: "Internal error" })

// Replays events through the pure machine and collects every effect it asked for, in order.
function play(state: ReviewDetailState, ...events: ReviewDetailEvent[]) {
  return events.reduce<{ state: ReviewDetailState; effects: readonly ReviewDetailEffect[] }>(
    (result, event) => {
      const next = transitionReviewDetail(result.state, event)

      return { state: next.state, effects: [...result.effects, ...next.effects] }
    },
    { state, effects: [] },
  )
}

describe("transitionReviewDetail", () => {
  // A retry used to read the routed session when it ran, so a switch during its backoff cached session B's patch
  // under session A for good.
  test("a session switch during a retry's backoff withdraws it, and its late answer never reaches the next session", () => {
    const backoff = play(INITIAL_REVIEW_DETAIL_STATE, needed(turnA), failed(1))

    expect(backoff.effects).toEqual([
      { type: "fetch", target: turnA, stage: "bounded", attempt: 1, delayMs: 0 },
      { type: "fetch", target: turnA, stage: "bounded", attempt: 2, delayMs: 1000 },
    ])

    const switched = transitionReviewDetail(backoff.state, needed(turnB))

    expect(switched.effects).toEqual([
      { type: "abort", attempt: 2 },
      { type: "fetch", target: turnB, stage: "bounded", attempt: 3, delayMs: 0 },
    ])

    const late = transitionReviewDetail(switched.state, { type: "fetch.succeeded", attempt: 2, diff: patch(turnA) })

    expect(late.state).toBe(switched.state)
    expect(reviewDetailView(late.state, turnB)).toEqual({ status: "loading" })
  })

  // A failed load used to leave the preview blank, with no reason and no way to load again.
  test("a scoped failure falls back at once, bounded failures retry twice, then the preview shows the failure", () => {
    const result = play(INITIAL_REVIEW_DETAIL_STATE, needed(nested), failed(1), failed(2), failed(3), failed(4))

    expect(result.effects).toEqual([
      { type: "fetch", target: nested, stage: "scoped", attempt: 1, delayMs: 0 },
      { type: "fetch", target: nested, stage: "bounded", attempt: 2, delayMs: 0 },
      { type: "fetch", target: nested, stage: "bounded", attempt: 3, delayMs: 1000 },
      { type: "fetch", target: nested, stage: "bounded", attempt: 4, delayMs: 2000 },
    ])
    expect(reviewDetailView(result.state, nested)).toEqual({
      status: "error",
      failure: { type: "rejected", message: "Internal error" },
    })

    const retried = play(result.state, { type: "retry" }, { type: "fetch.succeeded", attempt: 5, diff: patch(nested) })

    expect(retried.effects).toEqual([{ type: "fetch", target: nested, stage: "scoped", attempt: 5, delayMs: 0 }])
    expect(reviewDetailView(retried.state, nested)).toEqual({ status: "ready", diff: patch(nested) })
  })

  test("a scoped answer without the patch asks the bounded request; a bounded answer without it shows the listing", () => {
    const result = play(
      INITIAL_REVIEW_DETAIL_STATE,
      needed(nested),
      { type: "fetch.succeeded", attempt: 1, diff: undefined },
      { type: "fetch.succeeded", attempt: 2, diff: undefined },
    )

    expect(result.effects.at(-1)).toEqual({ type: "fetch", target: nested, stage: "bounded", attempt: 2, delayMs: 0 })
    expect(reviewDetailView(result.state, nested)).toEqual({ status: "ready", diff: undefined })
  })

  // A stalled server used to keep the preview blank for minutes.
  test("a request that takes too long is withdrawn and shows the failure without retrying", () => {
    const timed = play(INITIAL_REVIEW_DETAIL_STATE, needed(turnA), { type: "fetch.timed-out", attempt: 1 })

    expect(timed.effects.at(-1)).toEqual({ type: "abort", attempt: 1 })
    expect(reviewDetailView(timed.state, turnA)).toEqual({ status: "error", failure: { type: "timeout" } })
  })

  test("an unreachable server loads nothing until it reconnects", () => {
    const offline = play(INITIAL_REVIEW_DETAIL_STATE, needed(turnA, false))

    expect(offline.effects).toEqual([])
    expect(reviewDetailView(offline.state, turnA)).toEqual({ status: "offline" })
    expect(transitionReviewDetail(offline.state, needed(turnA)).effects).toEqual([
      { type: "fetch", target: turnA, stage: "bounded", attempt: 1, delayMs: 0 },
    ])

    // A failure the server cannot be asked about again shows as offline, and loads again on reconnect.
    const error = play(INITIAL_REVIEW_DETAIL_STATE, needed(turnA), { type: "fetch.timed-out", attempt: 1 })
    const dropped = transitionReviewDetail(error.state, needed(turnA, false))

    expect(reviewDetailView(dropped.state, turnA)).toEqual({ status: "offline" })
    expect(transitionReviewDetail(dropped.state, needed(turnA)).effects).toEqual([
      { type: "fetch", target: turnA, stage: "bounded", attempt: 2, delayMs: 0 },
    ])
  })

  test("a patch loaded before shows at once, and a loaded patch survives a disconnect", () => {
    const cached = play(INITIAL_REVIEW_DETAIL_STATE, needed(turnA, true, patch(turnA)))

    expect(cached.effects).toEqual([])
    expect(reviewDetailView(cached.state, turnA)).toEqual({ status: "ready", diff: patch(turnA) })
    expect(transitionReviewDetail(cached.state, needed(turnA, false)).state).toBe(cached.state)
  })

  test("leaving the file or closing the panel withdraws the request and drops its answer", () => {
    const loading = play(INITIAL_REVIEW_DETAIL_STATE, needed(turnA))
    const left = transitionReviewDetail(loading.state, { type: "context.changed", context: { kind: "none" } })

    expect(left.effects).toEqual([{ type: "abort", attempt: 1 }])

    const disposed = transitionReviewDetail(loading.state, { type: "disposed" })

    expect(disposed.effects).toEqual([{ type: "abort", attempt: 1 }])
    expect(
      transitionReviewDetail(disposed.state, { type: "fetch.succeeded", attempt: 1, diff: patch(turnA) }).state,
    ).toBe(disposed.state)
  })
})
