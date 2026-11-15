import { describe, expect, test } from "bun:test"
import {
  AIM_TIMEOUT_MS,
  flyoutActive,
  flyoutPane,
  initialFlyoutState,
  transitionFlyout,
  type FlyoutAnchor,
  type FlyoutEvent,
  type FlyoutState,
  type FlyoutTransition,
} from "./flyout-machine"

const mcpRow: FlyoutAnchor = { row: 40, above: 100, below: 600 }

const pluginsRow: FlyoutAnchor = { row: 72, above: 100, below: 600 }

// Folds the events in order and returns the last transition.
const replay = (events: readonly FlyoutEvent[], state: FlyoutState = initialFlyoutState) =>
  events.reduce<FlyoutTransition>((last, event) => transitionFlyout(last.state, event), { state, effects: [] })

const enterMcp: FlyoutEvent = { type: "row.entered", service: "mcp", shown: true, anchor: mcpRow }

const aimPlugins: FlyoutEvent = { type: "row.moved", service: "plugins", aiming: true, anchor: undefined }

describe("transitionFlyout", () => {
  test("a row that cannot be measured leaves the flyout closed, so the next open still snaps and refreshes", () => {
    const failed = transitionFlyout(initialFlyoutState, { ...enterMcp, anchor: undefined })

    expect(failed.state).toBe(initialFlyoutState)
    expect(failed.effects).toEqual([])

    const opened = transitionFlyout(failed.state, enterMcp)

    expect(opened.state).toEqual({ status: "open", service: "mcp", anchor: mcpRow, refreshed: ["mcp"], issued: 0 })
    expect(opened.effects).toEqual([{ type: "refresh", service: "mcp" }, { type: "snap-open" }])

    // A later switch glides: it does not snap again.
    const switched = transitionFlyout(opened.state, {
      type: "row.moved",
      service: "plugins",
      aiming: false,
      anchor: pluginsRow,
    })

    expect(switched.state).toMatchObject({ status: "open", service: "plugins", refreshed: ["mcp", "plugins"] })
    expect(switched.effects).toEqual([{ type: "refresh", service: "plugins" }])
  })

  test("hiding the details cancels a pending aim, fences its timer and refreshes each list on the next open", () => {
    const aimed = replay([enterMcp, aimPlugins])

    expect(aimed.state).toMatchObject({ status: "aiming", service: "mcp", target: "plugins", attempt: 1 })
    expect(aimed.effects).toEqual([{ type: "schedule-aim", attempt: 1, target: "plugins", delayMs: AIM_TIMEOUT_MS }])

    const hidden = transitionFlyout(aimed.state, { type: "hidden" })

    expect(hidden.state).toEqual({ status: "closed", pane: "mcp", anchor: mcpRow, issued: 1 })
    expect(hidden.effects).toEqual([{ type: "cancel-aim" }])

    // The aim timer of before the hide cannot open the flyout.
    const late = transitionFlyout(hidden.state, { type: "aim.due", attempt: 1, anchor: pluginsRow })

    expect(late.state).toBe(hidden.state)
    expect(late.effects).toEqual([])

    const reopened = transitionFlyout(hidden.state, enterMcp)

    expect(reopened.effects).toEqual([{ type: "refresh", service: "mcp" }, { type: "snap-open" }])
  })

  test("a pointer resting inside the safe triangle hands over to the row it aimed across", () => {
    const aimed = replay([enterMcp, aimPlugins])
    const due = transitionFlyout(aimed.state, { type: "aim.due", attempt: 1, anchor: pluginsRow })

    expect(due.state).toEqual({
      status: "open",
      service: "plugins",
      anchor: pluginsRow,
      refreshed: ["mcp", "plugins"],
      issued: 1,
    })
    expect(flyoutActive(due.state)).toBe("plugins")
  })

  test("each move across the same row restarts the aim timer without replacing the state", () => {
    const aimed = replay([enterMcp, aimPlugins])
    const again = transitionFlyout(aimed.state, aimPlugins)

    expect(again.state).toBe(aimed.state)
    expect(again.effects).toEqual([{ type: "schedule-aim", attempt: 1, target: "plugins", delayMs: AIM_TIMEOUT_MS }])

    const other = transitionFlyout(aimed.state, { ...aimPlugins, service: "skills" })

    expect(other.state).toMatchObject({ status: "aiming", target: "skills", attempt: 2 })

    // The first target's timer is stale.
    const stale = transitionFlyout(other.state, { type: "aim.due", attempt: 1, anchor: pluginsRow })

    expect(stale.state).toBe(other.state)
  })

  test("leaving the rows or reaching the flyout keeps the list on show", () => {
    const aimed = replay([enterMcp, aimPlugins])

    for (const event of [
      { type: "aim.cancelled" },
      { type: "row.moved", service: "mcp", aiming: false, anchor: undefined },
      { type: "row.moved", service: undefined, aiming: false, anchor: undefined },
    ] satisfies FlyoutEvent[]) {
      const result = transitionFlyout(aimed.state, event)

      expect(result.state).toEqual({ status: "open", service: "mcp", anchor: mcpRow, refreshed: ["mcp"], issued: 1 })
      expect(result.effects).toEqual([{ type: "cancel-aim" }])
    }
  })

  test("pointer moves that change nothing keep the same state", () => {
    const opened = transitionFlyout(initialFlyoutState, enterMcp).state

    for (const event of [
      { type: "row.moved", service: "mcp", aiming: false, anchor: undefined },
      { type: "row.moved", service: undefined, aiming: false, anchor: undefined },
      { type: "aim.cancelled" },
      { type: "row.entered", service: "plugins", shown: true, anchor: pluginsRow },
      { type: "remeasured", anchor: { ...mcpRow } },
      { type: "remeasured", anchor: undefined },
      { type: "aim.due", attempt: 7, anchor: pluginsRow },
    ] satisfies FlyoutEvent[])
      expect(transitionFlyout(opened, event)).toEqual({ state: opened, effects: [] })

    for (const event of [
      { type: "row.moved", service: "plugins", aiming: false, anchor: pluginsRow },
      { type: "aim.cancelled" },
      { type: "close", focusRow: true },
      { type: "hidden" },
    ] satisfies FlyoutEvent[])
      expect(transitionFlyout(initialFlyoutState, event).state).toBe(initialFlyoutState)
  })

  test("a row that cannot be measured during a switch keeps the current list", () => {
    const opened = transitionFlyout(initialFlyoutState, enterMcp).state
    const moved = transitionFlyout(opened, { type: "row.moved", service: "plugins", aiming: false, anchor: undefined })

    expect(moved.state).toBe(opened)

    const clicked = transitionFlyout(opened, {
      type: "row.activated",
      service: "plugins",
      focus: false,
      shown: true,
      anchor: undefined,
    })

    expect(clicked.state).toBe(opened)
  })

  test("activating a row by keyboard opens it and moves focus into its list", () => {
    const result = transitionFlyout(initialFlyoutState, {
      type: "row.activated",
      service: "skills",
      focus: true,
      shown: true,
      anchor: mcpRow,
    })

    expect(result.effects).toEqual([
      { type: "refresh", service: "skills" },
      { type: "snap-open" },
      { type: "focus-pane", service: "skills" },
    ])

    // Activating it again only moves focus: the list already refreshed.
    const again = transitionFlyout(result.state, {
      type: "row.activated",
      service: "skills",
      focus: true,
      shown: true,
      anchor: mcpRow,
    })

    expect(again.state).toBe(result.state)
    expect(again.effects).toEqual([{ type: "focus-pane", service: "skills" }])
  })

  test("rows of hidden details do not open the flyout", () => {
    const result = transitionFlyout(initialFlyoutState, { ...enterMcp, shown: false })

    expect(result.state).toBe(initialFlyoutState)
  })

  test("closing keeps the pane for the exit fade and returns focus to the row only when asked", () => {
    const opened = transitionFlyout(initialFlyoutState, enterMcp).state
    const back = transitionFlyout(opened, { type: "close", focusRow: true })

    expect(back.state).toEqual({ status: "closed", pane: "mcp", anchor: mcpRow, issued: 0 })
    expect(back.effects).toEqual([{ type: "focus-row", service: "mcp" }])
    expect(flyoutActive(back.state)).toBeUndefined()
    expect(flyoutPane(back.state)).toBe("mcp")
    expect(transitionFlyout(opened, { type: "close", focusRow: false }).effects).toEqual([])
  })

  test("scrolling moves the anchor of the open list", () => {
    const opened = transitionFlyout(initialFlyoutState, enterMcp).state
    const moved = transitionFlyout(opened, { type: "remeasured", anchor: pluginsRow })

    expect(moved.state).toMatchObject({ status: "open", service: "mcp", anchor: pluginsRow })
  })

  test("disposal cancels a pending aim and ignores everything after", () => {
    const aimed = replay([enterMcp, aimPlugins])
    const disposed = transitionFlyout(aimed.state, { type: "disposed" })

    expect(disposed).toEqual({ state: { status: "disposed" }, effects: [{ type: "cancel-aim" }] })
    expect(transitionFlyout(disposed.state, enterMcp).state).toBe(disposed.state)
    expect(transitionFlyout(initialFlyoutState, { type: "disposed" }).effects).toEqual([])
  })
})
