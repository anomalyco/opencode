import { describe, expect, test } from "bun:test"
import {
  initialForceFocusState,
  transitionForceFocus,
  type ForceFocusCommand,
  type ForceFocusEvent,
  type ForceFocusReply,
  type ForceFocusState,
} from "./force-focus-machine"

const names = new Map<ForceFocusReply, string>()

function request(name: string, enabled: boolean): ForceFocusEvent {
  const reply = { resolve: () => undefined, reject: () => undefined }
  names.set(reply, name)

  return { type: "request", request: { enabled, reply } }
}

// Names each reply so a step reads as which requests resolved and which were rejected, and why.
function readable(command: ForceFocusCommand) {
  if (command.type !== "settle") return command
  const replies = command.replies.map((reply) => names.get(reply))

  if (!command.error) return { type: "resolve", replies }

  return { type: "reject", replies, error: command.error.message }
}

// Folds events through the machine and keeps the readable commands of each step.
function replay(events: readonly ForceFocusEvent[], from = initialForceFocusState) {
  return events.reduce<{ state: ForceFocusState; commands: ReturnType<typeof readable>[][] }>(
    (result, event) => {
      const next = transitionForceFocus(result.state, event)

      return { state: next.state, commands: [...result.commands, next.commands.map(readable)] }
    },
    { state: from, commands: [] },
  )
}

const failure = new Error("DOM.enable failed")

