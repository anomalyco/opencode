import { describe, expect, test } from "bun:test"
import {
  BRANCH_LOAD_TIMEOUT_MS,
  INITIAL_INBOX_BRANCH_STATE,
  selectBranchLoading,
  transitionInboxBranch,
  type InboxBranchEvent,
  type InboxBranchState,
} from "./inbox-branch-machine"

const target = (key: string, server = "srv") => ({ key, server })

const run = (state: InboxBranchState, ...events: InboxBranchEvent[]) =>
  events.reduce((current, event) => transitionInboxBranch(current, event).state, state)

const entry = (state: InboxBranchState, key: string) => (state.status === "active" ? state.entries[key] : undefined)

describe("inbox branch machine", () => {
  test("retries a failed lookup instead of settling it for good", () => {
    const queued = transitionInboxBranch(INITIAL_INBOX_BRANCH_STATE, { type: "enqueue", targets: [target("a")] })

    expect(queued.effects).toEqual([{ type: "load.start", key: "a", attempt: 1, timeoutMs: BRANCH_LOAD_TIMEOUT_MS }])
    expect(selectBranchLoading(queued.state, "a")).toBe(true)

    const failed = transitionInboxBranch(queued.state, { type: "load.failed", key: "a", attempt: 1 })

    expect(failed.effects).toEqual([
      { type: "timer.clear", attempt: 1 },
      { type: "retry.schedule", key: "a", attempt: 2, delayMs: 1_000 },
    ])
    expect(selectBranchLoading(failed.state, "a")).toBe(false)

    // The view re-enqueues shown rows on every change; that must not count as a fresh lookup or a settled one.
    expect(transitionInboxBranch(failed.state, { type: "enqueue", targets: [target("a")] }).state).toBe(failed.state)

    const retried = transitionInboxBranch(failed.state, { type: "retry.due", key: "a", attempt: 2 })

    expect(retried.effects).toEqual([{ type: "load.start", key: "a", attempt: 3, timeoutMs: BRANCH_LOAD_TIMEOUT_MS }])
    expect(selectBranchLoading(retried.state, "a")).toBe(false)

    const ok = run(retried.state, { type: "load.succeeded", key: "a", attempt: 3 })

    expect(entry(ok, "a")).toEqual({ phase: "ok", server: "srv" })
  })

  test("starts the next lookup as soon as one slot frees, even when another hangs", () => {
    const keys = ["k1", "k2", "k3", "k4", "k5", "k6"]
    const started = transitionInboxBranch(INITIAL_INBOX_BRANCH_STATE, {
      type: "enqueue",
      targets: keys.map((key) => target(key)),
    })

    expect(started.effects.map((effect) => (effect.type === "load.start" ? effect.key : effect.type))).toEqual([
      "k1",
      "k2",
      "k3",
      "k4",
    ])

    const failed = transitionInboxBranch(started.state, { type: "load.failed", key: "k1", attempt: 1 })

    expect(failed.effects).toContainEqual({
      type: "load.start",
      key: "k5",
      attempt: 6,
      timeoutMs: BRANCH_LOAD_TIMEOUT_MS,
    })

    const hung = transitionInboxBranch(failed.state, { type: "load.timed-out", key: "k2", attempt: 2 })

    expect(hung.effects).toEqual([
      { type: "retry.schedule", key: "k2", attempt: 7, delayMs: 1_000 },
      { type: "load.start", key: "k6", attempt: 8, timeoutMs: BRANCH_LOAD_TIMEOUT_MS },
    ])
    expect(selectBranchLoading(hung.state, "k2")).toBe(false)

    // The hung request answering late belongs to an attempt that is no longer current.
    expect(transitionInboxBranch(hung.state, { type: "load.succeeded", key: "k2", attempt: 2 }).state).toBe(hung.state)
  })

  test("rests a location after its retries and wakes it when its server reconnects", () => {
    const connected = run(INITIAL_INBOX_BRANCH_STATE, { type: "connections.changed", connected: ["srv", "other"] })
    const failed = run(
      connected,
      { type: "enqueue", targets: [target("a"), target("b"), target("c", "other")] },
      { type: "load.failed", key: "a", attempt: 1 },
      { type: "retry.due", key: "a", attempt: 4 },
      { type: "load.failed", key: "a", attempt: 5 },
      { type: "retry.due", key: "a", attempt: 6 },
      { type: "load.failed", key: "a", attempt: 7 },
      { type: "load.failed", key: "b", attempt: 2 },
      { type: "load.failed", key: "c", attempt: 3 },
    )

    expect(entry(failed, "a")).toEqual({ phase: "failed", server: "srv" })
    expect(entry(failed, "b")).toEqual({ phase: "retrying", server: "srv", attempt: 8, failures: 1 })
    expect(selectBranchLoading(failed, "a")).toBe(false)
    expect(transitionInboxBranch(failed, { type: "enqueue", targets: [target("a")] }).state).toBe(failed)

    const dropped = run(failed, { type: "connections.changed", connected: ["other"] })
    const woken = transitionInboxBranch(dropped, { type: "connections.changed", connected: ["other", "srv"] })

    expect(woken.effects).toEqual([
      { type: "timer.clear", attempt: 8 },
      { type: "load.start", key: "a", attempt: 10, timeoutMs: BRANCH_LOAD_TIMEOUT_MS },
      { type: "load.start", key: "b", attempt: 11, timeoutMs: BRANCH_LOAD_TIMEOUT_MS },
    ])
    expect(entry(woken.state, "c")).toEqual(entry(failed, "c"))
    expect(selectBranchLoading(woken.state, "a")).toBe(false)
    expect(transitionInboxBranch(woken.state, { type: "retry.due", key: "b", attempt: 8 }).state).toBe(woken.state)
    expect(transitionInboxBranch(woken.state, { type: "connections.changed", connected: ["srv", "other"] }).state).toBe(
      woken.state,
    )
  })

  test("enqueues each location once", () => {
    const state = run(INITIAL_INBOX_BRANCH_STATE, { type: "enqueue", targets: [target("a"), target("a")] })

    expect(state.status === "active" && state.issued).toBe(1)
    expect(transitionInboxBranch(state, { type: "enqueue", targets: [target("a")] }).state).toBe(state)
  })

  test("ignores every event after disposal", () => {
    const loading = run(INITIAL_INBOX_BRANCH_STATE, { type: "enqueue", targets: [target("a")] })
    const disposed = transitionInboxBranch(loading, { type: "disposed" })

    expect(disposed.effects).toEqual([{ type: "timers.clear" }])
    expect(selectBranchLoading(disposed.state, "a")).toBe(false)

    const events: InboxBranchEvent[] = [
      { type: "enqueue", targets: [target("b")] },
      { type: "load.succeeded", key: "a", attempt: 1 },
      { type: "load.failed", key: "a", attempt: 1 },
      { type: "load.timed-out", key: "a", attempt: 1 },
      { type: "retry.due", key: "a", attempt: 1 },
      { type: "connections.changed", connected: ["srv"] },
      { type: "disposed" },
    ]

    events.forEach((event) =>
      expect(transitionInboxBranch(disposed.state, event)).toEqual({ state: disposed.state, effects: [] }),
    )
  })
})
