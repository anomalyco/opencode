import { describe, expect, test } from "bun:test"
import {
  canReturnToSearchOrigin,
  createSettingsSearchState,
  isSearchActive,
  selectSearchQuery,
  selectSearchSelected,
  transitionSettingsSearch,
  type SettingsSearchEvent,
  type SettingsSearchState,
} from "./search-machine"
import type { SettingsView } from "./route"

const appearance: SettingsView = { type: "root", tab: "appearance" }

const projects: SettingsView = { type: "root", tab: "projects", server: "local" }

const project: SettingsView = { type: "project", server: "local", project: "/repo", tab: "general" }

const projectName: SettingsView = { ...project, target: "project-name" }

function run(events: readonly SettingsSearchEvent[], state = createSettingsSearchState()) {
  return events.reduce<{ state: SettingsSearchState; effects: unknown[] }>(
    (current, event) => {
      const next = transitionSettingsSearch(current.state, event)

      return { state: next.state, effects: [...next.effects] }
    },
    { state, effects: [] },
  )
}

// The route the driver shows for an activation's navigate effect.
function routed(view: SettingsView, activation: number): SettingsView {
  return { ...view, searchActivation: activation }
}

describe("settings search machine", () => {
  test("a page reached from an opened result through the page itself keeps its own way back", () => {
    const opened = run([
      { type: "input.changed", query: "Projects", view: appearance },
      { type: "result.opened", id: "projects", destination: projects },
      { type: "view.synced", view: routed(projects, 1) },
    ])

    // A project card on the Projects page opens the project without a search activation.
    const next = run([{ type: "view.synced", view: project }], opened.state)

    expect(next.state.status).toBe("browsing")
    expect(selectSearchSelected(next.state)).toBeUndefined()
    expect(canReturnToSearchOrigin(next.state, project)).toBe(false)
    expect(transitionSettingsSearch(next.state, { type: "back.requested", view: project }).state).toBe(next.state)
    expect(transitionSettingsSearch(next.state, { type: "escape.pressed", view: project }).effects).toEqual([
      { type: "exit" },
    ])
  })

  test("a history entry from an earlier activation ends the current one", () => {
    const opened = run([
      { type: "input.changed", query: "name", view: appearance },
      { type: "result.opened", id: "one", destination: project },
      { type: "view.synced", view: routed(project, 1) },
      { type: "result.opened", id: "two", destination: projectName },
      { type: "view.synced", view: routed(projectName, 2) },
    ])

    expect(canReturnToSearchOrigin(opened.state, routed(projectName, 2))).toBe(true)

    const next = run([{ type: "view.synced", view: routed(project, 1) }], opened.state)
    expect(next.state.status).toBe("browsing")
    expect(selectSearchSelected(next.state)).toBeUndefined()
    expect(canReturnToSearchOrigin(next.state, routed(project, 1))).toBe(false)
    expect(next.effects).toEqual([{ type: "reveal.cancel" }])
  })

  test("a Command Palette jump reveals its target without a sidebar search or a way back", () => {
    const opened = run([{ type: "palette.opened", destination: projectName }])
    expect(opened.state.status).toBe("revealing")
    expect(opened.effects).toEqual([{ type: "navigate", view: routed(projectName, 1) }])
    expect(selectSearchQuery(opened.state)).toBe("")
    expect(isSearchActive(opened.state)).toBe(false)
    expect(canReturnToSearchOrigin(opened.state, routed(projectName, 1))).toBe(false)

    const shown = run([{ type: "view.synced", view: routed(projectName, 1) }], opened.state)
    expect(shown.effects).toEqual([
      { type: "reveal.start", activation: 1, view: routed(projectName, 1), timeoutMs: 5_000 },
    ])
    const done = run([{ type: "reveal.completed", activation: 1 }], shown.state)
    expect(done.state).toEqual({ status: "idle", query: "", activation: 1 })
    expect(done.effects).toEqual([{ type: "reveal.cancel" }])
  })

  test("Escape on a project page leaves it instead of clearing the hidden root search", () => {
    const browsing = run([{ type: "input.changed", query: "theme", view: appearance }])
    const next = transitionSettingsSearch(browsing.state, { type: "escape.pressed", view: project })

    expect(next.state).toBe(browsing.state)
    expect(next.effects).toEqual([{ type: "exit" }])
    // On a root page the search is visible, so Escape clears it first.
    expect(transitionSettingsSearch(browsing.state, { type: "escape.pressed", view: appearance }).state).toEqual({
      status: "idle",
      query: "",
      activation: 0,
    })
  })

  test("Back and Escape from an opened project return to the search origin with the result highlighted", () => {
    const opened = run([
      { type: "input.changed", query: "name", view: { ...appearance, target: "font" } },
      { type: "scrolled", scrollTop: 120 },
      { type: "result.opened", id: "name", destination: projectName },
      { type: "view.synced", view: routed(projectName, 1) },
    ])

    for (const type of ["back.requested", "escape.pressed"] as const) {
      const next = transitionSettingsSearch(opened.state, { type, view: routed(projectName, 1) })
      expect(next.state).toEqual({
        status: "browsing",
        query: "name",
        origin: appearance,
        highlighted: "name",
        scrollTop: 120,
        expanded: true,
        activation: 1,
      })
      expect(next.effects).toEqual([
        { type: "reveal.cancel" },
        { type: "navigate", view: { ...appearance, target: undefined, searchActivation: undefined } },
      ])
    }
  })

  test("a reveal waits for the route, times out while seeking, and settles after its highlight", () => {
    const opened = run([
      { type: "input.changed", query: "font", view: appearance },
      { type: "result.opened", id: "font", destination: { ...appearance, target: "font" } },
    ])

    // The route still shows the previous view while the navigation commits.
    expect(transitionSettingsSearch(opened.state, { type: "reveal.timed-out", activation: 1 }).state).toBe(opened.state)

    const seeking = run([{ type: "view.synced", view: routed({ ...appearance, target: "font" }, 1) }], opened.state)
    const timedOut = run([{ type: "reveal.timed-out", activation: 1 }], seeking.state)
    expect(timedOut.state).toMatchObject({ status: "opened", reveal: { phase: "done" } })
    expect(timedOut.effects).toEqual([{ type: "reveal.cancel" }])

    const highlighted = run([{ type: "reveal.highlighted", activation: 1 }], seeking.state)
    expect(highlighted.effects).toEqual([{ type: "reveal.highlight", activation: 1, timeoutMs: 2_500 }])
    const done = run([{ type: "reveal.timed-out", activation: 1 }], highlighted.state)
    expect(done.state).toMatchObject({ status: "opened", selected: "font", reveal: { phase: "done" } })

    // Later views with the same activation, such as a subtab change, do not reveal again.
    expect(transitionSettingsSearch(done.state, { type: "view.synced", view: routed(appearance, 1) }).state).toBe(
      done.state,
    )
  })

  test("results from an earlier activation are ignored", () => {
    const second = run([
      { type: "input.changed", query: "font", view: appearance },
      { type: "result.opened", id: "one", destination: appearance },
      { type: "view.synced", view: routed(appearance, 1) },
      { type: "result.opened", id: "two", destination: { ...appearance, target: "font" } },
      { type: "view.synced", view: routed({ ...appearance, target: "font" }, 2) },
    ])

    for (const event of [
      { type: "reveal.highlighted", activation: 1 },
      { type: "reveal.completed", activation: 1 },
      { type: "reveal.timed-out", activation: 1 },
    ] as const) {
      const next = transitionSettingsSearch(second.state, event)
      expect(next.state).toBe(second.state)
      expect(next.effects).toEqual([])
    }
  })

  test("opening another result cancels the running reveal before navigating", () => {
    const seeking = run([
      { type: "input.changed", query: "font", view: appearance },
      { type: "result.opened", id: "one", destination: appearance },
      { type: "view.synced", view: routed(appearance, 1) },
    ])

    const next = transitionSettingsSearch(seeking.state, {
      type: "result.opened",
      id: "two",
      destination: projects,
    })

    expect(next.effects).toEqual([{ type: "reveal.cancel" }, { type: "navigate", view: routed(projects, 2) }])
  })

  test("closing Settings or unmounting the screen stops a running reveal", () => {
    const seeking = run([
      { type: "palette.opened", destination: projectName },
      { type: "view.synced", view: routed(projectName, 1) },
    ])

    const closed = run([{ type: "settings.closed" }], seeking.state)
    expect(closed.state).toEqual({ status: "idle", query: "", activation: 1 })
    expect(closed.effects).toEqual([{ type: "reveal.cancel" }])

    const unmounted = run([{ type: "screen.unmounted" }], seeking.state)
    expect(unmounted.state).toMatchObject({ status: "revealing", reveal: { phase: "navigating" } })
    expect(unmounted.effects).toEqual([{ type: "reveal.cancel" }])
    // A remounted screen starts the reveal again.
    expect(run([{ type: "view.synced", view: routed(projectName, 1) }], unmounted.state).effects).toEqual([
      { type: "reveal.start", activation: 1, view: routed(projectName, 1), timeoutMs: 5_000 },
    ])
  })

  test("typing keeps an opened result; clearing ends the search and its reveal", () => {
    const opened = run([
      { type: "input.changed", query: "font", view: appearance },
      { type: "result.opened", id: "font", destination: { ...appearance, target: "font" } },
      { type: "view.synced", view: routed({ ...appearance, target: "font" }, 1) },
    ])

    const typed = run([{ type: "input.changed", query: "fonts", view: routed(appearance, 1) }], opened.state)
    expect(typed.state).toMatchObject({ status: "opened", selected: "font", query: "fonts", expanded: true })
    expect(typed.effects).toEqual([])

    for (const event of [{ type: "input.changed", query: " ", view: appearance }, { type: "cleared" }] as const) {
      const next = transitionSettingsSearch(opened.state, event)
      expect(next.state.status).toBe("idle")
      expect(next.effects).toEqual([{ type: "reveal.cancel" }])
    }
  })

  test("events that do not apply return the same state", () => {
    const idle = createSettingsSearchState()

    for (const event of [
      { type: "expanded" },
      { type: "highlighted", id: "x" },
      { type: "scrolled", scrollTop: 10 },
      { type: "result.opened", id: "x", destination: appearance },
      { type: "back.requested", view: project },
      { type: "cleared" },
      { type: "view.synced", view: project },
      { type: "screen.unmounted" },
      { type: "settings.closed" },
      { type: "input.changed", query: "", view: appearance },
    ] as const) {
      expect(transitionSettingsSearch(idle, event).state).toBe(idle)
    }
  })
})
