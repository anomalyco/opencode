import { describe, expect, test } from "bun:test"
import {
  selectSubmenuOpen,
  SUBMENU_CLOSED,
  SUBMENU_DISPOSED,
  SUBMENU_FOCUS_LEFT,
  SUBMENU_FOCUS_RETURNED,
  submenuLeaveElapsed,
  submenuRequested,
  transitionSubmenu,
  type SubmenuEvent,
  type SubmenuState,
} from "./submenu-machine"

const run = (state: SubmenuState, ...events: SubmenuEvent[]) => events.reduce(transitionSubmenu, state)

const FILE_OPEN = run(SUBMENU_CLOSED, submenuRequested("file", true))

describe("transitionSubmenu", () => {
  // #63095: hovering the next parent item closed the open submenu at once, so the menu showed none until it opened.
  test("a submenu stays open while focus crosses other items, until the next one replaces it", () => {
    const crossing = run(FILE_OPEN, SUBMENU_FOCUS_LEFT, SUBMENU_FOCUS_LEFT)

    expect(selectSubmenuOpen(crossing, "file")).toBe(true)

    const swapped = run(crossing, submenuRequested("edit", true))

    expect(selectSubmenuOpen(swapped, "edit")).toBe(true)
    expect(selectSubmenuOpen(swapped, "file")).toBe(false)
    expect(run(swapped, submenuLeaveElapsed(crossing))).toBe(swapped)
  })

  test("focus coming back to the trigger or into the submenu keeps it open", () => {
    const leaving = run(FILE_OPEN, SUBMENU_FOCUS_LEFT)
    const returned = run(leaving, SUBMENU_FOCUS_RETURNED)

    expect(returned).toEqual({ status: "open", sub: "file" })
    expect(run(returned, submenuLeaveElapsed(leaving))).toBe(returned)
  })

  test("only the delay that the latest move away started closes the submenu", () => {
    const first = run(FILE_OPEN, SUBMENU_FOCUS_LEFT)
    const latest = run(first, SUBMENU_FOCUS_LEFT)

    expect(run(latest, submenuLeaveElapsed(first))).toBe(latest)
    expect(run(latest, submenuLeaveElapsed(latest))).toBe(SUBMENU_CLOSED)
  })

  test("closing one submenu leaves another open, and closes its own while it is leaving", () => {
    const edit = run(FILE_OPEN, submenuRequested("edit", true))

    expect(run(edit, submenuRequested("file", false))).toBe(edit)
    expect(run(edit, submenuRequested("edit", false))).toBe(SUBMENU_CLOSED)
    expect(run(edit, SUBMENU_FOCUS_LEFT, submenuRequested("edit", false))).toBe(SUBMENU_CLOSED)
  })

  test("events that change nothing keep the same state", () => {
    expect(run(FILE_OPEN, submenuRequested("file", true), SUBMENU_FOCUS_RETURNED)).toBe(FILE_OPEN)
    expect(run(SUBMENU_CLOSED, SUBMENU_FOCUS_LEFT, SUBMENU_FOCUS_RETURNED, submenuRequested("file", false))).toBe(
      SUBMENU_CLOSED,
    )
    expect(Object.isFrozen(run(FILE_OPEN, SUBMENU_FOCUS_LEFT))).toBe(true)
  })

  test("disposing ignores later events", () => {
    const disposed = run(FILE_OPEN, SUBMENU_DISPOSED)

    expect(disposed).toEqual({ status: "disposed" })
    expect(run(disposed, submenuRequested("edit", true), SUBMENU_FOCUS_LEFT)).toBe(disposed)
  })
})
