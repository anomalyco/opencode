import { describe, expect, test } from "bun:test"
import {
  createRequestQueueState,
  selectInflightCount,
  selectQueuedCount,
  transitionRequestQueue,
  type RequestPriority,
  type RequestQueueEffect,
  type RequestQueueEvent,
  type RequestQueueState,
} from "./request-queue-machine"

const config = { limit: 1, slowLimit: 1, stallMs: 2_000 }

function run(events: readonly RequestQueueEvent[], options = config, from = createRequestQueueState()) {
  return events.reduce<{ state: RequestQueueState; effects: RequestQueueEffect[] }>(
    (acc, event) => {
      const next = transitionRequestQueue(acc.state, event, options)

      return { state: next.state, effects: [...acc.effects, ...next.effects] }
    },
    { state: from, effects: [] },
  )
}

const arrive = (url: string, now: number, priority: RequestPriority = 0, slow = false): RequestQueueEvent => ({
  type: "request.arrived",
  method: priority === 2 ? "POST" : "GET",
  url,
  slow,
  priority,
  now,
})

describe("transitionRequestQueue", () => {
  test("an aborted waiter leaves the queue at once and is never started", () => {
    const queued = run([arrive("/stuck", 0), arrive("/second", 0)])
    expect(selectQueuedCount(queued.state)).toBe(1)

    const aborted = transitionRequestQueue(queued.state, { type: "request.aborted", id: 2, now: 10 }, config)
    expect(selectQueuedCount(aborted.state)).toBe(0)
    expect(selectInflightCount(aborted.state)).toBe(1)
    expect(aborted.effects).toEqual([{ type: "watcher.stop" }])

    const settled = transitionRequestQueue(aborted.state, { type: "request.settled", id: 1, now: 20 }, config)
    expect(settled.effects).toEqual([])
    expect(selectInflightCount(settled.state)).toBe(0)
  })

  test("a starving background request is reported even when higher priorities queue ahead of it", () => {
    const queued = run([arrive("/busy", 0), arrive("/background", 0), arrive("/write", 1_900, 2)])
    expect(queued.state.status === "queued" && queued.state.waiting.map((entry) => entry.url)).toEqual([
      "/write",
      "/background",
    ])

    const due = transitionRequestQueue(queued.state, { type: "watch.due", now: 2_000 }, config)
    expect(due.effects.map((effect) => effect.type)).toEqual(["watcher.start", "log.stall"])
  })

  test("after the oldest waiter leaves, the watcher waits out the next one's remaining budget", () => {
    const queued = run([
      arrive("/busy", 0),
      arrive("/a", 0),
      arrive("/b", 1_200),
      { type: "request.aborted", id: 2, now: 1_500 },
    ])

    const early = transitionRequestQueue(queued.state, { type: "watch.due", now: 2_000 }, config)
    expect(early.effects).toEqual([{ type: "watcher.start", delayMs: 1_200 }])
    expect(early.state).toBe(queued.state)

    const late = transitionRequestQueue(early.state, { type: "watch.due", now: 3_200 }, config)
    expect(late.effects.map((effect) => effect.type)).toEqual(["watcher.start", "log.stall"])
  })

  test("fast reads take free slots while a slow request waits for the slow share", () => {
    const options = { limit: 3, slowLimit: 1, stallMs: 2_000 }
    const result = run([arrive("/api/vcs", 0, 0, true), arrive("/api/worktree", 0, 0, true), arrive("/fast", 0)], options)
    expect(result.effects).toEqual([
      { type: "request.start", id: 1 },
      { type: "watcher.start", delayMs: 2_000 },
      { type: "request.start", id: 3 },
    ])

    // A fast request finishing frees no slow slot; the slow one finishing does.
    const fast = transitionRequestQueue(result.state, { type: "request.settled", id: 3, now: 5 }, options)
    expect(fast.effects).toEqual([])
    const slow = transitionRequestQueue(fast.state, { type: "request.settled", id: 1, now: 6 }, options)
    expect(slow.effects).toEqual([{ type: "watcher.stop" }, { type: "request.start", id: 2 }])
    expect(slow.state.status).toBe("running")
  })

  test("events that do not apply return the same state", () => {
    const idle = createRequestQueueState()
    expect(transitionRequestQueue(idle, { type: "watch.due", now: 1 }, config).state).toBe(idle)
    expect(transitionRequestQueue(idle, { type: "request.settled", id: 9, now: 1 }, config).state).toBe(idle)

    const queued = run([arrive("/busy", 0), arrive("/a", 0)]).state
    expect(transitionRequestQueue(queued, { type: "request.settled", id: 2, now: 1 }, config).state).toBe(queued)
    expect(transitionRequestQueue(queued, { type: "request.aborted", id: 9, now: 1 }, config).state).toBe(queued)
  })

  test("disposal cancels queued and in-flight requests, stops the watcher and ignores later events", () => {
    const queued = run([arrive("/busy", 0), arrive("/a", 0), arrive("/b", 0)]).state
    const disposed = transitionRequestQueue(queued, { type: "disposed" }, config)
    expect(disposed.effects).toEqual([{ type: "watcher.stop" }, { type: "request.cancel", ids: [2, 3, 1] }])
    expect(selectInflightCount(disposed.state)).toBe(0)

    for (const event of [arrive("/late", 1), { type: "request.settled", id: 1, now: 1 } as const, { type: "disposed" } as const])
      expect(transitionRequestQueue(disposed.state, event, config)).toEqual({ state: disposed.state, effects: [] })

    const running = run([arrive("/busy", 0)]).state
    expect(transitionRequestQueue(running, { type: "disposed" }, config).effects).toEqual([
      { type: "request.cancel", ids: [1] },
    ])
  })
})
