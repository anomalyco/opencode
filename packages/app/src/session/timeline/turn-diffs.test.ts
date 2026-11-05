import { afterEach, describe, expect, jest, test } from "bun:test"
import type { FileDiffInfo } from "@opencode/client/promise"
import { createRoot } from "solid-js"
import {
  createTurnDiffCacheState,
  selectTurnDiffState,
  transitionTurnDiffCache,
  TURN_DIFF_LOAD_TIMEOUT_MS,
  type TurnDiffCacheEffect,
  type TurnDiffCacheEvent,
  type TurnDiffCacheState,
} from "./turn-diff-machine"
import { createTurnDiffCache } from "./turn-diffs"

const turn = { sessionID: "ses_a", from: "msg_open" }

const key = "ses_a/msg_open"

// Every pending promise callback runs before the next macrotask.
const settle = () => new Promise((resolve) => setImmediate(resolve))

const diff = { file: "src/a.ts", patch: "", additions: 1, deletions: 0, status: "modified" } satisfies FileDiffInfo

const replay = (events: TurnDiffCacheEvent[], from: TurnDiffCacheState = createTurnDiffCacheState()) =>
  events.reduce<{ state: TurnDiffCacheState; effects: TurnDiffCacheEffect[] }>(
    (current, event) => {
      const next = transitionTurnDiffCache(current.state, event)

      return { state: next.state, effects: [...current.effects, ...next.effects] }
    },
    { state: from, effects: [] },
  )

describe("turn diff machine", () => {
  test("a load that times out fails, a retry starts a new attempt, and the timed-out result is ignored", () => {
    const timedOut = replay([
      { type: "load.requested", key },
      { type: "load.timed-out", key, attempt: 1 },
    ])

    expect(selectTurnDiffState(timedOut.state, key)).toEqual({ status: "failed" })
    expect(timedOut.effects).toEqual([
      { type: "fetch", key, attempt: 1, timeoutMs: TURN_DIFF_LOAD_TIMEOUT_MS },
      { type: "cancel", attempt: 1 },
    ])

    const retried = replay([{ type: "load.requested", key }], timedOut.state)
    expect(retried.effects).toEqual([{ type: "fetch", key, attempt: 2, timeoutMs: TURN_DIFF_LOAD_TIMEOUT_MS }])

    const late = transitionTurnDiffCache(retried.state, { type: "load.succeeded", key, attempt: 1, diffs: [] })
    expect(late.state).toBe(retried.state)
    expect(late.effects).toEqual([])

    const loaded = replay([{ type: "load.succeeded", key, attempt: 2, diffs: [diff] }], retried.state)
    expect(selectTurnDiffState(loaded.state, key)).toEqual({ status: "ready", diffs: [diff] })
    expect(loaded.effects).toEqual([{ type: "cancel", attempt: 2 }])
  })

  test("a failed load is distinct from one still loading", () => {
    const loading = replay([{ type: "load.requested", key }]).state
    expect(selectTurnDiffState(loading, key)).toEqual({ status: "loading" })
    expect(selectTurnDiffState(replay([{ type: "load.failed", key, attempt: 1 }], loading).state, key)).toEqual({
      status: "failed",
    })
  })

  test("a request while loading or loaded changes nothing", () => {
    const loading = replay([{ type: "load.requested", key }]).state
    const loaded = replay([{ type: "load.succeeded", key, attempt: 1, diffs: [diff] }], loading).state

    expect([loading, loaded].map((state) => transitionTurnDiffCache(state, { type: "load.requested", key }))).toEqual([
      { state: loading, effects: [] },
      { state: loaded, effects: [] },
    ])
  })

  test("a result carrying another turn's attempt is ignored", () => {
    const other = "ses_a/msg_next"

    const both = replay([
      { type: "load.requested", key },
      { type: "load.requested", key: other },
      { type: "load.failed", key: other, attempt: 1 },
    ])

    expect(selectTurnDiffState(both.state, key)).toEqual({ status: "loading" })
    expect(selectTurnDiffState(both.state, other)).toEqual({ status: "loading" })
  })

  test("disposing cancels every load still running and ignores later results", () => {
    const disposed = replay([
      { type: "load.requested", key },
      { type: "load.requested", key: "ses_a/msg_next" },
      { type: "load.succeeded", key: "ses_a/msg_next", attempt: 2, diffs: [] },
      { type: "disposed" },
    ])

    expect(disposed.effects.slice(-1)).toEqual([{ type: "cancel", attempt: 1 }])
    expect(transitionTurnDiffCache(disposed.state, { type: "load.succeeded", key, attempt: 1, diffs: [] })).toEqual({
      state: disposed.state,
      effects: [],
    })
  })
})

describe("turn diff cache", () => {
  afterEach(() => {
    jest.useRealTimers()
  })

  test("a fetch that throws synchronously fails the turn instead of leaving it loading", async () => {
    const cache = createRoot(() => createTurnDiffCache())

    cache.load(turn, () => {
      throw new Error("boom")
    })
    await settle()
    expect(cache.state(turn)).toEqual({ status: "failed" })

    cache.load(turn, () => Promise.resolve([diff]))
    await settle()
    expect(cache.state(turn)).toEqual({ status: "ready", diffs: [diff] })
  })

  test("a rejected fetch fails the turn, and only a retry fetches again", async () => {
    const cache = createRoot(() => createTurnDiffCache())
    const failed = Promise.withResolvers<readonly FileDiffInfo[]>()
    const calls: string[] = []

    cache.load(turn, () => (calls.push("failed"), failed.promise))
    cache.load(turn, () => (calls.push("duplicate"), Promise.resolve([diff])))
    expect(cache.state(turn)).toEqual({ status: "loading" })
    failed.reject(new Error("offline"))
    await settle()
    expect(cache.state(turn)).toEqual({ status: "failed" })

    cache.load(turn, () => (calls.push("retry"), Promise.resolve([diff])))
    await settle()
    cache.load(turn, () => (calls.push("cached"), Promise.resolve([])))

    expect(calls).toEqual(["failed", "retry"])
    expect(cache.state(turn)).toEqual({ status: "ready", diffs: [diff] })
  })

  test("a response that never finishes times out, aborts, and lets a retry through", async () => {
    jest.useFakeTimers()
    const cache = createRoot(() => createTurnDiffCache())
    const signals: AbortSignal[] = []

    cache.load(turn, (signal) => (signals.push(signal), new Promise<never>(() => {})))
    jest.advanceTimersByTime(TURN_DIFF_LOAD_TIMEOUT_MS)
    expect(cache.state(turn)).toEqual({ status: "failed" })
    expect(signals[0]?.aborted).toBe(true)

    cache.load(turn, (signal) => (signals.push(signal), Promise.resolve([diff])))
    jest.useRealTimers()
    await settle()
    expect(cache.state(turn)).toEqual({ status: "ready", diffs: [diff] })
    expect(signals).toHaveLength(2)
  })

  test("closing the tab aborts a load still running, and its result is dropped", async () => {
    jest.useFakeTimers()
    const pending = Promise.withResolvers<readonly FileDiffInfo[]>()
    const signals: AbortSignal[] = []

    const { cache, dispose } = createRoot((dispose) => ({ cache: createTurnDiffCache(), dispose }))
    cache.load(turn, (signal) => (signals.push(signal), pending.promise))
    dispose()

    expect(signals[0]?.aborted).toBe(true)
    jest.advanceTimersByTime(TURN_DIFF_LOAD_TIMEOUT_MS)
    jest.useRealTimers()
    pending.resolve([diff])
    await settle()
    expect(cache.state(turn).status).not.toBe("ready")
  })
})
