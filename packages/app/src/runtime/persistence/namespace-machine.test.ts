import { describe, expect, test } from "bun:test"
import {
  INITIAL_NAMESPACE_STATE,
  selectNamespaceItem,
  selectNamespaceKeys,
  transitionNamespace,
  type NamespaceEvent,
  type NamespaceState,
  type NamespaceTransition,
} from "./namespace-machine"

function replay(events: NamespaceEvent[], from = INITIAL_NAMESPACE_STATE) {
  return events.reduce<NamespaceTransition[]>((steps, event) => {
    steps.push(transitionNamespace(steps.at(-1)?.state ?? from, event))

    return steps
  }, [])
}

function settle(events: NamespaceEvent[], from = INITIAL_NAMESPACE_STATE) {
  return replay(events, from).at(-1)?.state ?? from
}

const loaded = (items: Record<string, string> = {}, revision = 0): NamespaceEvent[] => [
  { type: "load" },
  { type: "load.succeeded", items, revision },
]

describe("transitionNamespace", () => {
  test("a failed batch requeues its keys and schedules a retry with doubling backoff", () => {
    const steps = replay([
      { type: "write", key: "tabs", value: "[1]" },
      { type: "flush" },
      { type: "batch.failed", batch: 1 },
      { type: "flush" },
      { type: "batch.failed", batch: 2 },
    ])

    expect(steps.map((step) => step.effects)).toEqual([
      [{ type: "timer.arm", delayMs: 100 }],
      [{ type: "timer.cancel" }, { type: "send", batch: 1, insert: { tabs: "[1]" }, remove: [] }],
      [{ type: "timer.arm", delayMs: 200 }],
      [{ type: "timer.cancel" }, { type: "send", batch: 2, insert: { tabs: "[1]" }, remove: [] }],
      [{ type: "timer.arm", delayMs: 400 }],
    ])
    expect(steps.at(-1)?.state.entries.get("tabs")).toEqual({ status: "dirty", value: "[1]", deferred: undefined })
  })

  test("retry backoff stops growing at the cap and resets after a successful batch", () => {
    const failing = settle(
      Array.from({ length: 12 }, (_, index): NamespaceEvent[] => [
        { type: "flush" },
        { type: "batch.failed", batch: index + 1 },
      ]).flat(),
      settle([{ type: "write", key: "tabs", value: "[1]" }]),
    )

    expect(failing.failures).toBe(12)
    expect(replay([{ type: "flush" }, { type: "batch.failed", batch: 13 }], failing).at(-1)?.effects).toEqual([
      { type: "timer.arm", delayMs: 25_600 },
    ])

    const recovered = settle([{ type: "flush" }, { type: "batch.succeeded", batch: 13, revision: 1 }], failing)

    expect(recovered.failures).toBe(0)
    expect(transitionNamespace(recovered, { type: "write", key: "tabs", value: "[2]" }).effects).toEqual([
      { type: "timer.arm", delayMs: 100 },
    ])
  })

  test("a write while a flush is already scheduled does not move the timer", () => {
    const writes: NamespaceEvent[] = [
      { type: "write", key: "tabs", value: "[1]" },
      { type: "write", key: "recent", value: "{}" },
      { type: "write", key: "tabs", value: null },
    ]

    expect(replay(writes).map((step) => step.effects)).toEqual([[{ type: "timer.arm", delayMs: 100 }], [], []])
    expect(transitionNamespace(settle(writes), { type: "flush" }).effects).toEqual([
      { type: "timer.cancel" },
      { type: "send", batch: 1, insert: { recent: "{}" }, remove: ["tabs"] },
    ])
  })

  test("a batch settles only the keys it still carries", () => {
    const state = settle([
      { type: "write", key: "tabs", value: "old" },
      { type: "write", key: "recent", value: "{}" },
      { type: "flush" },
      { type: "write", key: "tabs", value: "new" },
    ])

    const failed = transitionNamespace(state, { type: "batch.failed", batch: 1 })
    const acked = transitionNamespace(state, { type: "batch.succeeded", batch: 1, revision: 4 })

    // The rewritten key is already queued, so its timer is armed and the requeued sibling rides along.
    expect(failed.effects).toEqual([])
    expect(failed.state.entries.get("tabs")).toEqual({ status: "dirty", value: "new", deferred: undefined })
    expect(failed.state.entries.get("recent")).toEqual({ status: "dirty", value: "{}", deferred: undefined })
    expect(acked.state.entries.get("tabs")).toEqual({ status: "dirty", value: "new", deferred: undefined })
    expect(acked.state.entries.get("recent")).toEqual({ status: "synced", value: "{}", revision: 4 })
  })

  test("a failed batch whose keys a later batch replaced requeues nothing", () => {
    const state = settle([
      { type: "write", key: "tabs", value: "old" },
      { type: "flush" },
      { type: "write", key: "tabs", value: "new" },
      { type: "flush" },
    ])

    const failed = transitionNamespace(state, { type: "batch.failed", batch: 1 })

    expect(failed.effects).toEqual([])
    expect(failed.state.entries).toBe(state.entries)
    expect(transitionNamespace(state, { type: "batch.succeeded", batch: 1, revision: 1 }).state).toBe(state)
  })

  test("a snapshot that finishes during an in-flight write holds the newer host value for after the ack", () => {
    const state = settle([
      { type: "write", key: "model", value: "mine" },
      { type: "flush" },
      // Another window wrote the key at revision 2; this window's write lands at revision 1.
      ...loaded({ model: "theirs" }, 2),
    ])

    const echo = transitionNamespace(state, { type: "remote", insert: { model: "theirs" }, remove: [], revision: 2 })

    expect(selectNamespaceItem(state, "model")).toBe("mine")
    expect(echo.state).toBe(state)
    expect(settle([{ type: "batch.succeeded", batch: 1, revision: 1 }], state).entries.get("model")).toEqual({
      status: "synced",
      value: "theirs",
      revision: 2,
    })
  })

  test("a snapshot older than the local write leaves the local value after the ack", () => {
    const state = settle([
      { type: "load" },
      { type: "write", key: "model", value: "mine" },
      { type: "flush" },
      { type: "load.succeeded", items: { model: "older" }, revision: 0 },
      { type: "batch.succeeded", batch: 1, revision: 1 },
    ])

    expect(state.entries.get("model")).toEqual({ status: "synced", value: "mine", revision: 1 })
  })

  test("a failed load returns to unloaded so the next read loads again", () => {
    const steps = replay([{ type: "load" }, { type: "load.failed" }, { type: "load" }])

    expect(steps.map((step) => [step.state.status, step.effects])).toEqual([
      ["loading", [{ type: "load" }]],
      ["unloaded", []],
      ["loading", [{ type: "load" }]],
    ])
  })

  test("a snapshot that finishes after a clear cannot bring cleared keys back", () => {
    const state = settle([{ type: "load" }, { type: "clear" }])
    const late = transitionNamespace(state, { type: "load.succeeded", items: { tabs: "old" }, revision: 10 })

    expect(late.state).toBe(state)
    expect(selectNamespaceKeys(state)).toEqual([])
    expect(transitionNamespace(state, { type: "load.failed" }).state).toBe(state)
  })

  test("an event stamped before a clear cannot bring a cleared key back", () => {
    const state = settle([
      ...loaded(),
      { type: "write", key: "tabs", value: "[1]" },
      { type: "flush" },
      { type: "batch.succeeded", batch: 1, revision: 5 },
      { type: "clear" },
    ])

    expect(state.floor).toBe(5)
    expect(
      transitionNamespace(state, { type: "remote", insert: { tabs: "stale" }, remove: [], revision: 3 }).state,
    ).toBe(state)
    expect(
      selectNamespaceItem(
        settle([{ type: "remote", insert: { tabs: "fresh" }, remove: [], revision: 6 }], state),
        "tabs",
      ),
    ).toBe("fresh")
  })

  test("a clear cancels the scheduled flush and ignores replies to batches sent before it", () => {
    const sent = settle([...loaded(), { type: "write", key: "tabs", value: "[1]" }, { type: "flush" }])
    const queued = transitionNamespace(sent, { type: "write", key: "recent", value: "{}" }).state
    const cleared = transitionNamespace(queued, { type: "clear" })

    expect(cleared.effects).toEqual([{ type: "timer.cancel" }])
    expect(transitionNamespace(sent, { type: "clear" }).effects).toEqual([])
    expect(transitionNamespace(cleared.state, { type: "batch.succeeded", batch: 1, revision: 5 }).state).toBe(
      cleared.state,
    )

    const failed = transitionNamespace(cleared.state, { type: "batch.failed", batch: 1 })

    expect(failed.effects).toEqual([])
    expect(selectNamespaceKeys(failed.state)).toEqual([])
  })

  test("events that do not apply return the same state", () => {
    const unloaded = INITIAL_NAMESPACE_STATE
    const loading = settle([{ type: "load" }])
    const ready = settle(loaded({ tabs: "[1]" }, 3))

    const cases: [NamespaceState, NamespaceEvent][] = [
      [loading, { type: "load" }],
      [ready, { type: "load" }],
      [unloaded, { type: "load.succeeded", items: {}, revision: 1 }],
      [ready, { type: "load.succeeded", items: {}, revision: 9 }],
      [unloaded, { type: "load.failed" }],
      [ready, { type: "load.failed" }],
      [ready, { type: "flush" }],
      [ready, { type: "batch.succeeded", batch: 7, revision: 9 }],
      [ready, { type: "remote", insert: { tabs: "old" }, remove: [], revision: 3 }],
      [ready, { type: "remote", insert: {}, remove: [], revision: 4 }],
    ]

    cases.forEach(([state, event]) => {
      const next = transitionNamespace(state, event)

      expect(next.state).toBe(state)
      expect(next.effects).toEqual([])
    })
  })
})
