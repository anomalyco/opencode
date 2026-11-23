import { describe, expect, test } from "bun:test"
import {
  createPairingMainState,
  pairingMainEffectFailed,
  selectBlocker,
  SERVICE_READ_TIMEOUT_MS,
  SERVICE_SET_TIMEOUT_MS,
  SERVICE_START_TIMEOUT_MS,
  transitionPairingMain,
  type PairingMainEffect,
  type PairingMainEvent,
  type PairingMainState,
} from "./main-machine"

function replay(state: PairingMainState, events: readonly PairingMainEvent[]) {
  return events.reduce<{ state: PairingMainState; effects: PairingMainEffect[] }>(
    (result, event) => {
      const next = transitionPairingMain(result.state, event)

      return { state: next.state, effects: [...result.effects, ...next.effects] }
    },
    { state, effects: [] },
  )
}

const execs = (effects: readonly PairingMainEffect[]) =>
  effects.flatMap((effect) => (effect.type === "service.exec" ? [effect.args.join(" ")] : []))

describe("pairing display blocker", () => {
  test("a blocker the OS dropped starts again when the setting turns on", () => {
    const held = replay(createPairingMainState(), [
      { type: "screen.set", enabled: true, started: false },
      { type: "blocker.started", id: 7 },
    ])

    expect(held.effects).toEqual([{ type: "blocker.start" }, { type: "persist.screen", enabled: true }])
    expect(selectBlocker(held.state)).toBe(7)

    // The OS dropped blocker 7, so the switch shows off and the user turns it on.
    const again = transitionPairingMain(held.state, { type: "screen.set", enabled: true, started: false })
    expect(again.effects).toEqual([{ type: "blocker.start" }, { type: "persist.screen", enabled: true }])
    expect(selectBlocker(again.state)).toBeUndefined()

    const kept = transitionPairingMain(held.state, { type: "screen.set", enabled: true, started: true })
    expect(kept.state).toBe(held.state)
    expect(kept.effects).toEqual([{ type: "persist.screen", enabled: true }])
  })

  test("turning the setting off stops the blocker", () => {
    const held = replay(createPairingMainState(), [
      { type: "screen.set", enabled: true, started: false },
      { type: "blocker.started", id: 7 },
    ]).state

    const off = transitionPairingMain(held, { type: "screen.set", enabled: false, started: true })
    expect(off.effects).toEqual([
      { type: "blocker.stop", id: 7 },
      { type: "persist.screen", enabled: false },
    ])
    expect(selectBlocker(off.state)).toBeUndefined()
  })
})

