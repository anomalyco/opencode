import { describe, expect, test } from "bun:test"
import type { PromptProject } from "@/new-session/project/selector"
import {
  createLocationDialogState,
  locationDialogView,
  projectEntryID,
  transitionLocationDialog,
  type LocationDialogEvent,
  type LocationDialogState,
  type LocationDialogTransition,
  type LocationEntry,
} from "./machine"

const apollo = { key: "http://apollo.test:4096", name: "apollo", kind: "remote" } as const

const opencode: PromptProject = { id: "proj_opencode", worktree: "/home/dax/opencode", vcs: "git", server: apollo }

const sst: PromptProject = { id: "proj_sst", worktree: "/home/dax/sst", vcs: "git", server: apollo }

const add: LocationEntry = { id: "add", type: "add" }

const other: LocationEntry = { id: "other", type: "other" }

const query = (value: string): LocationDialogEvent => ({ type: "query.changed", query: value })

const openProject = (active: string | undefined): Extract<LocationDialogEvent, { type: "chosen" }> => ({
  type: "chosen",
  entry: add,
  active,
  choosesServer: true,
})

const key = (
  name: string,
  input: Partial<Extract<LocationDialogEvent, { type: "key.down" }>> = {},
): LocationDialogEvent => ({
  type: "key.down",
  key: name,
  direction: "ltr",
  atStart: true,
  atEnd: true,
  active: undefined,
  choosesServer: true,
  drillable: false,
  ...input,
})

function run(events: LocationDialogEvent[], state: LocationDialogState = createLocationDialogState()) {
  const initial: LocationDialogTransition = { state, effects: [], handled: false, stop: false }

  return events.reduce((acc, event) => transitionLocationDialog(acc.state, event), initial)
}

const back: LocationDialogEvent = { type: "back" }

describe("location dialog steps", () => {
  // Mod+O used to save the worktree search as the projects search and drop the worktree step on the way back.
  test("Open project from a worktree step steps back through the worktree step, then the projects", () => {
    const servers = run([query("open"), { type: "drilled", project: opencode }, query("feat"), openProject("create")])
    expect(servers.state).toMatchObject({ type: "servers", query: "" })

    const worktrees = transitionLocationDialog(servers.state, back)
    expect(worktrees.state).toMatchObject({ type: "worktrees", project: opencode, direct: false, query: "feat" })
    expect(worktrees.effects).toEqual([{ type: "focus", active: "create" }])

    const projects = transitionLocationDialog(worktrees.state, back)
    expect(projects.state).toEqual({ type: "projects", query: "open", history: [] })
    expect(projects.effects).toEqual([{ type: "focus", active: projectEntryID(opencode) }])
  })

  // Pressing Mod+O again on the server step used to wipe its search and its way back.
  test("Open project on the server step keeps its search and history", () => {
    const servers = run([openProject("add"), query("apo")])
    const next = transitionLocationDialog(servers.state, openProject(undefined))
    expect(next.state).toBe(servers.state)
    expect(next.effects).toEqual([])
  })

  // Stepping back from the server step used to land on Other projects with "add" active, a row that step lacks.
  test("Open project from Other projects returns to it with its own active row", () => {
    const servers = run([
      { type: "chosen", entry: other, active: "other", choosesServer: true },
      query("sst"),
      openProject(projectEntryID(sst)),
    ])

    expect(servers.state.type).toBe("servers")

    const others = transitionLocationDialog(servers.state, back)
    expect(others.state).toMatchObject({ type: "others", query: "sst" })
    expect(others.effects).toEqual([{ type: "focus", active: projectEntryID(sst) }])

    const projects = transitionLocationDialog(others.state, back)
    expect(projects.state).toEqual({ type: "projects", query: "", history: [] })
    expect(projects.effects).toEqual([{ type: "focus", active: "other" }])
  })

  test("a dialog opened on a worktree step closes on Escape and steps back on Backspace", () => {
    const direct = createLocationDialogState(opencode)
    expect(locationDialogView(direct).drilled).toBe(opencode)

    const escape = transitionLocationDialog(direct, key("Escape"))
    expect(escape).toMatchObject({ state: direct, effects: [{ type: "close" }], handled: true, stop: true })

    for (const event of [key("Backspace"), key("ArrowLeft"), back]) {
      const next = transitionLocationDialog(direct, event)
      expect(next.state).toEqual({ type: "projects", query: "", history: [] })
      expect(next.effects).toEqual([{ type: "focus", active: projectEntryID(opencode) }])
    }
  })

  test("a typed worktree search keeps Backspace for the input", () => {
    const state = transitionLocationDialog(createLocationDialogState(opencode), query("feat")).state
    expect(transitionLocationDialog(state, key("Backspace"))).toEqual({
      state,
      effects: [],
      handled: false,
      stop: false,
    })
  })

  test.each([
    ["ltr", "ArrowRight", "ArrowLeft"],
    ["rtl", "ArrowLeft", "ArrowRight"],
  ] as const)("%s arrows drill forward and step back", (direction, forward, backward) => {
    const active: LocationEntry = { id: projectEntryID(sst), type: "project", project: sst }

    const drilled = transitionLocationDialog(
      createLocationDialogState(),
      key(forward, { direction, active, drillable: true }),
    )

    expect(drilled).toMatchObject({ state: { type: "worktrees", project: sst }, handled: true, stop: false })

    // The opposite arrow is the input's to move the caret.
    const caret = transitionLocationDialog(createLocationDialogState(), key(backward, { direction, active }))
    expect(caret.handled).toBe(false)

    const back = transitionLocationDialog(drilled.state, key(backward, { direction }))
    expect(back).toMatchObject({ state: { type: "projects" }, handled: true, stop: true })
  })

  test("the projects step leaves Escape and plain keys to the dialog and the list", () => {
    const state = createLocationDialogState()

    for (const name of ["Escape", "Backspace", "ArrowDown", "Enter"])
      expect(transitionLocationDialog(state, key(name))).toEqual({ state, effects: [], handled: false, stop: false })
  })

  test("choosing a row selects it without leaving the step", () => {
    const state = createLocationDialogState(opencode)
    expect(
      transitionLocationDialog(state, {
        type: "chosen",
        entry: { id: "create", type: "workspace", project: opencode, value: "create", directory: opencode.worktree },
        active: "create",
        choosesServer: true,
      }),
    ).toMatchObject({ state, effects: [{ type: "workspace.select", project: opencode, value: "create" }] })

    expect(
      transitionLocationDialog(createLocationDialogState(), { ...openProject("add"), choosesServer: false }),
    ).toMatchObject({ effects: [{ type: "project.add" }] })
  })

  test("an unchanged query and a back with nowhere to go keep the state", () => {
    const state = createLocationDialogState()
    expect(transitionLocationDialog(state, query("")).state).toBe(state)
    expect(transitionLocationDialog(state, back).state).toBe(state)
  })
})
