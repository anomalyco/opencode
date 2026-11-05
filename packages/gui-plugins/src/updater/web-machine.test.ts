import { describe, expect, test } from "bun:test"
import {
  AUTO_CHECK_SPACING_MS,
  initialWebUpdate,
  transitionWebUpdate,
  type WebUpdateEffect,
  type WebUpdateEvent,
  type WebUpdateState,
} from "./web-machine"

// Replays events the way the driver sends them and collects every effect in order.
function replay(events: readonly WebUpdateEvent[]) {
  const effects: WebUpdateEffect[] = []

  const state = events.reduce((current, event) => {
    const step = transitionWebUpdate(current, event)
    effects.push(...step.effects)

    return step.state
  }, initialWebUpdate)

  return { state, effects }
}

const auto = (at: number): WebUpdateEvent => ({ type: "check.requested", manual: false, at })

const manual = (at: number): WebUpdateEvent => ({ type: "check.requested", manual: true, at })

type Report = {
  readonly name: string
  readonly settle: WebUpdateEvent
  readonly status: WebUpdateState["status"]
  readonly effects: WebUpdateEffect[]
}

const reports: readonly Report[] = [
  {
    name: "nothing newer",
    settle: { type: "check.settled", attempt: 1, worker: "none" },
    status: "up-to-date",
    effects: [{ type: "report", result: "up-to-date" }],
  },
  {
    name: "a failed check",
    settle: { type: "check.failed", attempt: 1, message: "offline" },
    status: "error",
    effects: [{ type: "report", result: "failed", message: "offline" }],
  },
]

describe("web update machine", () => {
  test("a build already waiting when the app opens is offered at once", () => {
    // Before, it waited until every window closed, which an installed app rarely does.
    const result = replay([{ type: "registered", worker: "waiting" }])

    expect(result.state.status).toBe("ready")
    expect(result.effects).toEqual([{ type: "announce" }])
  })

  test("a build that downloads in the background is offered once it is installed", () => {
    const result = replay([
      { type: "registered", worker: "none" },
      auto(0),
      { type: "worker.installing" },
      { type: "check.settled", attempt: 1, worker: "installing" },
      { type: "worker.installed" },
    ])

    expect(result.state.status).toBe("ready")
    expect(result.effects).toEqual([{ type: "update", attempt: 1 }, { type: "announce" }])
  })

  test("automatic checks close together ask the server once, and the user's check always runs", () => {
    const result = replay([
      { type: "registered", worker: "none" },
      auto(0),
      { type: "check.settled", attempt: 1, worker: "none" },
      auto(AUTO_CHECK_SPACING_MS - 1),
      manual(AUTO_CHECK_SPACING_MS - 1),
      { type: "check.settled", attempt: 2, worker: "none" },
      auto(2 * AUTO_CHECK_SPACING_MS),
    ])

    expect(result.effects.filter((effect) => effect.type === "update")).toEqual([
      { type: "update", attempt: 1 },
      { type: "update", attempt: 2 },
      { type: "update", attempt: 3 },
    ])
  })

  test.each(reports)("the user's check reports $name; an automatic one stays quiet", (row) => {
    const asked = replay([{ type: "registered", worker: "none" }, manual(0), row.settle])
    const quiet = replay([{ type: "registered", worker: "none" }, auto(0), row.settle])

    expect(asked.state.status).toBe(row.status)
    expect(asked.effects.slice(1)).toEqual(row.effects)
    expect(quiet.state.status).toBe("idle")
    expect(quiet.effects.slice(1)).toEqual([])
  })

  test("a result for an older check is ignored", () => {
    const result = replay([
      { type: "registered", worker: "none" },
      manual(0),
      { type: "check.settled", attempt: 1, worker: "none" },
      manual(1),
      { type: "check.failed", attempt: 1, message: "late" },
    ])

    expect(result.state).toMatchObject({ status: "checking", attempt: 2 })
  })

  test("a download the browser rejects keeps the current build and tells only a user who asked", () => {
    const steps = (first: WebUpdateEvent) => [
      { type: "registered", worker: "none" } as const,
      first,
      { type: "worker.installing" } as const,
      { type: "worker.redundant" } as const,
    ]

    expect(replay(steps(manual(0))).effects.at(-1)).toEqual({ type: "report", result: "failed", message: "" })
    expect(replay(steps(auto(0))).state.status).toBe("idle")
  })

  test("reloading asks the waiting build to take over, then reloads when it does or after a timeout", () => {
    const ready = [{ type: "registered", worker: "waiting" }, { type: "apply.requested" }] as const
    const applying = replay(ready)
    const taken = replay([...ready, { type: "controller.changed" }])
    const timedOut = replay([...ready, { type: "apply.timeout" }])

    expect(applying.state.status).toBe("applying")
    expect(applying.effects.at(-1)).toEqual({ type: "skip-waiting" })
    expect(taken.effects.at(-1)).toEqual({ type: "reload" })
    expect(timedOut.effects.at(-1)).toEqual({ type: "reload" })
  })

  test("another window's update reloads this one, whose old files are gone", () => {
    const result = replay([{ type: "registered", worker: "none" }, { type: "controller.changed" }])

    expect(result).toEqual({ state: { status: "reloading" }, effects: [{ type: "reload" }] })
  })

  test("a reset reloads once from any state and nothing runs after it", () => {
    const result = replay([
      { type: "registered", worker: "waiting" },
      { type: "reset.requested" },
      { type: "controller.changed" },
      manual(0),
      { type: "apply.requested" },
    ])

    expect(result.state).toEqual({ status: "reloading" })
    expect(result.effects).toEqual([{ type: "announce" }, { type: "reset" }])
  })

  test("only the reload action runs while a build is ready; checking again offers it again", () => {
    const result = replay([{ type: "registered", worker: "waiting" }, auto(0), manual(0)])

    expect(result.effects).toEqual([{ type: "announce" }, { type: "announce" }])
  })
})
