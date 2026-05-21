import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { SessionID } from "../../src/session/schema"
import { SessionRunState } from "../../src/session/run-state"
import { SessionStatus } from "../../src/session/status"
import { testEffect } from "../lib/effect"

const it = testEffect(
  Layer.mergeAll(SessionStatus.defaultLayer, SessionRunState.defaultLayer, CrossSpawnSpawner.defaultLayer),
)

it.instance("reconcile resets a stale busy session with no active runner", () =>
  Effect.gen(function* () {
    const status = yield* SessionStatus.Service
    const runState = yield* SessionRunState.Service
    const sessionID = SessionID.make("reconcile_stale_busy")

    yield* status.set(sessionID, { type: "busy" })
    expect((yield* status.get(sessionID)).type).toBe("busy")

    yield* runState.reconcile()

    expect((yield* status.get(sessionID)).type).toBe("idle")
  }),
)

it.instance("reconcile resets a stale retry session with no active runner", () =>
  Effect.gen(function* () {
    const status = yield* SessionStatus.Service
    const runState = yield* SessionRunState.Service
    const sessionID = SessionID.make("reconcile_stale_retry")

    yield* status.set(sessionID, {
      type: "retry",
      attempt: 3,
      message: "rate limited",
      next: Date.now() + 60_000,
    })
    expect((yield* status.get(sessionID)).type).toBe("retry")

    yield* runState.reconcile()

    expect((yield* status.get(sessionID)).type).toBe("idle")
  }),
)

it.instance("reconcile leaves idle sessions unchanged", () =>
  Effect.gen(function* () {
    const status = yield* SessionStatus.Service
    const runState = yield* SessionRunState.Service
    const sessionID = SessionID.make("reconcile_idle")

    // an idle status has no entry in the map; reconcile() should still complete cleanly
    expect((yield* status.get(sessionID)).type).toBe("idle")

    yield* runState.reconcile()

    expect((yield* status.get(sessionID)).type).toBe("idle")
  }),
)