describe("pairing service queue", () => {
  test("a change sets and starts the service before a read runs", () => {
    const result = replay(createPairingMainState(), [
      { type: "service.requested", waiter: 1, request: { kind: "set-remote", enabled: true } },
      { type: "service.requested", waiter: 2, request: { kind: "get-remote" } },
      { type: "service.succeeded", attempt: 1, stdout: "" },
      { type: "service.succeeded", attempt: 2, stdout: "" },
      { type: "service.succeeded", attempt: 3, stdout: "true" },
    ])

    expect(execs(result.effects)).toEqual(["set remote true", "start", "get remote"])
    expect(result.effects).toContainEqual({
      type: "service.exec",
      attempt: 1,
      args: ["set", "remote", "true"],
      timeoutMs: SERVICE_SET_TIMEOUT_MS,
    })
    expect(result.effects).toContainEqual({
      type: "service.exec",
      attempt: 2,
      args: ["start"],
      timeoutMs: SERVICE_START_TIMEOUT_MS,
    })
    expect(result.effects).toContainEqual({
      type: "service.exec",
      attempt: 3,
      args: ["get", "remote"],
      timeoutMs: SERVICE_READ_TIMEOUT_MS,
    })
    expect(result.effects.filter((effect) => effect.type === "waiter.resolve")).toEqual([
      { type: "waiter.resolve", waiter: 1, value: undefined },
      { type: "waiter.resolve", waiter: 2, value: true },
    ])
  })

  test("a command that fails, times out or throws ends its job and the next one runs", () => {
    const queued = replay(createPairingMainState(), [
      { type: "service.requested", waiter: 1, request: { kind: "set-remote", enabled: false } },
      { type: "service.requested", waiter: 2, request: { kind: "get-remote" } },
    ])

    const exec = queued.effects[0]

    if (exec?.type !== "service.exec") throw new Error("expected a command")

    const thrown = pairingMainEffectFailed(exec)

    if (!thrown) throw new Error("expected a failure event")

    const failures: PairingMainEvent[] = [
      { type: "service.failed", attempt: 1, message: "Command failed: timed out" },
      thrown,
    ]

    failures.forEach((failure) => {
      const next = transitionPairingMain(queued.state, failure)

      expect(next.effects[0]).toMatchObject({ type: "waiter.reject", waiter: 1 })
      expect(execs(next.effects)).toEqual(["get remote"])
    })

    // The `start` step fails the same way.
    const starting = transitionPairingMain(queued.state, { type: "service.succeeded", attempt: 1, stdout: "" }).state
    const next = transitionPairingMain(starting, { type: "service.failed", attempt: 2, message: "boom" })
    expect(next.effects[0]).toEqual({ type: "waiter.reject", waiter: 1, message: "boom" })
    expect(execs(next.effects)).toEqual(["get remote"])
  })

  test("a read whose caller went away stops, a change goes on", () => {
    const queued = replay(createPairingMainState(), [
      { type: "service.requested", waiter: 1, request: { kind: "get-remote" } },
      { type: "service.requested", waiter: 2, request: { kind: "get-remote" } },
      { type: "service.requested", waiter: 3, request: { kind: "set-remote", enabled: true } },
    ]).state

    const pending = transitionPairingMain(queued, { type: "waiter.cancelled", waiter: 2 })
    expect(pending.effects).toEqual([{ type: "waiter.reject", waiter: 2, message: "Aborted" }])

    const active = transitionPairingMain(pending.state, { type: "waiter.cancelled", waiter: 1 })
    expect(active.effects).toEqual([
      { type: "service.abort", attempt: 1 },
      { type: "waiter.reject", waiter: 1, message: "Aborted" },
      { type: "service.exec", attempt: 2, args: ["set", "remote", "true"], timeoutMs: SERVICE_SET_TIMEOUT_MS },
    ])

    expect(transitionPairingMain(active.state, { type: "waiter.cancelled", waiter: 3 }).state).toBe(active.state)
    // The aborted read's late result is stale.
    expect(transitionPairingMain(active.state, { type: "service.succeeded", attempt: 1, stdout: "true" }).state).toBe(
      active.state,
    )
  })

  test("disposing stops the blocker and the command and rejects every caller", () => {
    const open = replay(createPairingMainState(), [
      { type: "screen.set", enabled: true, started: false },
      { type: "blocker.started", id: 7 },
      { type: "service.requested", waiter: 1, request: { kind: "get-remote" } },
      { type: "service.requested", waiter: 2, request: { kind: "set-remote", enabled: true } },
    ]).state

    const disposed = transitionPairingMain(open, { type: "disposed" })
    expect(disposed.effects).toEqual([
      { type: "blocker.stop", id: 7 },
      { type: "service.abort", attempt: 1 },
      { type: "waiter.reject", waiter: 1, message: "Pairing stopped" },
      { type: "waiter.reject", waiter: 2, message: "Pairing stopped" },
    ])

    expect(transitionPairingMain(disposed.state, { type: "blocker.started", id: 8 }).effects).toEqual([
      { type: "blocker.stop", id: 8 },
    ])
    expect(
      transitionPairingMain(disposed.state, { type: "service.requested", waiter: 3, request: { kind: "get-remote" } })
        .effects,
    ).toEqual([{ type: "waiter.reject", waiter: 3, message: "Pairing stopped" }])
  })
})
