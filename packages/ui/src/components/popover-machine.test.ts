import { describe, expect, test } from "bun:test"
import {
  createPopoverState,
  EMPTY_POPOVER_STACK,
  selectPopoverOpen,
  selectPreventCloseAutoFocus,
  transitionPopover,
  transitionPopoverStack,
  type PopoverEvent,
  type PopoverStackEvent,
  type PopoverState,
  type PopoverStackState,
  type PopoverTransition,
} from "./popover-machine"

function run(state: PopoverState, ...events: PopoverEvent[]) {
  return events.reduce<PopoverTransition>(
    (result, event) => {
      const next = transitionPopover(result.state, event)

      return { state: next.state, effects: [...result.effects, ...next.effects] }
    },
    { state, effects: [] },
  )
}

function stackOf(...events: PopoverStackEvent[]) {
  return events.reduce<PopoverStackState>(
    (state, event) => transitionPopoverStack(state, event).state,
    EMPTY_POPOVER_STACK,
  )
}

describe("popover machine", () => {
  test("a refused controlled close leaves no outside reason for the next close to read", () => {
    // The owner keeps `open={true}`: the driver reads the prop again right after `onOpenChange(false)`.
    const refused = run(
      createPopoverState(true, undefined),
      { type: "dismiss", reason: "outside" },
      {
        type: "props.synced",
        open: true,
      },
    )

    expect(refused.effects).toEqual([{ type: "notify.open", open: false }])
    expect(selectPopoverOpen(refused.state)).toBe(true)

    // Later the close button closes it, and the owner accepts.
    const closed = run(refused.state, { type: "kobalte.changed", open: false }, { type: "props.synced", open: false })

    expect(closed.state).toEqual({ status: "closed", mode: "controlled", closeReason: "control" })
    expect(selectPreventCloseAutoFocus(closed.state)).toBe(false)
  })

  test("an accepted outside close keeps focus where the press moved it, once", () => {
    const closed = run(
      createPopoverState(true, undefined),
      { type: "dismiss", reason: "outside" },
      {
        type: "props.synced",
        open: false,
      },
    )

    expect(selectPreventCloseAutoFocus(closed.state)).toBe(true)

    const handled = transitionPopover(closed.state, { type: "close-auto-focus.handled" })

    expect(selectPreventCloseAutoFocus(handled.state)).toBe(false)
    expect(transitionPopover(handled.state, { type: "close-auto-focus.handled" }).state).toBe(handled.state)
  })

  test("Kobalte echoing a close the owner already heard does not notify twice", () => {
    const echoed = run(
      createPopoverState(true, undefined),
      { type: "dismiss", reason: "escape" },
      { type: "kobalte.changed", open: false },
    )

    expect(echoed.effects).toEqual([{ type: "notify.open", open: false }])

    const closed = transitionPopover(echoed.state, { type: "props.synced", open: false })

    expect(closed.state).toEqual({ status: "closed", mode: "controlled", closeReason: "escape" })
  })

  test("an uncontrolled popover opens and closes itself and tells the owner", () => {
    const opened = run(createPopoverState(undefined, false), { type: "kobalte.changed", open: true })

    expect(opened.state).toEqual({ status: "open", mode: "uncontrolled" })
    expect(opened.effects).toEqual([{ type: "notify.open", open: true }])

    const closed = run(opened.state, { type: "dismiss", reason: "outside" }, { type: "props.synced", open: undefined })

    expect(closed.state).toEqual({ status: "closed", mode: "uncontrolled", closeReason: "outside" })
    expect(closed.effects).toEqual([{ type: "notify.open", open: false }])
    expect(transitionPopover(closed.state, { type: "dismiss", reason: "escape" }).state).toBe(closed.state)
  })

  test("a controlled popover asks to open and waits for the prop", () => {
    const state = createPopoverState(false, undefined)
    const asked = transitionPopover(state, { type: "kobalte.changed", open: true })

    expect(asked.state).toBe(state)
    expect(asked.effects).toEqual([{ type: "notify.open", open: true }])
    expect(selectPopoverOpen(transitionPopover(state, { type: "props.synced", open: true }).state)).toBe(true)
  })

  test("a disposed popover ignores later events", () => {
    const disposed = transitionPopover(createPopoverState(undefined, true), { type: "disposed" }).state

    expect(transitionPopover(disposed, { type: "dismiss", reason: "escape" })).toEqual({ state: disposed, effects: [] })
  })
})

describe("popover stack", () => {
  const nested = stackOf({ type: "layer.opened", id: 1, parentId: null }, { type: "layer.opened", id: 2, parentId: 1 })

  test("Escape dismisses only the newest popover", () => {
    expect(transitionPopoverStack(nested, { type: "escape.pressed" }).effects).toEqual([
      { type: "dismiss.layer", id: 2, reason: "escape" },
    ])
  })

  test("a press inside a portaled child keeps its parent open", () => {
    const inside = (...ids: number[]) =>
      transitionPopoverStack(nested, { type: "outside.interacted", insideIds: new Set(ids) }).effects

    expect(inside(2)).toEqual([])
    expect(inside(1)).toEqual([{ type: "dismiss.layer", id: 2, reason: "outside" }])
    expect(inside()).toEqual([
      { type: "dismiss.layer", id: 2, reason: "outside" },
      { type: "dismiss.layer", id: 1, reason: "outside" },
    ])
  })

  test("closing every layer empties the stack, and repeats keep the state", () => {
    expect(transitionPopoverStack(nested, { type: "layer.opened", id: 2, parentId: 1 }).state).toBe(nested)

    const closed = stackOf(
      { type: "layer.opened", id: 1, parentId: null },
      { type: "layer.closed", id: 1 },
      { type: "layer.closed", id: 1 },
    )

    expect(closed).toBe(EMPTY_POPOVER_STACK)
    expect(transitionPopoverStack(EMPTY_POPOVER_STACK, { type: "escape.pressed" }).effects).toEqual([])
  })
})
