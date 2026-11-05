import { describe, expect, test } from "bun:test"
import { createMenuState, transitionMenu, type MenuEvent, type MenuState, type MenubarProvider } from "./menu-machine"

const deps = { name: "deps" }

const plugins: MenubarProvider = () => [
  { menu: "file", id: "plugin.item", label: "Plugin", enabled: () => true, run: () => {} },
]

function replay(events: readonly MenuEvent<typeof deps>[], from: MenuState<typeof deps> = createMenuState()) {
  return events.reduce<{ state: MenuState<typeof deps>; builds: number[] }>(
    (result, event) => {
      const next = transitionMenu(result.state, event)

      return { state: next.state, builds: [...result.builds, next.commands.length] }
    },
    { state: from, builds: [] },
  )
}

describe("native menu install", () => {
  test("a language change before the menu is installed builds nothing", () => {
    const initial = createMenuState<typeof deps>()

    // On dev the translation handler installed the menu itself, before main restored any window.
    expect(transitionMenu(initial, { type: "refreshed" })).toEqual({ state: initial, commands: [] })
  })

  test("plugin entries recorded before install are in the first build, and later changes rebuild", () => {
    const installed = transitionMenu(transitionMenu(createMenuState(), { type: "provider.changed", provider: plugins }).state, {
      type: "installed",
      deps,
    })
    expect(installed.commands).toEqual([{ type: "build", deps, provider: plugins }])

    expect(
      replay([{ type: "refreshed" }, { type: "provider.changed", provider: () => [] }, { type: "provider.changed", provider: plugins }], installed.state)
        .builds,
    ).toEqual([1, 1, 1])
  })

  test("a disposed menu keeps its contributions but no longer rebuilds", () => {
    const run = replay([
      { type: "installed", deps },
      { type: "disposed" },
      { type: "refreshed" },
      { type: "provider.changed", provider: plugins },
    ])
    expect(run.builds).toEqual([1, 0, 0, 0])
    expect(run.state).toEqual({ status: "uninstalled", provider: plugins })
  })
})
