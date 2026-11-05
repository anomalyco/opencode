import { describe, expect, test } from "bun:test"
import {
  WORKER_OPEN_TIMEOUT_MS,
  transitionWorker,
  workerLoading,
  workerOpened,
  type WorkerEvent,
  type WorkerState,
  type WorkerTransition,
} from "./worker-machine"

type Value = { readonly name: string }

const bytes = new Uint8Array([1, 2, 3])

const reloaded = new Uint8Array([4, 5, 6])

const opened = (attempt: number, details?: readonly string[]): WorkerEvent<Value> => ({
  type: "open.succeeded",
  attempt,
  value: { name: `file ${attempt}` },
  details,
})

// Folds the events in order and returns the last transition.
const replay = (events: readonly WorkerEvent<Value>[], state: WorkerState<Value> = { status: "idle" }) =>
  events.reduce<WorkerTransition<Value>>((last, event) => transitionWorker(last.state, event), { state, effects: [] })

describe("transitionWorker", () => {
  test("new bytes claim an attempt and start its worker with a bounded open", () => {
    const result = replay([{ type: "bytes.changed", bytes }])

    expect(result).toEqual({
      state: { status: "opening", attempt: 1 },
      effects: [{ type: "open-worker", attempt: 1, bytes, timeoutMs: WORKER_OPEN_TIMEOUT_MS }],
    })
    expect(workerLoading(result.state)).toBe(true)
    expect(workerOpened(result.state)).toBeUndefined()
  })

  test("a worker that crashes while opening reports the error once, not again when the open call rejects", () => {
    const crashed = replay([
      { type: "bytes.changed", bytes },
      { type: "worker.crashed", attempt: 1 },
    ])

    expect(crashed).toEqual({
      state: { status: "failed", attempt: 1 },
      effects: [{ type: "close-worker", attempt: 1 }, { type: "report-error" }],
    })

    // The worker client rejects the pending open with WorkerClosedError when the worker dies.
    const rejected = transitionWorker(crashed.state, { type: "open.failed", attempt: 1 })

    expect(rejected.state).toBe(crashed.state)
    expect(rejected.effects).toEqual([])
    expect(workerLoading(crashed.state)).toBe(false)
  })

  test("an open reply that lands after the worker failed never shows the file or its details", () => {
    const crashed = replay([
      { type: "bytes.changed", bytes },
      { type: "worker.crashed", attempt: 1 },
    ])

    const late = transitionWorker(crashed.state, opened(1, ["3 slides"]))

    expect(late.state).toBe(crashed.state)
    expect(late.effects).toEqual([])
    expect(workerOpened(late.state)).toBeUndefined()
  })

  test("an open reports its details and shows the file", () => {
    const result = replay([{ type: "bytes.changed", bytes }, opened(1, ["2 sheets"])])

    expect(result).toEqual({
      state: { status: "open", attempt: 1, value: { name: "file 1" } },
      effects: [
        { type: "cancel-open-timeout", attempt: 1 },
        { type: "report-details", details: ["2 sheets"] },
      ],
    })
    expect(workerOpened(result.state) === result.state).toBe(true)
    expect(workerLoading(result.state)).toBe(false)
    expect(replay([{ type: "bytes.changed", bytes }, opened(1)]).effects).toEqual([
      { type: "cancel-open-timeout", attempt: 1 },
    ])
  })

  test("a worker that crashes after the file showed takes it down once", () => {
    const crashed = replay([{ type: "bytes.changed", bytes }, opened(1), { type: "worker.crashed", attempt: 1 }])

    expect(crashed).toEqual({
      state: { status: "failed", attempt: 1 },
      effects: [{ type: "close-worker", attempt: 1 }, { type: "report-error" }],
    })
    expect(workerOpened(crashed.state)).toBeUndefined()

    const again = transitionWorker(crashed.state, { type: "worker.crashed", attempt: 1 })

    expect(again.state).toBe(crashed.state)
    expect(again.effects).toEqual([])
  })

  test("a file the worker cannot open, or one it hangs on, fails once and closes its worker", () => {
    for (const event of [
      { type: "open.failed", attempt: 1 },
      { type: "open.timed-out", attempt: 1 },
    ] satisfies WorkerEvent<Value>[]) {
      const failed = replay([{ type: "bytes.changed", bytes }, event])

      expect(failed).toEqual({
        state: { status: "failed", attempt: 1 },
        effects: [{ type: "close-worker", attempt: 1 }, { type: "report-error" }],
      })
      expect(transitionWorker(failed.state, opened(1)).state).toBe(failed.state)
      expect(transitionWorker(failed.state, { type: "worker.crashed", attempt: 1 }).effects).toEqual([])
    }
  })

  test("a timeout after the file opened changes nothing", () => {
    const open = replay([{ type: "bytes.changed", bytes }, opened(1)])
    const timedOut = transitionWorker(open.state, { type: "open.timed-out", attempt: 1 })

    expect(timedOut.state).toBe(open.state)
    expect(timedOut.effects).toEqual([])
  })

  test("reloaded bytes close the previous worker, and its late results change nothing", () => {
    const reloading = replay([
      { type: "bytes.changed", bytes },
      { type: "bytes.changed", bytes: reloaded },
    ])

    expect(reloading).toEqual({
      state: { status: "opening", attempt: 2 },
      effects: [
        { type: "close-worker", attempt: 1 },
        { type: "open-worker", attempt: 2, bytes: reloaded, timeoutMs: WORKER_OPEN_TIMEOUT_MS },
      ],
    })

    for (const event of [
      opened(1),
      { type: "open.failed", attempt: 1 },
      { type: "open.timed-out", attempt: 1 },
      { type: "worker.crashed", attempt: 1 },
    ] satisfies WorkerEvent<Value>[]) {
      const stale = transitionWorker(reloading.state, event)

      expect(stale.state).toBe(reloading.state)
      expect(stale.effects).toEqual([])
    }

    expect(transitionWorker(reloading.state, { type: "open.timed-out", attempt: 2 })).toEqual({
      state: { status: "failed", attempt: 2 },
      effects: [{ type: "close-worker", attempt: 2 }, { type: "report-error" }],
    })
  })

  test("reloading an open or failed file starts a fresh attempt", () => {
    expect(replay([{ type: "bytes.changed", bytes }, opened(1), { type: "bytes.changed", bytes: reloaded }])).toEqual({
      state: { status: "opening", attempt: 2 },
      effects: [
        { type: "close-worker", attempt: 1 },
        { type: "open-worker", attempt: 2, bytes: reloaded, timeoutMs: WORKER_OPEN_TIMEOUT_MS },
      ],
    })
    expect(
      replay([
        { type: "bytes.changed", bytes },
        { type: "open.failed", attempt: 1 },
        { type: "bytes.changed", bytes: reloaded },
      ]),
    ).toEqual({
      state: { status: "opening", attempt: 2 },
      effects: [{ type: "open-worker", attempt: 2, bytes: reloaded, timeoutMs: WORKER_OPEN_TIMEOUT_MS }],
    })
  })

  test("disposal closes the active worker and ignores everything after it", () => {
    const opening = replay([{ type: "bytes.changed", bytes }, { type: "disposed" }])

    expect(opening).toEqual({ state: { status: "disposed" }, effects: [{ type: "close-worker", attempt: 1 }] })
    expect(replay([{ type: "bytes.changed", bytes }, opened(1), { type: "disposed" }]).effects).toEqual([
      { type: "close-worker", attempt: 1 },
    ])
    expect(
      replay([{ type: "bytes.changed", bytes }, { type: "open.failed", attempt: 1 }, { type: "disposed" }]).effects,
    ).toEqual([])
    expect(replay([{ type: "disposed" }]).effects).toEqual([])

    for (const event of [
      { type: "bytes.changed", bytes: reloaded },
      opened(1),
      { type: "worker.crashed", attempt: 1 },
      { type: "disposed" },
    ] satisfies WorkerEvent<Value>[]) {
      const after = transitionWorker(opening.state, event)

      expect(after.state).toBe(opening.state)
      expect(after.effects).toEqual([])
    }

    expect(workerLoading(opening.state)).toBe(false)
  })

  test("results before any bytes change nothing", () => {
    const idle: WorkerState<Value> = { status: "idle" }

    expect(transitionWorker(idle, opened(0)).state).toBe(idle)
    expect(workerLoading(idle)).toBe(true)
  })
})