describe("force focus debugger", () => {
  test("turning off while turning on waits for the enable instead of detaching under it", () => {
    // On dev the second call found no forced nodes yet and detached the debugger under the running enable.
    const run = replay([
      request("on", true),
      { type: "debugger.attached", attempt: 1 },
      request("off", false),
      { type: "enable.succeeded", attempt: 1, nodeIds: [10, 11] },
      { type: "disable.settled", attempt: 2 },
    ])

    expect(run.commands).toEqual([
      [{ type: "enable", attempt: 1 }],
      [],
      [],
      [
        { type: "resolve", replies: ["on"] },
        { type: "disable", attempt: 2, owned: true, nodeIds: [10, 11] },
      ],
      [{ type: "cancel-timer" }, { type: "resolve", replies: ["off"] }],
    ])
    expect(run.state).toEqual({ status: "off", attempt: 2 })
  })

  test("a failed enable detaches the debugger it attached", () => {
    // On dev a CDP failure after attach left the debugger attached.
    const owned = replay([
      request("on", true),
      { type: "debugger.attached", attempt: 1 },
      { type: "enable.failed", attempt: 1, error: failure },
    ])

    expect(owned.commands.at(-1)).toEqual([
      { type: "cancel-timer" },
      { type: "detach" },
      { type: "reject", replies: ["on"], error: failure.message },
    ])
    expect(owned.state).toEqual({ status: "off", attempt: 1 })

    // Another client attached the debugger first, so it stays attached.
    const external = replay([request("on", true), { type: "enable.failed", attempt: 1, error: failure }])

    expect(external.commands.at(-1)).toEqual([
      { type: "cancel-timer" },
      { type: "reject", replies: ["on"], error: failure.message },
    ])
  })

  test("a failed enable clears the nodes an earlier enable forced on a debugger it does not own", () => {
    const on = replay([request("first", true), { type: "enable.succeeded", attempt: 1, nodeIds: [4] }]).state
    const run = replay([request("again", true), { type: "enable.failed", attempt: 2, error: failure }], on)

    expect(run.commands.at(-1)).toEqual([
      { type: "reject", replies: ["again"], error: failure.message },
      { type: "disable", attempt: 3, owned: false, nodeIds: [4] },
    ])
    expect(replay([{ type: "disable.settled", attempt: 3 }], run.state).state).toEqual({ status: "off", attempt: 3 })
  })

  test("on, off and on again while enabling settles on without another command", () => {
    const requests = [request("a", true), request("b", false), request("c", true)]
    const succeeded = replay([...requests, { type: "enable.succeeded", attempt: 1, nodeIds: [5] }])

    expect(succeeded.commands.at(-1)).toEqual([{ type: "cancel-timer" }, { type: "resolve", replies: ["a", "b", "c"] }])
    expect(succeeded.state).toEqual({ status: "on", attempt: 1, owned: false, nodeIds: [5] })

    const failed = replay([...requests, { type: "enable.failed", attempt: 1, error: failure }])

    expect(failed.commands.at(-1)).toEqual([
      { type: "cancel-timer" },
      { type: "resolve", replies: ["b"] },
      { type: "reject", replies: ["a", "c"], error: failure.message },
    ])
  })

  test("turning on while turning off enables again once the disable settles", () => {
    const on = replay([request("on", true), { type: "enable.succeeded", attempt: 1, nodeIds: [1] }]).state
    const run = replay([request("off", false), request("back", true), { type: "disable.settled", attempt: 2 }], on)

    expect(run.commands).toEqual([
      [{ type: "disable", attempt: 2, owned: false, nodeIds: [1] }],
      [],
      [
        { type: "resolve", replies: ["off"] },
        { type: "enable", attempt: 3 },
      ],
    ])
    expect(run.state).toMatchObject({ status: "enabling", attempt: 3, owned: false, nodeIds: [], desired: true })
  })

  test("a timed out command rolls back and answers every request", () => {
    const enabling = replay([request("on", true), { type: "debugger.attached", attempt: 1 }, request("off", false)])
    const timedOut = replay([{ type: "timed-out", attempt: 1 }], enabling.state)

    expect(timedOut.commands).toEqual([
      [
        { type: "cancel-timer" },
        { type: "detach" },
        { type: "resolve", replies: ["off"] },
        { type: "reject", replies: ["on"], error: "Timed out forcing focus styles" },
      ],
    ])
    expect(timedOut.state).toEqual({ status: "off", attempt: 1 })

    const on = replay([
      request("on", true),
      { type: "debugger.attached", attempt: 1 },
      { type: "enable.succeeded", attempt: 1, nodeIds: [] },
    ])

    const disabling = replay([request("off", false), { type: "timed-out", attempt: 2 }], on.state)

    expect(disabling.commands.at(-1)).toEqual([
      { type: "cancel-timer" },
      { type: "detach" },
      { type: "resolve", replies: ["off"] },
    ])
  })

  test("ignores results of other attempts", () => {
    const enabling = replay([request("on", true)]).state

    const events: ForceFocusEvent[] = [
      { type: "debugger.attached", attempt: 2 },
      { type: "enable.succeeded", attempt: 0, nodeIds: [1] },
      { type: "enable.failed", attempt: 2, error: failure },
      { type: "disable.settled", attempt: 1 },
      { type: "timed-out", attempt: 2 },
    ]

    events.forEach((event) => expect(transitionForceFocus(enabling, event)).toEqual({ state: enabling, commands: [] }))
    expect(transitionForceFocus(initialForceFocusState, { type: "timed-out", attempt: 0 }).state).toBe(
      initialForceFocusState,
    )
  })

  test("an external detach ends force focus", () => {
    const on = replay([request("on", true), { type: "enable.succeeded", attempt: 1, nodeIds: [1] }]).state

    expect(replay([{ type: "debugger.detached" }], on).state).toEqual({ status: "off", attempt: 1 })

    const enabling = replay([request("on", true), request("off", false), { type: "debugger.detached" }])

    expect(enabling.commands.at(-1)).toEqual([
      { type: "cancel-timer" },
      { type: "resolve", replies: ["off"] },
      { type: "reject", replies: ["on"], error: "Debugger detached" },
    ])

    // The detach finishes the running disable; its own late result changes nothing.
    const disabling = replay(
      [request("off", false), { type: "debugger.detached" }, { type: "disable.settled", attempt: 2 }],
      on,
    )

    expect(disabling.commands.slice(1)).toEqual([[{ type: "cancel-timer" }, { type: "resolve", replies: ["off"] }], []])
  })

  test("a closed window answers pending and later requests", () => {
    const closed = replay([request("on", true), request("off", false), { type: "destroyed" }])

    expect(closed.commands.at(-1)).toEqual([
      { type: "cancel-timer" },
      { type: "resolve", replies: ["off"] },
      { type: "reject", replies: ["on"], error: "Window closed" },
    ])
    expect(closed.state).toEqual({ status: "disposed" })

    const late = replay([request("late on", true), request("late off", false)], closed.state)

    expect(late.commands).toEqual([
      [{ type: "reject", replies: ["late on"], error: "Window closed" }],
      [{ type: "resolve", replies: ["late off"] }],
    ])
    expect(late.state).toBe(closed.state)
  })
})
