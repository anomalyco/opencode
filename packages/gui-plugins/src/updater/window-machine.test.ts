import { describe, expect, test } from "bun:test"
import { updaterAction } from "./action"
import {
  initialWindowUpdater,
  transitionWindowUpdater,
  type WindowUpdaterEffect,
  type WindowUpdaterEvent,
} from "./window-machine"

function replay(events: readonly WindowUpdaterEvent[]) {
  const effects: WindowUpdaterEffect[] = []

  const state = events.reduce((current, event) => {
    const step = transitionWindowUpdater(current, event)
    effects.push(...step.effects)

    return step.state
  }, initialWindowUpdater)

  return { state, effects }
}

const ask = (action: "check" | "install", available = true): WindowUpdaterEvent => ({
  type: "action.requested",
  action,
  available,
})

describe("window updater machine", () => {
  // Checking from the menu and then Settings before main answered used to show two "Checking…" toasts and two results.
  test("a second check joins the one in flight, and the next check after it runs", () => {
    const result = replay([ask("check"), ask("check"), { type: "action.settled", attempt: 1 }, ask("check")])

    expect(result.effects).toEqual([
      { type: "run", action: "check", attempt: 1 },
      { type: "run", action: "check", attempt: 2 },
    ])
    expect(result.state).toEqual({ status: "checking", attempt: 2 })
  })

  test("Settings shows the window's check as running before main reports it", () => {
    const checking = replay([ask("check")]).state

    expect(updaterAction({ status: "idle" }, checking)).toEqual({ label: "action.checking" })
    expect(updaterAction({ status: "idle" }, initialWindowUpdater)).toEqual({ label: "action.checkNow", run: "check" })
  })

  test("an install asked for during a check takes over, and the check's answer settles nothing", () => {
    const result = replay([
      ask("check"),
      ask("install"),
      { type: "action.settled", attempt: 1 },
      ask("install"),
      ask("check"),
    ])

    expect(result.effects).toEqual([
      { type: "run", action: "check", attempt: 1 },
      { type: "run", action: "install", attempt: 2 },
    ])
    expect(result.state).toEqual({ status: "installing", attempt: 2 })
  })

  // A chunk that failed to load used to leave the click unanswered, with an unhandled rejection.
  test("an actions chunk that fails or stalls says so and lets the user try again", () => {
    const result = replay([ask("check"), { type: "action.failed", attempt: 1, message: "chunk" }, ask("check")])

    expect(result.effects).toEqual([
      { type: "run", action: "check", attempt: 1 },
      { type: "toast-failed", message: "chunk" },
      { type: "run", action: "check", attempt: 2 },
    ])
  })

  test("without main's updater a request answers that it failed, unless one already runs", () => {
    expect(replay([ask("check", false)]).effects).toEqual([{ type: "toast-failed" }])
    expect(replay([ask("check"), ask("check", false)]).effects).toEqual([{ type: "run", action: "check", attempt: 1 }])
  })

  test("nothing runs after the window lets the updater go", () => {
    const result = replay([ask("check"), { type: "disposed" }, { type: "action.failed", attempt: 1 }, ask("check")])

    expect(result.state).toEqual({ status: "disposed" })
    expect(result.effects).toEqual([{ type: "run", action: "check", attempt: 1 }])
  })
})
