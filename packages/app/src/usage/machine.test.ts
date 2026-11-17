import { describe, expect, test } from "bun:test"
import type { UsageLimitsInfo } from "@opencode/client/promise"
import {
  selectUsageDialogView,
  startUsageDialog,
  transitionUsageDialog,
  USAGE_LOAD_TIMEOUT_MS,
  type UsageDialogEffect,
  type UsageDialogEvent,
  type UsageDialogState,
} from "./machine"

const limits = (name: string): UsageLimitsInfo => ({
  workspace: { id: `wrk_${name}`, name, usageURL: `https://opencode.ai/wrk_${name}/activity/overview` },
  budgets: [],
})

const limitsA = limits("A")

const limitsB = limits("B")

const KEY = JSON.stringify(["/repo", null])

function replay(events: UsageDialogEvent[], start = startUsageDialog({ key: KEY, cached: undefined })) {
  return events.reduce<{ state: UsageDialogState; effects: readonly UsageDialogEffect[] }>(
    (step, event) => transitionUsageDialog(step.state, event),
    start,
  )
}

describe("usage dialog machine", () => {
  test("a failed refresh over cached limits offers Try again instead of the stale numbers", () => {
    const start = startUsageDialog({ key: KEY, cached: limitsA })

    expect(start.effects).toEqual([
      { type: "sync", attempt: 1, key: KEY },
      { type: "timer.start", attempt: 1, timeoutMs: USAGE_LOAD_TIMEOUT_MS },
    ])
    expect(selectUsageDialogView(start.state)).toEqual({ status: "ready", info: limitsA, refreshing: true })

    const failed = replay([{ type: "load.failed", attempt: 1 }], start)
    expect(selectUsageDialogView(failed.state)).toEqual({ status: "failed" })
    expect(failed.effects).toEqual([{ type: "timer.stop" }])

    const retried = transitionUsageDialog(failed.state, { type: "retry" })
    expect(retried.effects).toEqual([
      { type: "sync", attempt: 2, key: KEY },
      { type: "timer.start", attempt: 2, timeoutMs: USAGE_LOAD_TIMEOUT_MS },
    ])
    expect(selectUsageDialogView(retried.state)).toEqual({ status: "loading" })

    const ready = transitionUsageDialog(retried.state, {
      type: "load.succeeded",
      attempt: 2,
      outcome: { kind: "limits", info: limitsB },
    })

    expect(selectUsageDialogView(ready.state)).toEqual({ status: "ready", info: limitsB, refreshing: false })
  })

  test("only an explicit signed-out answer shows signed out", () => {
    const loading = startUsageDialog({ key: KEY, cached: undefined }).state
    expect(transitionUsageDialog(loading, { type: "cache.synced", key: KEY, limits: undefined }).state).toBe(loading)

    const ready = replay([{ type: "load.succeeded", attempt: 1, outcome: { kind: "limits", info: limitsA } }]).state
    expect(transitionUsageDialog(ready, { type: "cache.synced", key: KEY, limits: undefined }).state).toBe(ready)

    const signedOut = transitionUsageDialog(ready, { type: "cache.synced", key: KEY, limits: null }).state
    expect(selectUsageDialogView(signedOut)).toEqual({ status: "signed-out" })
    expect(transitionUsageDialog(signedOut, { type: "cache.synced", key: KEY, limits: undefined }).state).toBe(
      signedOut,
    )

    expect(
      selectUsageDialogView(replay([{ type: "load.succeeded", attempt: 1, outcome: { kind: "signed-out" } }]).state),
    ).toEqual({ status: "signed-out" })

    // Signing in elsewhere fills the cache, and the dialog follows it.
    expect(
      selectUsageDialogView(
        transitionUsageDialog(signedOut, { type: "cache.synced", key: KEY, limits: limitsB }).state,
      ),
    ).toEqual({ status: "ready", info: limitsB, refreshing: false })
  })

  test("the shown limits follow the shared cache, but only for the dialog's location", () => {
    const refreshing = startUsageDialog({ key: KEY, cached: limitsA }).state
    const updated = transitionUsageDialog(refreshing, { type: "cache.synced", key: KEY, limits: limitsB }).state

    expect(selectUsageDialogView(updated)).toEqual({ status: "ready", info: limitsB, refreshing: true })
    expect(transitionUsageDialog(updated, { type: "cache.synced", key: "other", limits: limitsA }).state).toBe(updated)
  })

  test("a load that hangs times out, and its late answer is ignored", () => {
    const timedOut = replay([{ type: "load.timed-out", attempt: 1 }])

    expect(selectUsageDialogView(timedOut.state)).toEqual({ status: "failed" })
    expect(
      transitionUsageDialog(timedOut.state, {
        type: "load.succeeded",
        attempt: 1,
        outcome: { kind: "limits", info: limitsA },
      }).state,
    ).toBe(timedOut.state)
  })

  test("another location starts a new load and ignores the previous one", () => {
    const moved = replay([{ type: "location.changed", key: "other", cached: undefined }])

    expect(moved.effects).toEqual([
      { type: "timer.stop" },
      { type: "sync", attempt: 2, key: "other" },
      { type: "timer.start", attempt: 2, timeoutMs: USAGE_LOAD_TIMEOUT_MS },
    ])
    expect(transitionUsageDialog(moved.state, { type: "load.failed", attempt: 1 }).state).toBe(moved.state)
    expect(transitionUsageDialog(moved.state, { type: "location.changed", key: "other", cached: limitsA }).state).toBe(
      moved.state,
    )
  })

  test("closing the dialog stops its timer and ignores later results", () => {
    const disposed = replay([{ type: "disposed" }])

    expect(disposed.effects).toEqual([{ type: "timer.stop" }])
    expect(transitionUsageDialog(disposed.state, { type: "load.failed", attempt: 1 }).state).toBe(disposed.state)
    expect(transitionUsageDialog(disposed.state, { type: "retry" }).effects).toEqual([])
  })
})
