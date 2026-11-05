import { describe, expect, test } from "bun:test"
import {
  createMainPaneState,
  isLoadingPaneAttempt,
  selectPane,
  transitionMainPane,
  type MainPaneEvent,
  type MainPaneState,
  type MainPaneTransition,
} from "./main-machine"

type Pane = { readonly id: string }

const replay = (events: readonly MainPaneEvent<Pane>[], state: MainPaneState<Pane> = createMainPaneState<Pane>()) =>
  events.reduce<MainPaneTransition<Pane>>((last, event) => transitionMainPane(last.state, event), {
    state,
    effects: [],
  })

const pane = { id: "pane" }

describe("a load that fails", () => {
  test("lets the next register load again instead of rejecting forever", () => {
    const failed = replay([
      { type: "load.requested" },
      { type: "load.failed", attempt: 1, cause: new Error("import failed") },
    ])

    expect(failed.effects).toEqual([{ type: "reject-load", attempt: 1, cause: new Error("import failed") }])
    expect(selectPane(failed.state)).toEqual({ kind: "unavailable" })

    const retried = transitionMainPane(failed.state, { type: "load.requested" })
    expect(retried.effects).toEqual([{ type: "load-pane", attempt: 2 }])

    const loaded = transitionMainPane(retried.state, { type: "load.succeeded", attempt: 2, pane })
    expect(selectPane(loaded.state)).toEqual({ kind: "ready", pane })
  })

  test("leaves cleanup nothing to dispose, so it never throws the load's error again", () => {
    const disposed = replay([
      { type: "load.requested" },
      { type: "load.failed", attempt: 1, cause: new Error("import failed") },
      { type: "disposed" },
    ])

    expect(disposed.state).toEqual({ status: "disposed" })
    expect(disposed.effects).toEqual([])
  })
})

test("registers that arrive while the pane loads share one load", () => {
  const first = transitionMainPane(createMainPaneState<Pane>(), { type: "load.requested" })
  const second = transitionMainPane(first.state, { type: "load.requested" })

  expect(first.effects).toEqual([{ type: "load-pane", attempt: 1 }])
  expect(second.state).toBe(first.state)
  expect(second.effects).toEqual([])
  expect(selectPane(second.state)).toEqual({ kind: "pending", attempt: 1 })
})

describe("cleanup while the pane loads", () => {
  test("rejects the waiting registers and creates no pane", () => {
    const disposed = replay([{ type: "load.requested" }, { type: "disposed" }])

    expect(disposed.effects).toEqual([
      { type: "reject-load", attempt: 1, cause: new Error("browser.pane.unavailable") },
    ])
    expect(isLoadingPaneAttempt(disposed.state, 1)).toBe(false)
    expect(selectPane(disposed.state)).toEqual({ kind: "unavailable" })
  })

  test("disposes a pane that still arrives", () => {
    const late = replay([
      { type: "load.requested" },
      { type: "disposed" },
      { type: "load.succeeded", attempt: 1, pane },
    ])

    expect(late.state).toEqual({ status: "disposed" })
    expect(late.effects).toEqual([{ type: "dispose-pane", pane }])
  })
})

test("cleanup disposes a loaded pane once", () => {
  const disposed = replay([
    { type: "load.requested" },
    { type: "load.succeeded", attempt: 1, pane },
    { type: "disposed" },
  ])

  expect(disposed.effects).toEqual([{ type: "dispose-pane", pane }])
  expect(transitionMainPane(disposed.state, { type: "disposed" }).effects).toEqual([])
})

test("ignores a failure of an attempt that is no longer current", () => {
  const loaded = replay([{ type: "load.requested" }, { type: "load.succeeded", attempt: 1, pane }])
  const stale = transitionMainPane(loaded.state, { type: "load.failed", attempt: 1, cause: new Error("late") })

  expect(stale.state).toBe(loaded.state)
  expect(stale.effects).toEqual([])
})
