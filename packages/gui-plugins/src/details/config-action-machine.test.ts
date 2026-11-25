import { describe, expect, test } from "bun:test"
import {
  CONFIG_ACTION_TIMEOUT_MS,
  CONFIG_COPIED_MS,
  configActionView,
  initialConfigActionState,
  transitionConfigAction,
  type ConfigActionEvent,
  type ConfigActionState,
  type ConfigActionTransition,
} from "./config-action-machine"

// Folds the events in order and returns the last transition.
const replay = (events: readonly ConfigActionEvent[], state: ConfigActionState = initialConfigActionState) =>
  events.reduce<ConfigActionTransition>((last, event) => transitionConfigAction(last.state, event), {
    state,
    effects: [],
  })

describe("transitionConfigAction", () => {
  test("a copy moves from opening to copied in one step and expires", () => {
    const opening = transitionConfigAction(initialConfigActionState, { type: "activate" })

    expect(opening.effects).toEqual([{ type: "run", attempt: 1, timeoutMs: CONFIG_ACTION_TIMEOUT_MS }])
    expect(configActionView(opening.state)).toEqual({ disabled: true, copied: false })

    const copied = transitionConfigAction(opening.state, { type: "copied", attempt: 1 })

    expect(copied.effects).toEqual([
      { type: "abort", attempt: 1 },
      { type: "schedule-reset", attempt: 1, delayMs: CONFIG_COPIED_MS },
    ])
    expect(configActionView(copied.state)).toEqual({ disabled: false, copied: true })

    const expired = transitionConfigAction(copied.state, { type: "copied.expired", attempt: 1 })

    expect(expired.state).toEqual({ status: "idle", issued: 1 })
  })

  test("copying again restarts and ignores the first copy's reset", () => {
    const again = replay([{ type: "activate" }, { type: "copied", attempt: 1 }, { type: "activate" }])

    expect(again.state).toEqual({ status: "opening", attempt: 2 })
    expect(again.effects).toEqual([
      { type: "cancel-reset" },
      { type: "run", attempt: 2, timeoutMs: CONFIG_ACTION_TIMEOUT_MS },
    ])
    expect(transitionConfigAction(again.state, { type: "copied.expired", attempt: 1 }).state).toBe(again.state)
  })

  test("a second click while the action runs starts nothing", () => {
    const opening = transitionConfigAction(initialConfigActionState, { type: "activate" }).state

    expect(transitionConfigAction(opening, { type: "activate" })).toEqual({ state: opening, effects: [] })
  })

  test("hiding the popover drops the copied mark", () => {
    const copied = replay([{ type: "activate" }, { type: "copied", attempt: 1 }]).state
    const hidden = transitionConfigAction(copied, { type: "hidden" })

    expect(hidden).toEqual({ state: { status: "idle", issued: 1 }, effects: [{ type: "cancel-reset" }] })

    const opening = transitionConfigAction(initialConfigActionState, { type: "activate" }).state

    expect(transitionConfigAction(opening, { type: "hidden" }).state).toBe(opening)
  })

  test("an opened file closes the popover only when a side tab replaced it", () => {
    const tab = replay([{ type: "activate" }, { type: "opened", attempt: 1, close: true }])

    expect(tab).toEqual({
      state: { status: "idle", issued: 1 },
      effects: [{ type: "abort", attempt: 1 }, { type: "close-owner" }],
    })

    const revealed = replay([{ type: "activate" }, { type: "opened", attempt: 1, close: false }])

    expect(revealed.effects).toEqual([{ type: "abort", attempt: 1 }])
  })

  test("a failure or a timeout ends the action with a toast", () => {
    const failed = replay([{ type: "activate" }, { type: "failed", attempt: 1, error: "No configuration file found" }])

    expect(failed).toEqual({
      state: { status: "idle", issued: 1 },
      effects: [
        { type: "abort", attempt: 1 },
        { type: "toast-failed", error: "No configuration file found" },
      ],
    })

    const timedOut = replay([{ type: "activate" }, { type: "timed-out", attempt: 1 }])

    expect(timedOut.effects).toEqual([{ type: "abort", attempt: 1 }, { type: "toast-timed-out" }])

    // The request that hung settles later and changes nothing.
    expect(transitionConfigAction(timedOut.state, { type: "copied", attempt: 1 }).state).toBe(timedOut.state)
  })

  test("disposal aborts the running action and ignores its result", () => {
    const disposed = replay([{ type: "activate" }, { type: "disposed" }])

    expect(disposed).toEqual({ state: { status: "disposed" }, effects: [{ type: "abort", attempt: 1 }] })

    for (const event of [
      { type: "opened", attempt: 1, close: true },
      { type: "copied", attempt: 1 },
      { type: "failed", attempt: 1, error: "late" },
      { type: "activate" },
    ] satisfies ConfigActionEvent[])
      expect(transitionConfigAction(disposed.state, event).state).toBe(disposed.state)

    const copied = replay([{ type: "activate" }, { type: "copied", attempt: 1 }, { type: "disposed" }])

    expect(copied.effects).toEqual([{ type: "cancel-reset" }])
  })
})
