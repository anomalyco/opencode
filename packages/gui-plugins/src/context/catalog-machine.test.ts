import { describe, expect, test } from "bun:test"
import {
  createCatalogState,
  transitionCatalog,
  type CatalogEffect,
  type CatalogEvent,
  type CatalogState,
} from "./catalog-machine"

type Data = { readonly server: string }

const server: Data = { server: "a" }

const repo = { data: server, directory: "/repo" }

// Replays events through the pure machine and collects every effect it asked for, in order.
function play(state: CatalogState<Data>, ...events: CatalogEvent<Data>[]) {
  return events.reduce<{ state: CatalogState<Data>; effects: readonly CatalogEffect<Data>[] }>(
    (result, event) => {
      const next = transitionCatalog(result.state, event)

      return { state: next.state, effects: [...result.effects, ...next.effects] }
    },
    { state, effects: [] },
  )
}

function loads(effects: readonly CatalogEffect<Data>[]) {
  return effects.flatMap((effect) => (effect.type === "load" ? [`${effect.attempt}:${effect.target.directory}`] : []))
}

function phase(state: CatalogState<Data>) {
  return state.status === "open" ? state.phase.kind : state.status
}

describe("catalog sync", () => {
  test("a cold Location's 503 retries with backoff until the catalog loads", () => {
    const failed = play(
      createCatalogState(),
      { type: "input.changed", active: true, target: repo },
      { type: "load.failed", attempt: 1, retryable: true },
    )

    expect(phase(failed.state)).toBe("retrying")
    expect(failed.effects.at(-1)).toEqual({ type: "schedule-retry", attempt: 2, delay: 1_000 })

    const loaded = play(failed.state, { type: "retry.due", attempt: 2 }, { type: "load.succeeded", attempt: 2 })

    expect(loads(loaded.effects)).toEqual(["2:/repo"])
    expect(phase(loaded.state)).toBe("loaded")
  })

  test("backoff doubles up to 5 s and gives up after 12 tries", () => {
    const events = Array.from({ length: 11 }, (_, index): CatalogEvent<Data>[] => [
      { type: "load.failed", attempt: index + 1, retryable: true },
      { type: "retry.due", attempt: index + 2 },
    ]).flat()

    const result = play(createCatalogState(), { type: "input.changed", active: true, target: repo }, ...events)

    expect(
      result.effects.flatMap((effect) => (effect.type === "schedule-retry" ? [effect.delay] : [])).slice(0, 5),
    ).toEqual([1_000, 2_000, 4_000, 5_000, 5_000])
    expect(loads(result.effects)).toHaveLength(12)

    const last = play(result.state, { type: "load.failed", attempt: 12, retryable: true })

    expect(phase(last.state)).toBe("failed")
    expect(last.effects).toEqual([])
  })

  test("a failed catalog loads again when the view is selected again or the user asks", () => {
    const failed = play(
      createCatalogState(),
      { type: "input.changed", active: true, target: repo },
      { type: "load.failed", attempt: 1, retryable: false },
    )

    expect(phase(failed.state)).toBe("failed")

    // Before, the frozen target kept its change number and nothing ever loaded again.
    const reselected = play(
      failed.state,
      { type: "input.changed", active: false, target: repo },
      { type: "input.changed", active: true, target: repo },
    )

    expect(loads(reselected.effects)).toEqual(["2:/repo"])

    const retried = play(failed.state, { type: "retry.requested" })

    expect(loads(retried.effects)).toEqual(["2:/repo"])
    expect(play(retried.state, { type: "retry.requested" }).state).toBe(retried.state)
  })

  test("a superseded target cancels its load and ignores the late result", () => {
    const moved = play(
      createCatalogState(),
      { type: "input.changed", active: true, target: { data: server, directory: "" } },
      { type: "input.changed", active: true, target: { data: server, directory: "/wt" } },
    )

    expect(moved.effects).toEqual([
      { type: "load", attempt: 1, target: { data: server, directory: "" } },
      { type: "cancel", attempt: 1 },
      { type: "load", attempt: 2, target: { data: server, directory: "/wt" } },
    ])
    expect(play(moved.state, { type: "load.succeeded", attempt: 1 }).state).toBe(moved.state)
  })

  test("a detached view keeps its catalog and loads a reconnect only once selected again", () => {
    const loaded = play(
      createCatalogState(),
      { type: "input.changed", active: true, target: repo },
      { type: "load.succeeded", attempt: 1 },
    )

    const toggled = play(
      loaded.state,
      { type: "input.changed", active: false, target: repo },
      { type: "input.changed", active: true, target: repo },
    )

    expect(toggled.effects).toEqual([])

    const reconnected = play(
      toggled.state,
      { type: "input.changed", active: false, target: repo },
      { type: "input.changed", active: false, target: undefined },
      { type: "input.changed", active: false, target: repo },
    )

    expect(reconnected.effects).toEqual([])

    expect(loads(play(reconnected.state, { type: "input.changed", active: true, target: repo }).effects)).toEqual([
      "2:/repo",
    ])
  })

  test("detaching stops a pending retry, and a disconnect cancels a load", () => {
    const retrying = play(
      createCatalogState(),
      { type: "input.changed", active: true, target: repo },
      { type: "load.failed", attempt: 1, retryable: true },
    )

    const detached = play(retrying.state, { type: "input.changed", active: false, target: repo })

    expect(detached.effects).toEqual([{ type: "cancel", attempt: 2 }])
    expect(phase(detached.state)).toBe("failed")
    expect(play(detached.state, { type: "retry.due", attempt: 2 }).state).toBe(detached.state)

    const disconnected = play(
      createCatalogState(),
      { type: "input.changed", active: true, target: repo },
      { type: "input.changed", active: true, target: undefined },
    )

    expect(disconnected.effects.at(-1)).toEqual({ type: "cancel", attempt: 1 })
    expect(phase(disconnected.state)).toBe("idle")
  })

  test("a hung load fails without retrying, since the data layer would join it", () => {
    const timed = play(
      createCatalogState(),
      { type: "input.changed", active: true, target: repo },
      { type: "load.timed-out", attempt: 1 },
    )

    expect(phase(timed.state)).toBe("failed")
    expect(timed.effects).toEqual([{ type: "load", attempt: 1, target: repo }])
  })

  test("disposing cancels the load in flight and ignores everything after", () => {
    const disposed = play(
      createCatalogState(),
      { type: "input.changed", active: true, target: repo },
      { type: "disposed" },
    )

    expect(disposed.effects.at(-1)).toEqual({ type: "cancel", attempt: 1 })
    expect(play(disposed.state, { type: "load.succeeded", attempt: 1 }).state).toBe(disposed.state)
    expect(play(disposed.state, { type: "input.changed", active: true, target: repo }).effects).toEqual([])
  })
})
