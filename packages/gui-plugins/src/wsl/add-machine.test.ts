import { describe, expect, test } from "bun:test"
import { initialWslAdd, transitionWslAdd, type WslAddEffect, type WslAddEvent, type WslAddState } from "./add-machine"

type Module = { readonly name: string }

const replay = (events: readonly WslAddEvent<Module>[]) =>
  events.reduce<{ state: WslAddState; effects: WslAddEffect<Module>[] }>(
    (last, event) => {
      const next = transitionWslAdd(last.state, event)

      return { state: next.state, effects: [...last.effects, ...next.effects] }
    },
    { state: initialWslAdd, effects: [] },
  )

const module: Module = { name: "dialog" }

describe("wsl add dialog machine", () => {
  // A double click used to load the chunk twice and open two dialogs; a failed chunk left the click unanswered.
  test("a second click joins the dialog loading, and a failed load says so and lets the next click retry", () => {
    const result = replay([
      { type: "add.requested" },
      { type: "add.requested" },
      { type: "add.failed", attempt: 1, error: "chunk" },
      { type: "add.loaded", attempt: 1, module },
      { type: "add.requested" },
      { type: "add.loaded", attempt: 2, module },
    ])

    expect(result.effects).toEqual([
      { type: "load", attempt: 1 },
      { type: "toast-failed", error: "chunk" },
      { type: "load", attempt: 2 },
      { type: "open", module },
    ])
  })

  test("a chunk that loads after the plugin went away opens nothing", () => {
    const result = replay([{ type: "add.requested" }, { type: "disposed" }, { type: "add.loaded", attempt: 1, module }])

    expect(result.state).toEqual({ status: "disposed" })
    expect(result.effects).toEqual([{ type: "load", attempt: 1 }])
  })
})
