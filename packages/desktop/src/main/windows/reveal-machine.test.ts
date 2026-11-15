import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test"
import {
  createRevealDriver,
  initialRevealState,
  REVEAL_TIMEOUT_MS,
  transitionReveal,
  type RevealCommand,
  type RevealEvent,
  type RevealReason,
  type RevealState,
} from "./reveal-machine"

// Folds events through the machine and keeps the commands of each step.
function replay(events: readonly RevealEvent[], from = initialRevealState(false)) {
  return events.reduce<{ state: RevealState; commands: (readonly RevealCommand[])[] }>(
    (result, event) => {
      const next = transitionReveal(result.state, event)

      return { state: next.state, commands: [...result.commands, next.commands] }
    },
    { state: from, commands: [] },
  )
}

const shown = (reason: RevealReason): RevealCommand[] => [{ type: "cancel-timeout" }, { type: "show", reason }]

const hidden = {
  loading: [],
  "content-ready": [{ type: "content.ready" }],
  "theme-ready": [{ type: "theme.ready" }],
} satisfies Record<string, RevealEvent[]>

describe("window reveal", () => {
  test("shows a window whose theme never arrives once the fallback expires", () => {
    const result = replay([{ type: "content.ready" }, { type: "reveal.timed-out" }, { type: "theme.ready" }])

    expect(result.state.status).toBe("shown")
    expect(result.commands).toEqual([[], shown("timeout"), []])
  })

  test.each(Object.entries(hidden))("shows a %s window before its recovery dialog", (_status, events) => {
    const result = replay([
      ...events,
      { type: "recovery.requested" },
      { type: "reveal.timed-out" },
      { type: "theme.ready" },
    ])

    expect(result.state.status).toBe("shown")
    expect(result.commands.slice(events.length)).toEqual([shown("recovery"), [], []])
  })

  test.each([
    ["content first", [{ type: "content.ready" }, { type: "theme.ready" }]],
    ["theme first", [{ type: "theme.ready" }, { type: "content.ready" }]],
  ] satisfies [string, RevealEvent[]][])("waits for content and theme, %s", (_order, events) => {
    expect(replay(events).commands).toEqual([[], shown("ready")])
  })

  test("ignores the second content readiness Linux reports", () => {
    const ready = transitionReveal(initialRevealState(false), { type: "content.ready" }).state
    const again = transitionReveal(ready, { type: "content.ready" })

    expect(again.state).toBe(ready)
    expect(again.commands).toEqual([])
    expect(transitionReveal(again.state, { type: "theme.ready" }).commands).toEqual(shown("ready"))
  })

  test("never shows the early window again, including after a dev reload", () => {
    const early = initialRevealState(true)

    const result = replay(
      [
        { type: "content.ready" },
        { type: "theme.ready" },
        { type: "reveal.timed-out" },
        { type: "recovery.requested" },
        { type: "theme.ready" },
      ],
      early,
    )

    expect(early.status).toBe("shown")
    expect(result.state).toBe(early)
    expect(result.commands.flat()).toEqual([])
  })

  test.each(Object.entries(hidden))("cancels the fallback when a %s window closes", (_status, events) => {
    const result = replay([...events, { type: "window.closed" }])

    expect(result.state.status).toBe("closed")
    expect(result.commands.at(-1)).toEqual([{ type: "cancel-timeout" }])
  })

  test("ignores every event after the window closes", () => {
    const closed = replay([{ type: "content.ready" }, { type: "theme.ready" }, { type: "window.closed" }])

    const after = replay(
      [
        { type: "content.ready" },
        { type: "theme.ready" },
        { type: "reveal.timed-out" },
        { type: "recovery.requested" },
        { type: "window.closed" },
      ],
      closed.state,
    )

    expect(closed.commands.at(-1)).toEqual([])
    expect(after.state).toBe(closed.state)
    expect(after.commands.flat()).toEqual([])
  })
})

describe("window reveal driver", () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  test("shows a hidden window once when the fallback expires", () => {
    const shows: RevealReason[] = []
    const reveal = createRevealDriver({ early: false, show: (reason) => shows.push(reason) })

    reveal.dispatch({ type: "content.ready" })
    jest.advanceTimersByTime(REVEAL_TIMEOUT_MS - 1)
    expect(shows).toEqual([])

    jest.advanceTimersByTime(1)
    reveal.dispatch({ type: "theme.ready" })
    expect(shows).toEqual(["timeout"])
  })

  test("does not fire the fallback after a ready reveal or a close", () => {
    const shows: RevealReason[] = []
    const ready = createRevealDriver({ early: false, show: (reason) => shows.push(reason) })
    const closed = createRevealDriver({ early: false, show: (reason) => shows.push(reason) })

    ready.dispatch({ type: "theme.ready" })
    ready.dispatch({ type: "content.ready" })
    closed.dispatch({ type: "window.closed" })
    jest.runOnlyPendingTimers()

    expect(shows).toEqual(["ready"])
    expect(jest.getTimerCount()).toBe(0)
  })

  test("arms no fallback for the early window", () => {
    const shows: RevealReason[] = []
    createRevealDriver({ early: true, show: (reason) => shows.push(reason) })

    expect(jest.getTimerCount()).toBe(0)
    expect(shows).toEqual([])
  })
})
