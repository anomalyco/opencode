import { describe, expect, test } from "bun:test"
import {
  DISPOSED_PANE_DRAG_STATE,
  INITIAL_PANE_DRAG_STATE,
  selectDraggingKey,
  selectDragLayer,
  selectMoveKey,
  transitionPaneDrag,
  type PaneDragEvent,
  type PaneDragState,
  type PaneDropTarget,
} from "./pane-drag-machine"

const strip: PaneDropTarget = {
  pane: "side",
  before: "file://b.ts",
  strip: true,
  rect: { left: 10, top: 2, width: 2, height: 20 },
}

const bottom: PaneDropTarget = {
  pane: "bottom",
  strip: false,
  rect: { left: 0, top: 400, width: 800, height: 200 },
}

const down = (pointerId = 1, key = "file://a.ts", button = 0): PaneDragEvent => ({
  type: "pointer.down",
  pointerId,
  button,
  x: 0,
  y: 0,
  key,
  title: key.slice(7),
})

const move = (x: number, y: number, target: PaneDropTarget | undefined, pointerId = 1): PaneDragEvent => ({
  type: "pointer.move",
  pointerId,
  x,
  y,
  target,
})

function replay(events: PaneDragEvent[], state: PaneDragState = INITIAL_PANE_DRAG_STATE) {
  return events.reduce<{ state: PaneDragState; effects: unknown[] }>(
    (current, event) => {
      const next = transitionPaneDrag(current.state, event)

      return { state: next.state, effects: [...current.effects, ...next.effects] }
    },
    { state, effects: [] },
  )
}

const pressedState = replay([down()]).state

const draggingState = replay([down(), move(4, 0, strip)]).state

describe("disposal", () => {
  test("mid-drag releases the gesture and unlocks the body without dropping", () => {
    const next = transitionPaneDrag(draggingState, { type: "disposed" })

    expect(next.state).toBe(DISPOSED_PANE_DRAG_STATE)
    expect(next.effects).toEqual([{ type: "gesture.cleanup", unlockBody: true }, { type: "click-suppression.clear" }])

    const late = replay([move(40, 0, bottom), { type: "pointer.up", pointerId: 1 }, down(2)], next.state)

    expect(late.state).toBe(DISPOSED_PANE_DRAG_STATE)
    expect(late.effects).toEqual([])
  })

  test("mid-press releases the gesture, and a later move starts no drag", () => {
    const next = transitionPaneDrag(pressedState, { type: "disposed" })

    expect(next.effects).toEqual([{ type: "gesture.cleanup", unlockBody: false }, { type: "click-suppression.clear" }])
    expect(replay([move(40, 0, strip)], next.state).state).toBe(DISPOSED_PANE_DRAG_STATE)
  })

  test("after a release clears the click swallower the release armed", () => {
    const released = transitionPaneDrag(draggingState, { type: "pointer.up", pointerId: 1 })

    expect(released.effects).toContainEqual({ type: "click-suppression.arm" })
    expect(transitionPaneDrag(released.state, { type: "disposed" }).effects).toEqual([
      { type: "click-suppression.clear" },
    ])
  })
})

describe("a second pointer", () => {
  test("neither starts a gesture nor moves or ends the first one", () => {
    const pressedSecond = transitionPaneDrag(pressedState, down(2, "file://b.ts"))

    expect(pressedSecond.state).toBe(pressedState)
    expect(pressedSecond.effects).toEqual([])

    const events: PaneDragEvent[] = [
      down(2, "file://b.ts"),
      move(90, 90, bottom, 2),
      { type: "pointer.up", pointerId: 2 },
      { type: "pointer.cancel", pointerId: 2 },
    ]

    events.forEach((event) => {
      const next = transitionPaneDrag(draggingState, event)

      expect(next.state).toBe(draggingState)
      expect(next.effects).toEqual([])
    })
    expect(selectMoveKey(draggingState, 2, 90, 90)).toBeUndefined()
    expect(selectMoveKey(pressedState, 2, 90, 90)).toBeUndefined()

    expect(transitionPaneDrag(draggingState, { type: "pointer.up", pointerId: 1 }).effects).toContainEqual({
      type: "drop",
      key: "file://a.ts",
      target: strip,
    })
  })
})

