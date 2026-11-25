import { describe, expect, test } from "bun:test"
import {
  createMenuState,
  MENU_CLOSE_AUTOFOCUS,
  MENU_DISPOSED,
  MENU_OUTSIDE_INTERACTED,
  openChangedEvent,
  selectMenuRestoreTriggerWithoutRing,
  transitionMenu,
  type MenuEvent,
  type MenuState,
} from "./machine"

const run = (state: MenuState, ...events: MenuEvent[]) => events.reduce(transitionMenu, state)

const CLOSED = createMenuState(false)

describe("transitionMenu", () => {
  test("a pointer open restores the trigger without a ring until focus returns", () => {
    const opened = run(CLOSED, openChangedEvent(true, "pointer"))

    expect(opened).toEqual({ status: "open", modality: "pointer", outsideInteracted: false })

    const closing = run(opened, openChangedEvent(false, "keyboard"))

    expect(closing.status).toBe("closing")
    expect(selectMenuRestoreTriggerWithoutRing(closing)).toBe(true)

    const closed = run(closing, MENU_CLOSE_AUTOFOCUS)

    expect(closed).toBe(CLOSED)
    expect(selectMenuRestoreTriggerWithoutRing(closed)).toBe(false)
  })

  test("an open without an input gesture keeps the ring, even after an earlier click", () => {
    const programmatic = run(CLOSED, openChangedEvent(true, "none"), openChangedEvent(false, "none"))

    expect(programmatic).toEqual({ status: "closing", modality: "programmatic", outsideInteracted: false })
    expect(selectMenuRestoreTriggerWithoutRing(programmatic)).toBe(false)
    expect(selectMenuRestoreTriggerWithoutRing(run(CLOSED, openChangedEvent(true, "keyboard")))).toBe(false)
    expect(selectMenuRestoreTriggerWithoutRing(createMenuState(true))).toBe(false)
  })

  test("an outside press keeps focus where it landed", () => {
    const state = run(
      CLOSED,
      openChangedEvent(true, "pointer"),
      MENU_OUTSIDE_INTERACTED,
      openChangedEvent(false, "pointer"),
    )

    expect(state).toEqual({ status: "closing", modality: "pointer", outsideInteracted: true })
    expect(selectMenuRestoreTriggerWithoutRing(state)).toBe(false)
    expect(run(state, MENU_CLOSE_AUTOFOCUS)).toBe(CLOSED)
  })

  test("reopening before focus returns takes the new gesture and forgets the outside press", () => {
    const state = run(
      CLOSED,
      openChangedEvent(true, "pointer"),
      MENU_OUTSIDE_INTERACTED,
      openChangedEvent(false, "none"),
      openChangedEvent(true, "keyboard"),
    )

    expect(state).toEqual({ status: "open", modality: "keyboard", outsideInteracted: false })
  })

  test("a controlled echo of an open keeps its modality, and no-ops keep the same state", () => {
    const opened = run(CLOSED, openChangedEvent(true, "pointer"))

    expect(run(opened, openChangedEvent(true, "none"))).toBe(opened)
    expect(run(CLOSED, openChangedEvent(false, "pointer"), MENU_OUTSIDE_INTERACTED, MENU_CLOSE_AUTOFOCUS)).toBe(CLOSED)
    expect(run(opened, MENU_CLOSE_AUTOFOCUS)).toBe(opened)
    expect(run(opened, MENU_OUTSIDE_INTERACTED, MENU_OUTSIDE_INTERACTED)).toBe(run(opened, MENU_OUTSIDE_INTERACTED))
    expect(Object.isFrozen(opened)).toBe(true)
  })

  test("disposing ignores later events", () => {
    const disposed = run(CLOSED, openChangedEvent(true, "pointer"), MENU_DISPOSED)

    expect(disposed).toEqual({ status: "disposed" })
    expect(run(disposed, openChangedEvent(true, "pointer"), MENU_CLOSE_AUTOFOCUS)).toBe(disposed)
  })
})
