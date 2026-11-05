import { describe, expect, test } from "bun:test"
import { createMenuRouterState, transitionMenuRouter, type MenuRouterEvent, type MenuRouterState } from "./menu-machine"

function replay(events: readonly MenuRouterEvent[], from: MenuRouterState = createMenuRouterState()) {
  return events.reduce<{ state: MenuRouterState; triggered: string[] }>(
    (result, event) => {
      const next = transitionMenuRouter(result.state, event)

      const triggered = next.commands.flatMap((command) =>
        command.ids.map((id) => `${command.handler === first ? "first" : "second"} ${id}`),
      )

      return { state: next.state, triggered: [...result.triggered, ...triggered] }
    },
    { state: from, triggered: [] },
  )
}

const first = (_id: string) => {}

const second = (_id: string) => {}

describe("renderer menu command routing", () => {
  test("commands chosen during the startup splash run in order once the app interface binds", () => {
    // On dev nothing was bound yet, so Settings and New Session were dropped.
    expect(
      replay([
        { type: "command.received", id: "settings.open" },
        { type: "command.received", id: "tab.new" },
        { type: "bound", handler: first },
        { type: "command.received", id: "logs.export" },
      ]).triggered,
    ).toEqual(["first settings.open", "first tab.new", "first logs.export"])
  })

  test("an unmounted interface no longer receives commands, and a stale unbind keeps the next one bound", () => {
    // On dev the disposed interface's command context kept receiving them.
    expect(
      replay([
        { type: "bound", handler: first },
        { type: "unbound", handler: first },
        { type: "command.received", id: "tab.new" },
        { type: "bound", handler: second },
        { type: "unbound", handler: first },
        { type: "command.received", id: "settings.open" },
      ]).triggered,
    ).toEqual(["second tab.new", "second settings.open"])
  })

  test("binding the same handler again changes nothing", () => {
    const bound = transitionMenuRouter(createMenuRouterState(), { type: "bound", handler: first }).state
    expect(transitionMenuRouter(bound, { type: "bound", handler: first })).toEqual({ state: bound, commands: [] })
  })
})
