import { describe, expect, test } from "bun:test"
import {
  correctFlyoutPosition,
  createDialogFlyoutState,
  createModelDrawerState,
  FLYOUT_OPEN_DELAY_MS,
  inside,
  placeFlyout,
  selectDrawerRestoreTrigger,
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

  test.each([
    ["the arrow keys", { type: "keyboard" }],
    ["a resize", { type: "dismissed" }],
  ] as const)("%s cancel a pending open, so its timer opens nothing", (_name, event) => {
    const resting = transitionDialogFlyout(createDialogFlyoutState(), moved("a", { x: 100, y: 120 }))
    expect(resting.state).toMatchObject({ status: "opening", attempt: 1 })

    const cancelled = transitionDialogFlyout(resting.state, event)
    expect(cancelled.effects).toEqual([{ type: "cancel" }])
    expect(cancelled.state.status).toBe("closed")

    const late = transitionDialogFlyout(cancelled.state, { type: "open.due", attempt: 1 })
    expect(late.state).toBe(cancelled.state)
    expect(selectFlyoutOpenId(late.state)).toBeUndefined()
  })

  test("typing closes a warm flyout state cold", () => {
    const open = opened("a")
    const typed = transitionDialogFlyout(open, { type: "keyboard" })

    expect(typed.state).toMatchObject({ status: "closed", input: "keyboard", warm: false })
    expect(transitionDialogFlyout(typed.state, moved("b", { x: 100, y: 150 })).state.status).toBe("opening")
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

    expect(placeFlyout(row, { left: 0, right: 800, top: 0, bottom: 600 }, false)).toEqual({ left: 406, top: 48 })
    expect(placeFlyout({ ...row, left: 200 }, { left: 0, right: 500, top: 0, bottom: 600 }, false)).toEqual({
      left: 34,
      top: 48,
    })
    expect(placeFlyout(row, { left: 50, right: 500, top: 0, bottom: 600 }, false)).toEqual({ left: 340, top: 48 })
    expect(placeFlyout(row, { left: 0, right: 800, top: 0, bottom: 600 }, true)).toEqual({ left: 406, top: 48 })
    expect(correctFlyoutPosition({ left: 406, top: 48 }, { x: 456, y: 58 })).toEqual({ left: 356, top: 38 })
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
