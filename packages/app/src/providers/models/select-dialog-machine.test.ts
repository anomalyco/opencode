import { describe, expect, test } from "bun:test"
import {
  createDialogFlyoutState,
  createModelDrawerState,
  FLYOUT_KEYBOARD_DELAY_MS,
  FLYOUT_OPEN_DELAY_MS,
  inside,
  placeFlyout,
  selectDrawerRestoreTrigger,
  selectFlyoutMenu,
  selectFlyoutMenuKeys,
  selectFlyoutOpenId,
  transitionDialogFlyout,
  transitionModelDrawer,
  type DialogFlyoutEvent,
  type DialogFlyoutState,
  type DialogFlyoutTransition,
  type ModelDrawerEvent,
  type ModelDrawerState,
  type ModelDrawerTransition,
} from "./select-dialog-machine"

// The flyout sits to the right of the rows: x 300 to 460, y 100 to 300.
const flyoutRect = { left: 300, right: 460, top: 100, bottom: 300 }

const position = { left: 300, top: 100 }

function flyoutReplay(state: DialogFlyoutState, events: DialogFlyoutEvent[]) {
  const initial: DialogFlyoutTransition = { state, effects: [] }

  return events.reduce((current, event) => transitionDialogFlyout(current.state, event), initial)
}

const moved = (id: string, point: { x: number; y: number }, activeId?: string): DialogFlyoutEvent => ({
  type: "row.moved",
  id,
  activeId,
  point,
  flyout: flyoutRect,
})

/** Opens row `id`'s flyout the way a cold hover does: rest, the delay passes, the row is measured. */
function opened(id: string) {
  const resting = transitionDialogFlyout(createDialogFlyoutState(), moved(id, { x: 100, y: 120 }))
  const attempt = resting.state.status === "opening" ? resting.state.attempt : -1
  const due = transitionDialogFlyout(resting.state, { type: "open.due", attempt })

  return transitionDialogFlyout(due.state, { type: "placed", attempt, position }).state
}

/** Opens row `id`'s flyout the way the dialog does on open: the keyboard's first highlight, measured. */
function keyboardOpened(id: string) {
  const shown = transitionDialogFlyout(createDialogFlyoutState(), { type: "highlighted", id })
  const attempt = shown.state.status === "open" ? shown.state.attempt : -1

  return transitionDialogFlyout(shown.state, { type: "placed", attempt, position }).state
}

