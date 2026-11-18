import { describe, expect, test } from "bun:test"
import {
  detailsPopoverFocusesContent,
  detailsPopoverOpen,
  initialDetailsPopoverState,
  transitionDetailsPopover,
  type DetailsPopoverEvent,
  type DetailsPopoverState,
  type DetailsPopoverTransition,
} from "./popover-machine"

// Folds the events in order and returns the last transition.
const replay = (events: readonly DetailsPopoverEvent[], state: DetailsPopoverState = initialDetailsPopoverState) =>
  events.reduce<DetailsPopoverTransition>((last, event) => transitionDetailsPopover(last.state, event), {
    state,
    effects: [],
  })

describe("transitionDetailsPopover", () => {
  test("an open takes the modality of the action that opened it, not of an earlier press", () => {
    // A pointer open, then a keyboard open: the second focuses the first row.
    const keyboard = replay([
      { type: "opened", via: "pointer" },
      { type: "closed" },
      { type: "toggled", via: "keyboard" },
    ])

    expect(detailsPopoverOpen(keyboard.state)).toBe(true)
    expect(detailsPopoverFocusesContent(keyboard.state)).toBe(false)
    expect(transitionDetailsPopover(keyboard.state, { type: "autofocus.intercepted" }).state).toBe(keyboard.state)

    const enter = replay([{ type: "opened", via: "keyboard" }])

    expect(detailsPopoverFocusesContent(enter.state)).toBe(false)
  })

  test("a pointer open focuses the popover once its content is in the document", () => {
    const intercepted = replay([{ type: "opened", via: "pointer" }, { type: "autofocus.intercepted" }])

    expect(intercepted.effects).toEqual([{ type: "schedule-focus", attempt: 1 }])

    const due = transitionDetailsPopover(intercepted.state, { type: "focus.due", attempt: 1 })

    expect(due.effects).toEqual([{ type: "focus-content" }])
    expect(transitionDetailsPopover(due.state, { type: "focus.due", attempt: 1 }).state).toBe(due.state)
  })

  test("closing before the deferred focus cancels it, and a late one focuses nothing", () => {
    for (const end of [
      { type: "closed" },
      { type: "toggled", via: "keyboard" },
      { type: "disposed" },
    ] satisfies DetailsPopoverEvent[]) {
      const ended = replay([{ type: "opened", via: "pointer" }, { type: "autofocus.intercepted" }, end])

      expect(ended.effects).toEqual([{ type: "cancel-focus" }])
      expect(transitionDetailsPopover(ended.state, { type: "focus.due", attempt: 1 })).toEqual({
        state: ended.state,
        effects: [],
      })
    }

    // Reopened before the first open's focus ran: that focus belongs to the earlier open.
    const reopened = replay([
      { type: "opened", via: "pointer" },
      { type: "autofocus.intercepted" },
      { type: "closed" },
      { type: "opened", via: "pointer" },
      { type: "autofocus.intercepted" },
    ])

    expect(reopened.effects).toEqual([{ type: "schedule-focus", attempt: 2 }])
    expect(transitionDetailsPopover(reopened.state, { type: "focus.due", attempt: 1 }).state).toBe(reopened.state)
  })

  test("an event that does not apply keeps the state", () => {
    const open = replay([{ type: "opened", via: "pointer" }]).state

    expect(transitionDetailsPopover(open, { type: "opened", via: "keyboard" }).state).toBe(open)
    expect(transitionDetailsPopover(initialDetailsPopoverState, { type: "closed" }).state).toBe(
      initialDetailsPopoverState,
    )

    const disposed = replay([{ type: "disposed" }]).state

    expect(transitionDetailsPopover(disposed, { type: "opened", via: "pointer" }).state).toBe(disposed)
  })
})
