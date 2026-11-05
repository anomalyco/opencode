import { describe, expect, test } from "bun:test"
import {
  initialServiceLoadState,
  SERVICE_LOAD_TIMEOUT_MS,
  serviceLoadView,
  transitionServiceLoad,
  type ServiceLoadEvent,
  type ServiceLoadState,
  type ServiceLoadTransition,
} from "./service-load-machine"

type List = readonly string[]

// The server's data store, which a restarted server replaces.
const store = {}
const restarted = {}

const shown = (cached?: List, source: object = store): ServiceLoadEvent<List> => ({
  type: "context.changed",
  shown: true,
  source,
  cached,
  retain: true,
})

const hidden = (cached?: List, source: object = store): ServiceLoadEvent<List> => ({
  type: "context.changed",
  shown: false,
  source,
  cached,
  retain: true,
})

const run = (attempt: number) => ({ type: "run", attempt, timeoutMs: SERVICE_LOAD_TIMEOUT_MS })

// Folds the events in order and returns the last transition.
const replay = (
  events: readonly ServiceLoadEvent<List>[],
  state: ServiceLoadState<List> = initialServiceLoadState(),
) =>
  events.reduce<ServiceLoadTransition<List>>((last, event) => transitionServiceLoad(last.state, event), {
    state,
    effects: [],
  })

const loaded = [shown(), { type: "load.succeeded", attempt: 1, value: ["supermemory"] }] satisfies ServiceLoadEvent<List>[]

describe("transitionServiceLoad", () => {
  test("a failed or timed-out refresh keeps the cached list, footer and row badges", () => {
    for (const end of ["load.failed", "load.timed-out"] as const) {
      const refreshing = replay([...loaded, { type: "refresh.requested" }])

      expect(refreshing.effects).toEqual([run(2)])
      expect(serviceLoadView(refreshing.state)).toEqual({ status: "ready", busy: true, value: ["supermemory"] })

      const failed = transitionServiceLoad(refreshing.state, { type: end, attempt: 2 })

      expect(failed.effects).toEqual([{ type: "abort", attempt: 2 }])
      expect(serviceLoadView(failed.state)).toEqual({ status: "ready", busy: false, value: ["supermemory"] })
    }
  })

  test("a change announced while the list hides fetches nothing until it shows", () => {
    const hiddenReady = replay([...loaded, hidden()])

    expect(transitionServiceLoad(hiddenReady.state, { type: "invalidated" })).toEqual({
      state: hiddenReady.state,
      effects: [],
    })

    const neverShown = replay([hidden()])

    expect(transitionServiceLoad(neverShown.state, { type: "invalidated" }).effects).toEqual([])
    expect(transitionServiceLoad(hiddenReady.state, shown()).effects).toEqual([run(2)])
  })

  test("a change announced during a load loads once more after it", () => {
    const queued = replay([shown(), { type: "invalidated" }, { type: "invalidated" }])

    expect(queued.effects).toEqual([])

    const next = transitionServiceLoad(queued.state, { type: "load.succeeded", attempt: 1, value: ["old"] })

    expect(next.effects).toEqual([{ type: "abort", attempt: 1 }, run(2)])
    expect(serviceLoadView(next.state)).toEqual({ status: "ready", busy: true, value: ["old"] })
    expect(transitionServiceLoad(next.state, { type: "invalidated" }).state).toMatchObject({ queued: true })
  })

  test("a list that never loaded shows loading, never empty", () => {
    expect(serviceLoadView(initialServiceLoadState())).toEqual({ status: "loading", busy: false, value: undefined })
    expect(serviceLoadView(replay([hidden()]).state)).toEqual({ status: "loading", busy: false, value: undefined })
  })

  test("a first load that fails or times out shows the error, and Retry loads again", () => {
    const failed = replay([shown(), { type: "load.timed-out", attempt: 1 }])

    expect(serviceLoadView(failed.state)).toEqual({ status: "error", busy: false, value: undefined })

    const retried = transitionServiceLoad(failed.state, { type: "retry.requested" })

    expect(retried.effects).toEqual([run(2)])
    expect(serviceLoadView(retried.state).status).toBe("loading")
    // The hung request settles later and changes nothing.
    expect(transitionServiceLoad(retried.state, { type: "load.succeeded", attempt: 1, value: [] }).state).toBe(
      retried.state,
    )
  })

  test("opening the list again while it loads joins the load", () => {
    for (const events of [[shown()], [...loaded, { type: "refresh.requested" }]] satisfies ServiceLoadEvent<List>[][]) {
      const state = replay(events).state

      expect(transitionServiceLoad(state, { type: "refresh.requested" }).state).toBe(state)
    }
  })

  test("hiding the list ends its load, which loads again on the next show", () => {
    const hiddenLoad = replay([shown(), hidden()])

    expect(hiddenLoad.effects).toEqual([{ type: "abort", attempt: 1 }])
    expect(transitionServiceLoad(hiddenLoad.state, { type: "load.failed", attempt: 1 }).state).toBe(hiddenLoad.state)
    expect(transitionServiceLoad(hiddenLoad.state, shown()).effects).toEqual([run(2)])
  })

  test("a list in the data store shows as soon as the store holds it", () => {
    const loading = replay([shown()])
    const synced = transitionServiceLoad(loading.state, shown(["summary-mcp"]))

    expect(synced.effects).toEqual([])
    expect(serviceLoadView(synced.state)).toEqual({ status: "ready", busy: true, value: ["summary-mcp"] })
    // Opening a list the store already holds shows it while it loads again.
    expect(serviceLoadView(replay([shown(["summary-mcp"])]).state)).toMatchObject({ status: "ready", busy: true })
  })

  test("a new data store loads afresh and ignores the previous store's load", () => {
    const loading = replay([...loaded, { type: "refresh.requested" }])
    const swapped = transitionServiceLoad(loading.state, shown(undefined, restarted))

    expect(swapped.effects).toEqual([{ type: "abort", attempt: 2 }, run(3)])
    // The machine holds this list, so it stays on show.
    expect(serviceLoadView(swapped.state)).toEqual({ status: "ready", busy: true, value: ["supermemory"] })
    expect(transitionServiceLoad(swapped.state, { type: "load.succeeded", attempt: 2, value: [] }).state).toBe(
      swapped.state,
    )

    // A list that lives in the store is the old store's, so it goes.
    const forgotten = transitionServiceLoad(loading.state, {
      type: "context.changed",
      shown: true,
      source: restarted,
      cached: undefined,
      retain: false,
    })

    expect(serviceLoadView(forgotten.state)).toEqual({ status: "loading", busy: true, value: undefined })
  })

  test("disposal aborts the running load and ignores everything after", () => {
    const disposed = replay([shown(), { type: "disposed" }])

    expect(disposed).toEqual({ state: { status: "disposed" }, effects: [{ type: "abort", attempt: 1 }] })

    for (const event of [
      { type: "load.succeeded", attempt: 1, value: [] },
      { type: "refresh.requested" },
      { type: "invalidated" },
      shown(),
    ] satisfies ServiceLoadEvent<List>[])
      expect(transitionServiceLoad(disposed.state, event).state).toBe(disposed.state)

    expect(replay([...loaded, { type: "disposed" }]).effects).toEqual([])
  })
})
