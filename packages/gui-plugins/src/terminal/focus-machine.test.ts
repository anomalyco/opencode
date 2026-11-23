import { describe, expect, test } from "bun:test"
import {
  focusRequestToken,
  initialFocusState,
  isFocusRequested,
  transitionFocus,
  type FocusRequestEvent,
  type FocusState,
} from "./focus-machine"

const replay = (events: readonly FocusRequestEvent[], state: FocusState = initialFocusState) =>
  events.reduce(transitionFocus, state)

const pending = (overlay = false): FocusRequestEvent => ({ type: "request.pending", session: "ses_1", overlay })

const target = (id: string, overlay = false): FocusRequestEvent => ({
  type: "request.target",
  session: "ses_1",
  id,
  overlay,
})

const outside: FocusRequestEvent = { type: "focus.moved", into: "outside", leavingOverlay: false }

// The palette or menu that started the request returns focus to where it was opened from as it closes.
const restored: FocusRequestEvent = { type: "focus.moved", into: "outside", leavingOverlay: true }

describe("terminal focus machine", () => {
  test("closing the palette or menu that created a terminal does not cancel its focus", () => {
    const state = replay([pending(true), restored, { type: "pending.resolved", request: 1, id: "pty_1" }])

    expect(isFocusRequested(state, "ses_1", "pty_1")).toBe(true)

    // The terminal can also be created before the overlay returns focus.
    const late = replay([pending(true), { type: "pending.resolved", request: 1, id: "pty_1" }, restored])

    expect(isFocusRequested(late, "ses_1", "pty_1")).toBe(true)
  })

  test("only the overlay's one focus return is exempt; the user moving on cancels", () => {
    expect(replay([pending(true), restored, outside])).toEqual({ status: "idle", request: 1 })
    expect(replay([pending(true), restored, restored])).toEqual({ status: "idle", request: 1 })
    expect(replay([pending(), restored])).toEqual({ status: "idle", request: 1 })
    expect(replay([target("pty_1", true), { type: "pointer.outside" }])).toEqual({ status: "idle", request: 1 })

    // A press outside cancels a terminal still being created, so it opens without taking focus.
    const pressed = replay([
      pending(),
      { type: "pointer.outside" },
      { type: "pending.resolved", request: 1, id: "pty_1" },
    ])

    expect(isFocusRequested(pressed, "ses_1", "pty_1")).toBe(false)
  })

  test("focus moving within the panels keeps the request, unless it enters a field such as a rename", () => {
    const panel = replay([target("pty_1"), { type: "focus.moved", into: "panel", leavingOverlay: false }])

    expect(isFocusRequested(panel, "ses_1", "pty_1")).toBe(true)
    expect(replay([target("pty_1", true), { type: "focus.moved", into: "field", leavingOverlay: true }])).toEqual({
      status: "idle",
      request: 1,
    })
  })

  test("an answer for a request that was cancelled or replaced changes nothing", () => {
    const cancelled = replay([pending(), { type: "cancelled", session: "ses_1" }])
    const replaced = replay([pending(), target("pty_2")])
    const answered = [cancelled, replaced]

    answered.forEach((state) => {
      expect(transitionFocus(state, { type: "pending.resolved", request: 1, id: "pty_1" })).toBe(state)
      expect(transitionFocus(state, { type: "pending.failed", request: 1 })).toBe(state)
    })

    expect(replay([pending(), { type: "pending.failed", request: 1 }])).toEqual({ status: "idle", request: 1 })
  })

  test("asking again for the terminal already asked for keeps the request", () => {
    const state = replay([target("pty_1", true)])

    expect(transitionFocus(state, target("pty_1"))).toBe(state)
    expect(focusRequestToken(transitionFocus(state, target("pty_1")), "ses_1", "pty_1")).toBe(1)

    // A request from an overlay for the same terminal still gets its exemption.
    const plain = replay([target("pty_1")])

    expect(transitionFocus(plain, target("pty_1", true))).toEqual({
      status: "target",
      request: 1,
      session: "ses_1",
      id: "pty_1",
      overlay: true,
    })
    expect(focusRequestToken(transitionFocus(plain, target("pty_2")), "ses_1", "pty_2")).toBe(2)
  })

  // A second new-terminal request joins the create in flight; it used to replace the request, so the create's answer
  // for the first one was stale and the new terminal took no focus.
  test("asking again for a terminal being created keeps the request", () => {
    const state = replay([pending()])

    expect(transitionFocus(state, pending())).toBe(state)
    expect(transitionFocus(state, pending(true))).toEqual({
      status: "pending",
      request: 1,
      session: "ses_1",
      overlay: true,
    })
    expect(
      isFocusRequested(
        replay([pending(), { type: "pending.resolved", request: 1, id: "pty_1" }], state),
        "ses_1",
        "pty_1",
      ),
    ).toBe(true)

    // Once the user moved on, a new request starts again.
    expect(replay([{ type: "cancelled" }, pending()], state)).toEqual({
      status: "pending",
      request: 2,
      session: "ses_1",
      overlay: false,
    })
  })

  test("the terminal taking focus, or a cancel for its session, ends the request", () => {
    const state = replay([target("pty_1")])

    expect(transitionFocus(state, { type: "consumed", session: "ses_1", id: "pty_2" })).toBe(state)
    expect(transitionFocus(state, { type: "consumed", session: "ses_1", id: "pty_1" })).toEqual({
      status: "idle",
      request: 1,
    })
    expect(transitionFocus(state, { type: "cancelled", session: "ses_2" })).toBe(state)
    expect(transitionFocus(state, { type: "cancelled" })).toEqual({ status: "idle", request: 1 })
    expect(transitionFocus(initialFocusState, outside)).toBe(initialFocusState)
  })
})