describe("model dialog flyout", () => {
  test("a flyout opens at once only for a moment after the previous one closed", () => {
    const open = opened("a")
    expect(selectFlyoutOpenId(open)).toBe("a")

    const left = transitionDialogFlyout(open, {
      type: "row.left",
      into: "outside",
      point: { x: 100, y: 400 },
      flyout: flyoutRect,
    })

    expect(left.state).toMatchObject({ status: "closed", warm: true })
    expect(left.effects).toEqual([{ type: "schedule", kind: "warm", attempt: 2, delayMs: 300 }])

    // Straight back onto a row: no open delay.
    expect(transitionDialogFlyout(left.state, moved("b", { x: 100, y: 150 })).state).toMatchObject({
      status: "open",
      id: "b",
    })

    // Seconds later the warmth is gone, and the next row waits for the delay again.
    const cooled = transitionDialogFlyout(left.state, { type: "warm.expired", attempt: 2 })
    expect(cooled.state).toMatchObject({ status: "closed", warm: false })
    const next = transitionDialogFlyout(cooled.state, moved("b", { x: 100, y: 150 }))
    expect(next.state).toMatchObject({ status: "opening", id: "b" })
    expect(next.effects).toContainEqual({ type: "schedule", kind: "open", attempt: 3, delayMs: FLYOUT_OPEN_DELAY_MS })
  })

  test("a resize cancels a pending open, so its timer opens nothing", () => {
    const resting = transitionDialogFlyout(createDialogFlyoutState(), moved("a", { x: 100, y: 120 }))
    expect(resting.state).toMatchObject({ status: "opening", attempt: 1 })

    const cancelled = transitionDialogFlyout(resting.state, { type: "dismissed" })
    expect(cancelled.effects).toEqual([{ type: "cancel" }])
    expect(cancelled.state.status).toBe("closed")

    const late = transitionDialogFlyout(cancelled.state, { type: "open.due", attempt: 1 })
    expect(late.state).toBe(cancelled.state)
    expect(selectFlyoutOpenId(late.state)).toBeUndefined()
  })

  test("the dialog opens with the highlighted row's flyout", () => {
    const shown = transitionDialogFlyout(createDialogFlyoutState(), { type: "highlighted", id: "a" })
    expect(shown.state).toMatchObject({ status: "open", id: "a", input: "keyboard" })
    expect(shown.effects).toEqual([{ type: "place", attempt: 1, id: "a" }])

    const placed = transitionDialogFlyout(shown.state, { type: "placed", attempt: 1, position })
    expect(selectFlyoutOpenId(placed.state)).toBe("a")
  })

  test("a single arrow press moves the flyout at once", () => {
    const down = flyoutReplay(keyboardOpened("a"), [
      { type: "keyboard", id: "a", repeat: false },
      { type: "highlighted", id: "b" },
    ])

    // It keeps its place until the new row is measured, so it never disappears.
    expect(down.state).toMatchObject({ status: "open", id: "b", position })
    expect(selectFlyoutOpenId(down.state)).toBe("b")
    const attempt = down.state.status === "open" ? down.state.attempt : -1
    expect(down.effects).toEqual([{ type: "place", attempt, id: "b" }])
  })

  test("a held arrow key hides the flyout until the highlight rests", () => {
    const open = keyboardOpened("a")

    const down = flyoutReplay(open, [
      { type: "keyboard", id: "a", repeat: true },
      { type: "highlighted", id: "b" },
    ])

    expect(down.state).toMatchObject({ status: "opening", id: "b" })
    expect(selectFlyoutOpenId(down.state)).toBeUndefined()
    const first = down.state.status === "opening" ? down.state.attempt : -1
    expect(down.effects).toEqual([
      { type: "cancel" },
      { type: "schedule", kind: "open", attempt: first, delayMs: FLYOUT_KEYBOARD_DELAY_MS },
    ])

    // Held down: the next row restarts the wait, and the first row's timer opens nothing.
    const held = transitionDialogFlyout(down.state, { type: "highlighted", id: "c" })
    expect(held.state).toMatchObject({ status: "opening", id: "c" })
    expect(transitionDialogFlyout(held.state, { type: "open.due", attempt: first }).state).toBe(held.state)

    const attempt = held.state.status === "opening" ? held.state.attempt : -1
    const due = transitionDialogFlyout(held.state, { type: "open.due", attempt })
    expect(due.state).toMatchObject({ status: "open", id: "c", input: "keyboard" })
    expect(due.effects).toEqual([{ type: "place", attempt, id: "c" }])
  })

  test("the keyboard takes over a hovered flyout without closing it", () => {
    const typed = transitionDialogFlyout(opened("a"), { type: "keyboard", id: "a", repeat: false })

    expect(typed.state).toMatchObject({ status: "open", id: "a", input: "keyboard" })
    expect(selectFlyoutOpenId(typed.state)).toBe("a")
  })

  test("the pointer moving outside the rows leaves a keyboard flyout open", () => {
    const open = keyboardOpened("a")
    const far = { x: 200, y: 50 }

    expect(transitionDialogFlyout(open, { type: "pointer.outside", point: far, flyout: flyoutRect }).state).toBe(open)
    expect(
      transitionDialogFlyout(open, { type: "row.left", into: "outside", point: far, flyout: flyoutRect }).state,
    ).toBe(open)
  })

  test("a keyboard scroll moves the flyout with its row", () => {
    const open = keyboardOpened("a")
    const scrolled = transitionDialogFlyout(open, { type: "scrolled", target: undefined })

    expect(scrolled.state).toBe(open)
    expect(scrolled.effects).toEqual([{ type: "place", attempt: 1, id: "a" }])
  })

  test("the pointer takes the flyout back from the keyboard", () => {
    const open = keyboardOpened("a")

    // On the flyout's own row it becomes the triangle's apex.
    const same = transitionDialogFlyout(open, moved("a", { x: 140, y: 125 }, "a"))
    expect(same.state).toMatchObject({ status: "open", id: "a", input: "pointer", apex: { x: 140, y: 125 } })

    // On another row the flyout follows at once.
    expect(transitionDialogFlyout(open, moved("b", { x: 100, y: 150 }, "a")).state).toMatchObject({
      status: "open",
      id: "b",
      input: "pointer",
    })
  })

  test("a highlight the pointer moved is not the keyboard's", () => {
    const open = opened("a")

    expect(transitionDialogFlyout(open, { type: "highlighted", id: "a" }).state).toBe(open)
  })

  test("the forward arrow enters the flyout's menu and the back arrow leaves it", () => {
    const entered = transitionDialogFlyout(keyboardOpened("a"), { type: "menu.entered", id: "a", index: 1 })
    expect(selectFlyoutMenuKeys(entered.state)).toBe(1)

    const moved = transitionDialogFlyout(entered.state, { type: "menu.highlighted", index: 2, input: "keyboard" })
    expect(selectFlyoutMenuKeys(moved.state)).toBe(2)

    const left = transitionDialogFlyout(moved.state, { type: "menu.highlighted", index: undefined, input: "keyboard" })
    expect(selectFlyoutMenu(left.state)).toBeUndefined()
    expect(selectFlyoutOpenId(left.state)).toBe("a")

    // Typing goes back to the list.
    expect(
      selectFlyoutMenu(transitionDialogFlyout(moved.state, { type: "keyboard", id: "a", repeat: false }).state),
    ).toBeUndefined()
  })

  test("an item the pointer highlights leaves the keys with the rows", () => {
    const hovered = transitionDialogFlyout(keyboardOpened("a"), { type: "menu.highlighted", index: 1, input: "pointer" })
    expect(selectFlyoutMenu(hovered.state)).toBe(1)
    expect(selectFlyoutMenuKeys(hovered.state)).toBeUndefined()

    // The pointer leaving an item does not pull the keyboard out of the menu it entered meanwhile.
    const entered = transitionDialogFlyout(hovered.state, { type: "menu.entered", id: "a", index: 0 })
    const left = transitionDialogFlyout(entered.state, { type: "menu.highlighted", index: undefined, input: "pointer" })
    expect(selectFlyoutMenuKeys(left.state)).toBe(0)
  })

  test("entering the menu while the flyout waits to open opens it at once", () => {
    const waiting = flyoutReplay(keyboardOpened("a"), [
      { type: "keyboard", id: "a", repeat: true },
      { type: "highlighted", id: "b" },
    ])

    const entered = transitionDialogFlyout(waiting.state, { type: "menu.entered", id: "b", index: 0 })

    expect(selectFlyoutMenuKeys(entered.state)).toBe(0)
    expect(entered.state).toMatchObject({ status: "open", id: "b" })
    const attempt = entered.state.status === "open" ? entered.state.attempt : -1
    expect(entered.effects).toEqual([{ type: "cancel" }, { type: "place", attempt, id: "b" }])
  })

  test("entering the menu reopens a flyout a resize closed", () => {
    const closed = transitionDialogFlyout(keyboardOpened("a"), { type: "dismissed" })
    expect(selectFlyoutOpenId(closed.state)).toBeUndefined()

    const entered = transitionDialogFlyout(closed.state, { type: "menu.entered", id: "a", index: 0 })
    expect(entered.state).toMatchObject({ status: "open", id: "a" })
    expect(selectFlyoutMenuKeys(entered.state)).toBe(0)
  })

  test("a menu entered from the keyboard stays open when the pointer wanders off", () => {
    const entered = transitionDialogFlyout(opened("a"), { type: "menu.entered", id: "a", index: 0 }).state

    expect(
      transitionDialogFlyout(entered, { type: "pointer.outside", point: { x: 200, y: 50 }, flyout: flyoutRect }).state,
    ).toBe(entered)
  })

  test("crossing a row inside the safe triangle keeps the flyout until the pointer rests there", () => {
    const open = opened("a")
    const aiming = transitionDialogFlyout(open, moved("b", { x: 200, y: 150 }, "a"))
    expect(aiming.state).toMatchObject({ status: "aiming", id: "a", target: "b" })
    expect(selectFlyoutOpenId(aiming.state)).toBe("a")
    const attempt = aiming.state.status === "aiming" ? aiming.state.attempt : -1
    expect(aiming.effects).toEqual([{ type: "schedule", kind: "aim", attempt, delayMs: 300 }])

    // Still moving on the same row restarts the wait without a new state.
    const still = transitionDialogFlyout(aiming.state, moved("b", { x: 210, y: 150 }, "a"))
    expect(still.state).toBe(aiming.state)
    expect(still.effects).toEqual([{ type: "schedule", kind: "aim", attempt, delayMs: 300 }])

    const entered = transitionDialogFlyout(aiming.state, { type: "flyout.entered" })
    expect(entered.state).toMatchObject({ status: "open", id: "a" })
    expect(entered.effects).toEqual([{ type: "cancel" }])
    expect(transitionDialogFlyout(entered.state, { type: "aim.due", attempt, point: undefined }).state).toBe(
      entered.state,
    )

    const rested = transitionDialogFlyout(aiming.state, { type: "aim.due", attempt, point: { x: 210, y: 152 } })
    expect(rested.state).toMatchObject({ status: "open", id: "b", apex: { x: 210, y: 152 } })
    expect(rested.effects).toEqual([
      { type: "activate", id: "b" },
      { type: "place", attempt: attempt + 1, id: "b" },
    ])
  })

  test("a move on the flyout's own row moves the triangle's apex without a new state", () => {
    const open = opened("a")
    const next = transitionDialogFlyout(open, moved("a", { x: 140, y: 125 }, "a"))

    expect(next.state).toBe(open)
    expect(next.effects).toEqual([])
    expect(open).toMatchObject({ apex: { x: 140, y: 125 } })
  })

  test("leaving the triangle for empty space closes the flyout", () => {
    const open = opened("a")

    expect(
      transitionDialogFlyout(open, { type: "pointer.outside", point: { x: 250, y: 200 }, flyout: flyoutRect }).state,
    ).toBe(open)
    expect(
      transitionDialogFlyout(open, { type: "pointer.outside", point: { x: 200, y: 50 }, flyout: flyoutRect }).state,
    ).toMatchObject({ status: "closed", warm: true })
  })

  test("a wheel scroll moves the highlight and flyout to the row under the pointer; a keyboard scroll does not", () => {
    const keyboard = createDialogFlyoutState()
    const target = { id: "c", point: { x: 100, y: 200 } }
    expect(transitionDialogFlyout(keyboard, { type: "scrolled", target }).state).toBe(keyboard)

    const wheeled = flyoutReplay(keyboard, [{ type: "wheel" }, { type: "scrolled", target }])
    expect(wheeled.state).toMatchObject({ status: "open", id: "c" })
    expect(wheeled.effects).toEqual([
      { type: "activate", id: "c" },
      { type: "place", attempt: 1, id: "c" },
    ])

    const nothing = transitionDialogFlyout(opened("a"), { type: "scrolled", target: undefined })
    expect(nothing.state).toMatchObject({ status: "closed", warm: false })
  })

  test("a row that cannot be measured closes the flyout", () => {
    const resting = transitionDialogFlyout(createDialogFlyoutState(), moved("a", { x: 100, y: 120 }))
    const due = transitionDialogFlyout(resting.state, { type: "open.due", attempt: 1 })

    expect(transitionDialogFlyout(due.state, { type: "placed", attempt: 1, position: undefined }).state).toMatchObject({
      status: "closed",
    })
  })

  test("disposal cancels a pending timer and ignores what comes after", () => {
    const resting = transitionDialogFlyout(createDialogFlyoutState(), moved("a", { x: 100, y: 120 }))
    const disposed = transitionDialogFlyout(resting.state, { type: "disposed" })

    expect(disposed).toEqual({ state: { status: "disposed" }, effects: [{ type: "cancel" }] })
    expect(transitionDialogFlyout(disposed.state, { type: "open.due", attempt: 1 }).state).toBe(disposed.state)
  })

  test("places the flyout beside the row's end edge, else its start edge, else over the layer", () => {
    const row = { left: 100, right: 400, top: 50, bottom: 80 }

    expect(placeFlyout(row, { left: 0, right: 800, top: 0, bottom: 600 }, false, 0)).toEqual({ left: 406, top: 48 })
    expect(placeFlyout({ ...row, left: 200 }, { left: 0, right: 500, top: 0, bottom: 600 }, false, 0)).toEqual({
      left: 34,
      top: 48,
    })
    expect(placeFlyout(row, { left: 50, right: 500, top: 0, bottom: 600 }, false, 0)).toEqual({ left: 340, top: 48 })
    expect(placeFlyout(row, { left: 0, right: 800, top: 0, bottom: 600 }, true, 0)).toEqual({ left: 406, top: 48 })
  })

  test("keeps the flyout inside the layer's top and bottom edges", () => {
    const layer = { left: 0, right: 800, top: 0, bottom: 600 }

    // A 200px flyout beside a row near the bottom rises to end 6px above the edge.
    expect(placeFlyout({ left: 100, right: 400, top: 560, bottom: 592 }, layer, false, 200)).toEqual({
      left: 406,
      top: 394,
    })
    // A row scrolled above the top keeps it 6px below the edge.
    expect(placeFlyout({ left: 100, right: 400, top: -20, bottom: 12 }, layer, false, 200).top).toBe(6)
  })

  test("the safe triangle spans from the apex to the flyout's near corners", () => {
    const apex = { x: 100, y: 120 }

    expect(inside({ x: 250, y: 150 }, apex, flyoutRect)).toBe(true)
    expect(inside({ x: 250, y: 90 }, apex, flyoutRect)).toBe(false)
    expect(inside({ x: 250, y: 150 }, apex, undefined)).toBe(false)
  })
})