describe("cancelling", () => {
  test.each([
    { type: "session.changed" },
    { type: "blur" },
    { type: "escape" },
    { type: "pointer.cancel", pointerId: 1 },
  ] satisfies PaneDragEvent[])("$type mid-drag returns to idle without dropping", (event) => {
    const next = transitionPaneDrag(draggingState, event)

    expect(next.state).toBe(INITIAL_PANE_DRAG_STATE)
    expect(next.effects).toEqual([{ type: "gesture.cleanup", unlockBody: true }])
    expect(transitionPaneDrag(next.state, { type: "pointer.up", pointerId: 1 }).effects).toEqual([])
  })

  test.each([
    { type: "session.changed" },
    { type: "blur" },
    { type: "escape" },
    { type: "pointer.cancel", pointerId: 1 },
  ] satisfies PaneDragEvent[])("$type mid-press returns to idle without touching the body", (event) => {
    const next = transitionPaneDrag(pressedState, event)

    expect(next.state).toBe(INITIAL_PANE_DRAG_STATE)
    expect(next.effects).toEqual([{ type: "gesture.cleanup", unlockBody: false }])
  })
})

describe("activation", () => {
  test("only the primary button presses", () => {
    expect(transitionPaneDrag(INITIAL_PANE_DRAG_STATE, down(1, "file://a.ts", 1)).state).toBe(INITIAL_PANE_DRAG_STATE)
    expect(transitionPaneDrag(INITIAL_PANE_DRAG_STATE, down(1, "file://a.ts", 2)).state).toBe(INITIAL_PANE_DRAG_STATE)
    expect(transitionPaneDrag(INITIAL_PANE_DRAG_STATE, down()).effects).toEqual([{ type: "gesture.attach" }])
  })

  test("a move under the threshold stays a press, and its release is a click", () => {
    expect(selectMoveKey(pressedState, 1, 3, 2)).toBeUndefined()
    expect(transitionPaneDrag(pressedState, move(3, 2, strip)).state).toBe(pressedState)
    expect(selectDraggingKey(pressedState)).toBeUndefined()

    const released = transitionPaneDrag(pressedState, { type: "pointer.up", pointerId: 1 })

    expect(released.state).toBe(INITIAL_PANE_DRAG_STATE)
    expect(released.effects).toEqual([{ type: "gesture.cleanup", unlockBody: false }])
  })

  test("crossing the threshold drags and locks the body", () => {
    expect(selectMoveKey(pressedState, 1, 4, 0)).toBe("file://a.ts")

    const over = transitionPaneDrag(pressedState, move(4, 0, strip))

    expect(selectDraggingKey(over.state)).toBe("file://a.ts")
    expect(selectDragLayer(over.state)).toMatchObject({ x: 4, y: 0, target: strip, title: "a.ts" })
    expect(over.effects).toEqual([{ type: "body.lock", cursor: "grabbing" }])
    expect(transitionPaneDrag(pressedState, move(4, 0, undefined)).effects).toEqual([{ type: "body.lock", cursor: "" }])
  })
})

describe("dragging", () => {
  test("an unchanged move returns the same state", () => {
    const next = transitionPaneDrag(draggingState, move(4, 0, { ...strip, rect: { ...strip.rect } }))

    expect(next.state).toBe(draggingState)
    expect(next.effects).toEqual([])
  })

  test("a move over an equal target keeps the target object", () => {
    const next = transitionPaneDrag(draggingState, move(20, 0, { ...strip, rect: { ...strip.rect } }))

    expect(selectDragLayer(next.state)?.target).toBe(strip)
    expect(next.effects).toEqual([])
  })

  test("the cursor follows whether a drop zone is under the pointer", () => {
    const away = transitionPaneDrag(draggingState, move(20, 0, undefined))

    expect(away.effects).toEqual([{ type: "body.cursor", cursor: "" }])
    expect(transitionPaneDrag(away.state, move(30, 0, bottom)).effects).toEqual([
      { type: "body.cursor", cursor: "grabbing" },
    ])

    const released = transitionPaneDrag(away.state, { type: "pointer.up", pointerId: 1 })

    expect(released.state).toBe(INITIAL_PANE_DRAG_STATE)
    expect(released.effects).toEqual([{ type: "gesture.cleanup", unlockBody: true }, { type: "click-suppression.arm" }])
  })

  test("a release over a drop zone drops the tab there", () => {
    const released = replay([move(30, 0, bottom), { type: "pointer.up", pointerId: 1 }], draggingState)

    expect(released.state).toBe(INITIAL_PANE_DRAG_STATE)
    expect(released.effects).toEqual([
      { type: "gesture.cleanup", unlockBody: true },
      { type: "click-suppression.arm" },
      { type: "drop", key: "file://a.ts", target: bottom },
    ])
  })
})
