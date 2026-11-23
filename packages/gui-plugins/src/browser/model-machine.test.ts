import { describe, expect, test } from "bun:test"
import {
  createBrowserModelState,
  selectBrowserModel,
  selectBrowserModelError,
  selectBrowserTabHidden,
  transitionBrowserModel,
  type BrowserModelEffect,
  type BrowserModelEvent,
  type BrowserModelState,
} from "./model-machine"

type Model = { readonly name: string }

const replay = (events: readonly BrowserModelEvent<Model>[], state = createBrowserModelState<Model>()) =>
  events.reduce<{ state: BrowserModelState<Model>; effects: BrowserModelEffect[] }>(
    (last, event) => {
      const next = transitionBrowserModel(last.state, event)

      return { state: next.state, effects: [...last.effects, ...next.effects] }
    },
    { state, effects: [] },
  )

const known = () => true

describe("browser model machine", () => {
  // A model chunk that failed to load used to leave the panel blank, its stored tabs hidden and its commands disabled
  // for the rest of the run.
  test("a load that fails shows its error and the stored tabs, and a retry loads again", () => {
    const failed = replay([
      { type: "load.requested" },
      { type: "load.failed", attempt: 1, error: "chunk" },
      { type: "load.requested" },
    ])

    expect(selectBrowserModelError(failed.state)).toBe("chunk")
    expect(selectBrowserTabHidden(failed.state, known, false)).toBe(false)
    expect(failed.effects).toEqual([{ type: "load-model", attempt: 1 }])

    const retried = replay(
      [{ type: "retry.requested" }, { type: "load.succeeded", attempt: 2, model: { name: "m" } }],
      failed.state,
    )

    expect(retried.effects).toEqual([{ type: "load-model", attempt: 2 }])
    expect(selectBrowserModel(retried.state)).toEqual({ name: "m" })
    expect(selectBrowserTabHidden(retried.state, () => false, false)).toBe(true)
  })

  // After a restart the strip was empty until the model had loaded and the desktop had reported the tabs.
  test("stored tabs stay hidden while the model loads unless the last run saved them, and a second request loads once", () => {
    const loading = replay([{ type: "load.requested" }, { type: "load.requested" }, { type: "retry.requested" }])
    const loaded = replay([{ type: "load.succeeded", attempt: 1, model: { name: "m" } }], loading.state)

    expect(loading.effects).toEqual([{ type: "load-model", attempt: 1 }])
    expect(selectBrowserTabHidden(loading.state, known, false)).toBe(true)
    expect(selectBrowserTabHidden(createBrowserModelState<Model>(), known, true)).toBe(false)
    expect(selectBrowserTabHidden(loading.state, known, true)).toBe(false)
    expect(selectBrowserTabHidden(loaded.state, () => false, true)).toBe(false)
  })

  test("a load the plugin's cleanup or a newer attempt overtook settles nothing", () => {
    const disposed = replay([
      { type: "load.requested" },
      { type: "disposed" },
      { type: "load.succeeded", attempt: 1, model: { name: "late" } },
      { type: "retry.requested" },
    ])

    expect(disposed.state).toEqual({ status: "disposed" })

    const stale = replay([
      { type: "load.requested" },
      { type: "load.failed", attempt: 1, error: "chunk" },
      { type: "retry.requested" },
      { type: "load.failed", attempt: 1, error: "late" },
    ])

    expect(stale.state).toEqual({ status: "loading", attempt: 2 })
  })
})
