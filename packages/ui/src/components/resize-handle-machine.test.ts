import { describe, expect, test } from "bun:test"
import {
  INITIAL_RESIZE_HANDLE_STATE,
  RESIZE_DRAG_CANCELLED,
  RESIZE_HANDLE_DISPOSED,
  resizeSign,
  resizeSize,
  selectResizeHandleActive,
  transitionResizeHandle,
  type ResizeHandleEvent,
  type ResizeHandleState,
  type ResizeHandleTransition,
  type ResizeSession,
} from "./resize-handle-machine"

const session: ResizeSession = {
  pointerId: 1,
  direction: "horizontal",
  sign: 1,
  startPos: 300,
  startSize: 240,
  min: 160,
  max: 480,
  threshold: 120,
}

const down = (overrides: Partial<Extract<ResizeHandleEvent, { type: "pointer.down" }>> = {}): ResizeHandleEvent => ({
  type: "pointer.down",
  button: 0,
  ctrlKey: false,
  detail: 1,
  session,
  ...overrides,
})

const move = (pos: number, pointerId = 1): ResizeHandleEvent => ({ type: "pointer.moved", pointerId, pos })

const up: ResizeHandleEvent = { type: "pointer.up", pointerId: 1 }

// Every effect a sequence emits, in order, as the driver would run them.
function run(state: ResizeHandleState, ...events: ResizeHandleEvent[]) {
  return events.reduce<{ state: ResizeHandleState; effects: string[] }>(
    (result, event) => {
      const next: ResizeHandleTransition = transitionResizeHandle(result.state, event)

      return { state: next.state, effects: [...result.effects, ...next.effects] }
    },
    { state, effects: [] },
  )
}

describe("resize handle machine", () => {
  test("a click without moving reports neither a drag nor a collapse change", () => {
    expect(run(INITIAL_RESIZE_HANDLE_STATE, down(), up)).toEqual({
      state: INITIAL_RESIZE_HANDLE_STATE,
      effects: ["lock-body", "unlock-body"],
    })
  })

  test("a drag that never collapses reports no collapse change on release", () => {
    expect(run(INITIAL_RESIZE_HANDLE_STATE, down(), move(320), up).effects).toEqual([
      "lock-body",
      "dragging-true",
      "resize",
      "unlock-body",
      "dragging-false",
    ])
  })

  test("a drag released while collapsed commits the collapse", () => {
    expect(run(INITIAL_RESIZE_HANDLE_STATE, down(), move(150), up).effects).toEqual([
      "lock-body",
      "dragging-true",
      "collapse-true",
      "resize",
      "unlock-body",
      "dragging-false",
      "collapse-commit",
    ])
  })

  test("crossing the threshold back out reports the collapse change once", () => {
    expect(run(INITIAL_RESIZE_HANDLE_STATE, down(), move(150), move(160), move(290), up).effects).toEqual([
      "lock-body",
      "dragging-true",
      "collapse-true",
      "resize",
      "resize",
      "collapse-false",
      "resize",
      "unlock-body",
      "dragging-false",
    ])
  })

  test.each([
    ["blur", RESIZE_DRAG_CANCELLED],
    ["pointercancel or lost capture", { type: "drag.cancelled", pointerId: 1 } as const],
    ["unmount", RESIZE_HANDLE_DISPOSED],
  ])("%s mid-drag unlocks the page and ends the drag without committing the collapse", (_, event) => {
    const interrupted = run(INITIAL_RESIZE_HANDLE_STATE, down(), move(150), event)

    expect(interrupted.effects.slice(4)).toEqual(["unlock-body", "dragging-false", "collapse-false"])
    expect(selectResizeHandleActive(interrupted.state)).toBe(false)
  })

  test("an interrupted press unlocks the page without reporting a drag", () => {
    expect(run(INITIAL_RESIZE_HANDLE_STATE, down(), RESIZE_DRAG_CANCELLED).effects).toEqual([
      "lock-body",
      "unlock-body",
    ])
  })

  test.each([
    ["a secondary button", down({ button: 2 })],
    ["a control-click", down({ ctrlKey: true })],
    ["the second press of a double click", down({ detail: 2 })],
  ])("%s does not press the handle", (_, event) => {
    expect(run(INITIAL_RESIZE_HANDLE_STATE, event)).toEqual({ state: INITIAL_RESIZE_HANDLE_STATE, effects: [] })
  })

  test("another pointer cannot move, release or cancel the drag", () => {
    const dragging = run(INITIAL_RESIZE_HANDLE_STATE, down(), move(320)).state

    expect(
      run(dragging, move(340, 2), { type: "pointer.up", pointerId: 2 }, { type: "drag.cancelled", pointerId: 2 }),
    ).toEqual({
      state: dragging,
      effects: [],
    })
  })

  test("events after disposal are ignored", () => {
    const disposed = run(INITIAL_RESIZE_HANDLE_STATE, RESIZE_HANDLE_DISPOSED).state

    expect(run(disposed, down(), move(320), up)).toEqual({ state: disposed, effects: [] })
  })

  test.each([
    ["horizontal", "end", false, 1],
    ["horizontal", "start", false, -1],
    ["horizontal", "end", true, -1],
    ["horizontal", "start", true, 1],
    ["vertical", "end", false, 1],
    ["vertical", "start", true, -1],
  ] as const)("a %s handle on the %s edge (rtl: %p) grows with sign %p", (direction, edge, rtl, sign) => {
    expect(resizeSign(direction, edge, rtl)).toBe(sign)
  })

  test("the reported size is clamped while collapse reads the raw size", () => {
    expect(resizeSize(session, 150)).toBe(160)
    expect(resizeSize(session, 900)).toBe(480)
  })

  test("moves within one phase reuse one transition", () => {
    const dragging = run(INITIAL_RESIZE_HANDLE_STATE, down(), move(320)).state
    const event = { type: "pointer.moved" as const, pointerId: 1, pos: 330 }
    const first = transitionResizeHandle(dragging, event)
    event.pos = 340

    expect(transitionResizeHandle(dragging, event)).toBe(first)
    expect(first.state).toBe(dragging)
  })
})
