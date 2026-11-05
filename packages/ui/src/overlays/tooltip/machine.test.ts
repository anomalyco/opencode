import { describe, expect, test } from "bun:test"
import {
  createTooltipState,
  DISPOSED_EVENT,
  FOCUSED,
  KOBALTE_CLOSED,
  KOBALTE_OPENED,
  LEAVE_SETTLED,
  POINTER_ENTERED,
  POINTER_INSIDE,
  POINTER_LEFT,
  POINTER_OUTSIDE,
  POPUP_COLLAPSED,
  POPUP_EXPANDED,
  PRESS_ENDED,
  selectTooltipForceOpen,
  selectTooltipMounted,
  selectTooltipOpen,
  selectTooltipPressing,
  selectTooltipTracking,
  syncPropsEvent,
  transitionTooltip,
  TRIGGER_PRESSED,
  type TooltipEvent,
  type TooltipState,
  type TooltipTransition,
} from "./machine"

const UNCONTROLLED = syncPropsEvent(undefined, false)

function run(state: TooltipState, ...events: TooltipEvent[]) {
  return events.reduce<TooltipTransition>((result, event) => transitionTooltip(result.state, event), {
    state,
    effects: [],
  })
}

// Hovered for the open delay: Kobalte heard the replayed pointerenter and asks to open.
const hoveredOpen = () => run(createTooltipState(undefined, false), POINTER_ENTERED, KOBALTE_OPENED).state