function drawerReplay(state: ModelDrawerState, events: ModelDrawerEvent[]) {
  const initial: ModelDrawerTransition = { state, effects: [] }

  return events.reduce((current, event) => transitionModelDrawer(current.state, event), initial)
}

describe("mobile model drawer", () => {
  test("reopening while it closes for an action does not run that action on the next dismiss", () => {
    const managing = drawerReplay(createModelDrawerState(), [
      { type: "opened" },
      { type: "action.selected", action: "manage" },
    ])

    expect(managing.state).toMatchObject({ status: "closing", action: "manage" })
    expect(selectDrawerRestoreTrigger(managing.state)).toBe(false)

    const reopened = transitionModelDrawer(managing.state, { type: "opened" })
    expect(reopened.effects).toEqual([{ type: "cancel-close-timeout" }])

    const dismissed = transitionModelDrawer(reopened.state, { type: "dismissed" })
    expect(dismissed.state).toMatchObject({ status: "closing", action: undefined })
    expect(selectDrawerRestoreTrigger(dismissed.state)).toBe(true)

    const hidden = transitionModelDrawer(dismissed.state, { type: "hidden" })
    expect(hidden.state).toEqual({ status: "closed", attempt: 4, restoreTrigger: true })
    expect(hidden.effects).toEqual([{ type: "cancel-close-timeout" }])
  })

  test("runs the action once the close transition ends", () => {
    const selected = drawerReplay(createModelDrawerState(), [
      { type: "opened" },
      { type: "action.selected", action: "connect" },
      { type: "hidden" },
    ])

    expect(selected.effects).toEqual([{ type: "cancel-close-timeout" }, { type: "run-action", action: "connect" }])
    expect(selectDrawerRestoreTrigger(selected.state)).toBe(false)
  })

  test("runs the action after a timeout when the close transition never reports its end", () => {
    const closing = drawerReplay(createModelDrawerState(), [
      { type: "opened" },
      { type: "action.selected", action: "select" },
    ])

    expect(closing.effects).toEqual([{ type: "schedule-close-timeout", attempt: 2, delayMs: 600 }])

    const timedOut = transitionModelDrawer(closing.state, { type: "close.timed-out", attempt: 2 })
    expect(timedOut.effects).toEqual([{ type: "run-action", action: "select" }])
    expect(transitionModelDrawer(timedOut.state, { type: "hidden" }).effects).toEqual([])
    expect(transitionModelDrawer(timedOut.state, { type: "action.selected", action: "manage" }).effects).toEqual([])
  })

  test("a second tap during the close transition is ignored", () => {
    const closing = drawerReplay(createModelDrawerState(), [
      { type: "opened" },
      { type: "action.selected", action: "select" },
    ])

    expect(transitionModelDrawer(closing.state, { type: "action.selected", action: "manage" }).state).toBe(
      closing.state,
    )
  })

  test("a timeout from an earlier close is ignored", () => {
    const reopened = drawerReplay(createModelDrawerState(), [
      { type: "opened" },
      { type: "action.selected", action: "manage" },
      { type: "opened" },
      { type: "dismissed" },
    ])

    expect(transitionModelDrawer(reopened.state, { type: "close.timed-out", attempt: 2 }).state).toBe(reopened.state)
  })

  test("disposal cancels the timeout without running the action", () => {
    const closing = drawerReplay(createModelDrawerState(), [
      { type: "opened" },
      { type: "action.selected", action: "manage" },
    ])

    expect(transitionModelDrawer(closing.state, { type: "disposed" })).toEqual({
      state: { status: "disposed" },
      effects: [{ type: "cancel-close-timeout" }],
    })
  })
})
