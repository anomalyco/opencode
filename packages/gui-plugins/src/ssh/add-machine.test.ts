import { describe, expect, test } from "bun:test"
import { initialSshAdd, transitionSshAdd, type SshAddEffect, type SshAddEvent, type SshAddState } from "./add-machine"

type Module = { readonly name: string }

const replay = (events: readonly SshAddEvent<Module>[]) =>
  events.reduce<{ state: SshAddState; effects: SshAddEffect<Module>[] }>(
    (last, event) => {
      const next = transitionSshAdd(last.state, event)

      return { state: next.state, effects: [...last.effects, ...next.effects] }
    },
    { state: initialSshAdd, effects: [] },
  )

const module: Module = { name: "dialog" }

describe("ssh add dialog machine", () => {
  // A double click used to load the chunk twice and open two dialogs.
  test("a second click joins the dialog loading and opens one", () => {
    const result = replay([
      { type: "add.requested", openProject: false },
      { type: "add.requested", openProject: true },
      { type: "add.loaded", attempt: 1, module },
      { type: "add.loaded", attempt: 1, module },
    ])

    expect(result.effects).toEqual([
      { type: "load", attempt: 1 },
      { type: "open", module, openProject: true },
    ])
  })

  // A chunk that failed to load used to leave the click unanswered, with an unhandled rejection.
  test("a chunk that fails or stalls says so and the next click loads again", () => {
    const result = replay([
      { type: "add.requested", openProject: false },
      { type: "add.failed", attempt: 1, error: "chunk" },
      { type: "add.requested", openProject: false },
    ])

    expect(result.effects).toEqual([
      { type: "load", attempt: 1 },
      { type: "toast-failed", error: "chunk" },
      { type: "load", attempt: 2 },
    ])
  })

  test("a chunk that loads after the plugin went away opens nothing", () => {
    const result = replay([
      { type: "add.requested", openProject: false },
      { type: "disposed" },
      { type: "add.loaded", attempt: 1, module },
      { type: "add.requested", openProject: false },
    ])

    expect(result.state).toEqual({ status: "disposed" })
    expect(result.effects).toEqual([{ type: "load", attempt: 1 }])
  })
})