describe("tooltip machine", () => {
  test("a press while the tooltip is closing does not swallow the next open", () => {
    // The press lands during the exit animation, when no click close follows to consume it.
    const state = run(hoveredOpen(), POINTER_LEFT, LEAVE_SETTLED, TRIGGER_PRESSED, POINTER_ENTERED, KOBALTE_OPENED)

    expect(selectTooltipOpen(state.state)).toBe(true)
  })

  test("opening a menu from an open tooltip ends the press, and the next hover opens it again", () => {
    const opened = run(hoveredOpen(), TRIGGER_PRESSED, POPUP_EXPANDED)

    expect(opened.state).toEqual({ status: "suppressed", popup: "open", hovered: true, disabled: false })
    expect(selectTooltipPressing(opened.state)).toBe(false)

    // The pointer leaves while the menu is open, Escape closes it, and the pointer comes back.
    const closed = run(opened.state, POINTER_OUTSIDE, POPUP_COLLAPSED)

    expect(closed.state).toEqual({ status: "idle", hovered: false, disabled: false })
    expect(selectTooltipOpen(run(closed.state, POINTER_ENTERED, KOBALTE_OPENED).state)).toBe(true)
  })

  test("a press while forceOpen is set does not swallow the next open after release", () => {
    const state = run(
      createTooltipState(true, false),
      TRIGGER_PRESSED,
      KOBALTE_CLOSED,
      UNCONTROLLED,
      POINTER_ENTERED,
      KOBALTE_OPENED,
    )

    expect(selectTooltipOpen(state.state)).toBe(true)
  })

  test("a press without a click still lets Escape close the tooltip", () => {
    const state = run(hoveredOpen(), TRIGGER_PRESSED, PRESS_ENDED, KOBALTE_CLOSED)

    expect(state.state).toEqual({ status: "idle", hovered: true, disabled: false })
  })

  test("the click that ends a press keeps the tooltip open once", () => {
    const clicked = run(hoveredOpen(), TRIGGER_PRESSED, KOBALTE_CLOSED)

    expect(clicked.state).toEqual({ status: "open", hovered: true, pressing: false })
    expect(run(clicked.state, KOBALTE_CLOSED).state).toEqual({ status: "idle", hovered: true, disabled: false })
  })

  test("a menu closed over a still pointer keeps the tooltip hidden until the pointer moves off", () => {
    // The menu's modal layer turns pointer events off, so the trigger hears a leave without the pointer moving, and an
    // enter when the menu closes.
    const closed = run(hoveredOpen(), TRIGGER_PRESSED, POPUP_EXPANDED, POINTER_LEFT, POPUP_COLLAPSED, POINTER_ENTERED)

    expect(closed.state).toEqual({ status: "suppressed", popup: "closed", disabled: false })
    expect(selectTooltipOpen(run(closed.state, KOBALTE_OPENED, POINTER_INSIDE, KOBALTE_OPENED).state)).toBe(false)

    const left = run(closed.state, POINTER_OUTSIDE)

    expect(left.state).toEqual({ status: "idle", hovered: false, disabled: false })
    expect(selectTooltipOpen(run(left.state, POINTER_ENTERED, KOBALTE_OPENED).state)).toBe(true)
  })

  test("a menu opened from the keyboard with the pointer elsewhere does not suppress the next hover", () => {
    const state = run(createTooltipState(undefined, false), FOCUSED, POPUP_EXPANDED, POPUP_COLLAPSED)

    expect(state.state).toEqual({ status: "idle", hovered: false, disabled: false })
  })

  test("focusing the trigger itself lifts suppression", () => {
    const closed = run(hoveredOpen(), POPUP_EXPANDED, POPUP_COLLAPSED)
    const state = run(closed.state, FOCUSED, KOBALTE_OPENED)

    expect(closed.state.status).toBe("suppressed")
    expect(selectTooltipOpen(state.state)).toBe(true)
  })

  test("the first hover or focus mounts Kobalte and replays the event", () => {
    const hovered = transitionTooltip(createTooltipState(undefined, false), POINTER_ENTERED)
    const focused = transitionTooltip(createTooltipState(undefined, false), FOCUSED)

    expect(hovered).toEqual({ state: { status: "idle", hovered: true, disabled: false }, effects: ["replay"] })
    expect(focused).toEqual({ state: { status: "idle", hovered: false, disabled: false }, effects: ["replay"] })
    expect(selectTooltipMounted(hovered.state)).toBe(true)
  })

  test("a popup already open when Kobalte mounts suppresses the replayed open", () => {
    const state = run(createTooltipState(undefined, false), FOCUSED, POPUP_EXPANDED, KOBALTE_OPENED)

    expect(selectTooltipOpen(state.state)).toBe(false)
    expect(selectTooltipTracking(state.state)).toBe(true)
  })

  test("leaving keeps the tooltip open until the microtask settles", () => {
    const left = run(hoveredOpen(), POINTER_LEFT)

    expect(left.effects).toEqual(["schedule-leave"])
    expect(selectTooltipOpen(left.state)).toBe(true)
    expect(run(left.state, LEAVE_SETTLED).state).toEqual({ status: "idle", hovered: false, disabled: false })
    expect(selectTooltipOpen(run(left.state, POINTER_ENTERED, LEAVE_SETTLED).state)).toBe(true)
  })

  test("disabled tooltips neither mount nor open, and disabling closes an open one", () => {
    const disabled = createTooltipState(undefined, true)

    expect(transitionTooltip(disabled, POINTER_ENTERED).state).toBe(disabled)
    expect(transitionTooltip(disabled, FOCUSED).state).toBe(disabled)

    const closed = run(hoveredOpen(), syncPropsEvent(undefined, true))

    expect(closed.state).toEqual({ status: "idle", hovered: true, disabled: true })
    expect(transitionTooltip(closed.state, KOBALTE_OPENED).state).toBe(closed.state)
  })

  test("forceOpen controls the tooltip and releasing it closes the tooltip", () => {
    const forced = run(createTooltipState(undefined, false), POINTER_ENTERED, syncPropsEvent(true, false))

    expect(selectTooltipOpen(forced.state)).toBe(true)
    expect(selectTooltipForceOpen(forced.state)).toBe(true)
    expect(transitionTooltip(forced.state, KOBALTE_CLOSED).state).toBe(forced.state)
    expect(run(forced.state, UNCONTROLLED).state).toEqual({ status: "idle", hovered: true, disabled: false })
    expect(run(forced.state, POPUP_EXPANDED, UNCONTROLLED).state).toEqual({
      status: "suppressed",
      popup: "open",
      hovered: true,
      disabled: false,
    })
  })

  test("disposal ends every state and ignores later events", () => {
    const disposed = transitionTooltip(hoveredOpen(), DISPOSED_EVENT).state

    expect(disposed).toEqual({ status: "disposed" })
    expect(selectTooltipMounted(disposed)).toBe(false)
    expect(transitionTooltip(disposed, LEAVE_SETTLED).state).toBe(disposed)
    expect(transitionTooltip(disposed, PRESS_ENDED).state).toBe(disposed)
  })

  test("every reachable state and transition is a frozen singleton", () => {
    const events = [
      POINTER_ENTERED,
      POINTER_LEFT,
      POINTER_INSIDE,
      POINTER_OUTSIDE,
      FOCUSED,
      TRIGGER_PRESSED,
      PRESS_ENDED,
      LEAVE_SETTLED,
      POPUP_EXPANDED,
      POPUP_COLLAPSED,
      KOBALTE_OPENED,
      KOBALTE_CLOSED,
      DISPOSED_EVENT,
      ...[undefined, false, true].flatMap((forceOpen) =>
        [false, true].map((disabled) => syncPropsEvent(forceOpen, disabled)),
      ),
    ]

    const reached = new Set(
      [undefined, false, true].flatMap((forceOpen) =>
        [false, true].map((disabled) => createTooltipState(forceOpen, disabled)),
      ),
    )

    for (const state of reached) {
      expect(Object.isFrozen(state)).toBe(true)

      for (const event of events) {
        const transition = transitionTooltip(state, event)

        expect(transitionTooltip(state, event)).toBe(transition)
        expect(Object.isFrozen(transition)).toBe(true)

        if (transition.state === state) expect(transition.effects).toHaveLength(0)
        reached.add(transition.state)
      }
    }

    expect(reached.size).toBe(33)
  })
})
