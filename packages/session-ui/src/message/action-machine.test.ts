import { describe, expect, test } from "bun:test"
import {
  createMessageActionState,
  transitionMessageAction,
  viewMessageActions,
  type MessageActionCapabilities,
  type MessageActionEvent,
  type MessageActionState,
} from "./action-machine"

const offered = { canPending: true, canRevert: true, canFork: true }

const steer: MessageActionCapabilities = { ...offered, pending: true }

const delivered: MessageActionCapabilities = { ...offered, pending: false }

function replay(events: MessageActionEvent[], state = createMessageActionState()) {
  return events.reduce<MessageActionState>((current, event) => transitionMessageAction(current, event).state, state)
}

describe("transitionMessageAction", () => {
  test("a failed pending-steer action leaves both pending-steer buttons usable", () => {
    const started = transitionMessageAction(createMessageActionState(), {
      type: "requested",
      action: "queue",
      capabilities: steer,
    })

    expect(started.effects).toEqual([{ type: "run", action: "queue", attempt: 1 }])
    expect(viewMessageActions(started.state, steer).disabled).toMatchObject({ queue: true, remove: true })

    const failed = transitionMessageAction(started.state, { type: "failed", attempt: 1 })

    expect(failed.state).toEqual({ status: "idle", attempts: 1 })
    expect(viewMessageActions(failed.state, steer).disabled).toMatchObject({ queue: false, remove: false })
    expect(transitionMessageAction(failed.state, { type: "requested", action: "remove", capabilities: steer })).toEqual(
      {
        state: { status: "running", action: "remove", attempt: 2 },
        effects: [{ type: "run", action: "remove", attempt: 2 }],
      },
    )
  })

  test.each([
    ["revert", "fork"],
    ["fork", "revert"],
  ] as const)("a running %s blocks %s until it settles", (first, second) => {
    const running = replay([{ type: "requested", action: first, capabilities: delivered }])

    expect(viewMessageActions(running, delivered).disabled).toMatchObject({ revert: true, fork: true })

    const blocked = transitionMessageAction(running, { type: "requested", action: second, capabilities: delivered })

    expect(blocked.state).toBe(running)
    expect(blocked.effects).toEqual([])

    const settled = replay([{ type: "succeeded", attempt: 1 }], running)

    expect(viewMessageActions(settled, delivered).disabled).toMatchObject({ revert: false, fork: false })
  })

  test("keeps the lock when a pending steer is delivered mid-request", () => {
    const running = replay([{ type: "requested", action: "queue", capabilities: steer }])

    expect(viewMessageActions(running, delivered).disabled).toMatchObject({ revert: true, fork: true })
    expect(
      transitionMessageAction(running, { type: "requested", action: "revert", capabilities: delivered }).state,
    ).toBe(running)
  })

  test.each([
    ["queue", delivered],
    ["remove", delivered],
    ["queue", { ...steer, canPending: false }],
    ["revert", steer],
    ["revert", { ...delivered, canRevert: false }],
    ["fork", steer],
    ["fork", { ...delivered, canFork: false }],
  ] as const)("ignores %s when the message cannot take it", (action, capabilities) => {
    const state = createMessageActionState()
    const result = transitionMessageAction(state, { type: "requested", action, capabilities })

    expect(result.state).toBe(state)
    expect(result.effects).toEqual([])
    expect(viewMessageActions(state, capabilities).disabled[action]).toBe(true)
  })

  test("rejects a result from an earlier attempt", () => {
    const running = replay([
      { type: "requested", action: "revert", capabilities: delivered },
      { type: "succeeded", attempt: 1 },
      { type: "requested", action: "fork", capabilities: delivered },
    ])

    expect(running).toEqual({ status: "running", action: "fork", attempt: 2 })
    expect(transitionMessageAction(running, { type: "failed", attempt: 1 }).state).toBe(running)
    expect(transitionMessageAction(running, { type: "succeeded", attempt: 1 }).state).toBe(running)
  })

  test("settles on dispose and ignores the late result", () => {
    const disposed = replay([{ type: "requested", action: "fork", capabilities: delivered }, { type: "disposed" }])

    expect(disposed).toEqual({ status: "idle", attempts: 1 })
    expect(transitionMessageAction(disposed, { type: "succeeded", attempt: 1 }).state).toBe(disposed)
    expect(transitionMessageAction(disposed, { type: "failed", attempt: 1 }).state).toBe(disposed)
  })
})
