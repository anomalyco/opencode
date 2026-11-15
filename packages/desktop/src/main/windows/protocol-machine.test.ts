import { describe, expect, test } from "bun:test"
import {
  createProtocolBurstState,
  isProtocolBurstSettled,
  transitionProtocolBurst,
  type ProtocolBurstCommand,
  type ProtocolBurstEvent,
  type ProtocolBurstState,
} from "./protocol-machine"

const reply = () => {}

const wait: ProtocolBurstEvent = { type: "wait.requested", quietMs: 40, capMs: 400, reply }

const started: ProtocolBurstEvent = { type: "request.started" }

const finished: ProtocolBurstEvent = { type: "request.finished" }

const cap: ProtocolBurstCommand = { type: "start-cap-timer", delayMs: 400 }

const resolved: ProtocolBurstCommand[] = [{ type: "clear-timers" }, { type: "resolve", replies: [reply] }]

// Folds events through the machine and keeps the commands of each step.
function replay(events: readonly ProtocolBurstEvent[], from: ProtocolBurstState = createProtocolBurstState()) {
  return events.reduce<{ state: ProtocolBurstState; commands: (readonly ProtocolBurstCommand[])[] }>(
    (result, event) => {
      const next = transitionProtocolBurst(result.state, event)

      return { state: next.state, commands: [...result.commands, next.commands] }
    },
    { state: from, commands: [] },
  )
}

describe("renderer asset burst", () => {
  test("waits a quiet window after a slow HTML read before the bundle loads", () => {
    // On dev the quiet window counted from the request's start, so an index.html read of 40 ms or more resolved the
    // moment it finished, before the renderer could ask for the scripts it names.
    const run = replay([wait, started, finished, started])

    expect(run.commands).toEqual([
      [cap],
      [],
      [{ type: "start-quiet-timer", attempt: 1, delayMs: 40 }],
      [{ type: "cancel-quiet-timer" }],
    ])
    expect(run.state.status).toBe("serving")
  })

  test("settles once the last wave of requests has been quiet", () => {
    const run = replay([
      wait,
      started,
      finished,
      started,
      started,
      finished,
      finished,
      { type: "quiet.elapsed", attempt: 2 },
    ])

    expect(run.commands.slice(-2)).toEqual([[{ type: "start-quiet-timer", attempt: 2, delayMs: 40 }], resolved])
    expect(isProtocolBurstSettled(run.state)).toBe(true)
  })

  test("ignores the quiet timer of a window a new request interrupted", () => {
    const quiet = replay([wait, started, finished, started, finished]).state
    const stale = transitionProtocolBurst(quiet, { type: "quiet.elapsed", attempt: 1 })

    expect(stale.state).toBe(quiet)
    expect(stale.commands).toEqual([])
  })

  test("starts from where the burst stands when the wait begins", () => {
    expect(replay([started, wait]).state).toMatchObject({ status: "serving", inflight: 1 })
    expect(replay([started, finished, wait]).commands.at(-1)).toEqual([
      cap,
      { type: "start-quiet-timer", attempt: 1, delayMs: 40 },
    ])
    expect(replay([wait]).state.status).toBe("awaiting-first")
  })

  test.each([
    ["the renderer never asks", [wait]],
    ["the burst never goes quiet", [wait, started]],
    ["the quiet window never elapses", [wait, started, finished]],
  ] satisfies [string, ProtocolBurstEvent[]][])("loads the bundle at the cap when %s", (_name, events) => {
    const run = replay([...events, { type: "cap.elapsed" }])

    expect(run.commands.at(-1)).toEqual(resolved)
    expect(isProtocolBurstSettled(run.state)).toBe(true)
  })

  test.each([
    ["waiting for the first request", [wait]],
    ["serving", [wait, started]],
    ["quiet", [wait, started, finished]],
  ] satisfies [string, ProtocolBurstEvent[]][])(
    "stops waiting at once when the first window closes while %s",
    (_name, events) => {
      // On dev a 5 ms poll kept running until the cap after the window closed.
      const run = replay([...events, { type: "cancelled" }])

      expect(run.commands.at(-1)).toEqual(resolved)
      expect(isProtocolBurstSettled(run.state)).toBe(true)
    },
  )

  test("stops tracking requests once settled and answers a late wait at once", () => {
    const settled = replay([wait, { type: "cap.elapsed" }]).state
    const late = () => {}

    expect(transitionProtocolBurst(settled, started).state).toBe(settled)
    expect(transitionProtocolBurst(settled, finished).state).toBe(settled)
    expect(transitionProtocolBurst(settled, { type: "quiet.elapsed", attempt: 1 }).commands).toEqual([])
    expect(transitionProtocolBurst(settled, { ...wait, reply: late }).commands).toEqual([
      { type: "resolve", replies: [late] },
    ])
  })
})
