import { InstanceState } from "@/effect/instance-state"
import { Runner } from "@/effect/runner"
import { Effect, Latch, Layer, Scope, Context } from "effect"
import * as Session from "./session"
import { MessageV2 } from "./message-v2"
import { SessionID } from "./schema"
import { SessionStatus } from "./status"

// Module-level runners map. Effect Layer wiring rebuilds SessionRunState's
// per-instance state across multiple sites (Layer.provide(SessionRunState.defaultLayer)
// in app-runtime, httpapi server, prompt.ts, revert.ts), each producing an
// independent runners map under the same directory. With multiple maps, two
// concurrent prompts on the same sessionID hit different maps, ensureRunning
// sees Idle on each, and two generation fibers run in parallel writing
// duplicate assistant messages under one user message. Hoisting the map to
// module scope ensures sessionID-level locking is process-wide.
const sharedRunners = new Map<SessionID, Runner.Runner<MessageV2.WithParts>>()

export interface Interface {
  readonly assertNotBusy: (sessionID: SessionID) => Effect.Effect<void>
  readonly cancel: (sessionID: SessionID) => Effect.Effect<void>
  readonly ensureRunning: (
    sessionID: SessionID,
    onInterrupt: Effect.Effect<MessageV2.WithParts>,
    work: Effect.Effect<MessageV2.WithParts>,
  ) => Effect.Effect<MessageV2.WithParts>
  readonly startShell: (
    sessionID: SessionID,
    onInterrupt: Effect.Effect<MessageV2.WithParts>,
    work: Effect.Effect<MessageV2.WithParts>,
    ready?: Latch.Latch,
  ) => Effect.Effect<MessageV2.WithParts>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionRunState") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const status = yield* SessionStatus.Service

    const state = yield* InstanceState.make(
      Effect.fn("SessionRunState.state")(function* () {
        const scope = yield* Scope.Scope
        const __id = Math.random().toString(36).slice(2, 8)
        yield* Effect.logInfo(`SessionRunState.state init mapId=${__id} sharedRunners.size=${sharedRunners.size}`)
        yield* Effect.addFinalizer(
          Effect.fnUntraced(function* () {
            yield* Effect.logInfo(
              `SessionRunState.state finalize mapId=${__id} sharedRunners.size=${sharedRunners.size}`,
            )
            // Do NOT clear sharedRunners here — other layer instances may still use it.
            // Active runners that belong to this scope will be cancelled by their own
            // fiber's scope finalizers.
          }),
        )
        return { runners: sharedRunners, scope, __id }
      }),
    )

    const runner = Effect.fn("SessionRunState.runner")(function* (
      sessionID: SessionID,
      onInterrupt: Effect.Effect<MessageV2.WithParts>,
    ) {
      const data = yield* InstanceState.get(state)
      const mapId = (data as { __id?: string }).__id ?? "?"
      const existing = data.runners.get(sessionID)
      if (existing) {
        yield* Effect.logInfo(
          `SessionRunState.runner reuse sid=${sessionID} mapId=${mapId} mapSize=${data.runners.size} stateTag=${existing.state._tag} busy=${existing.busy}`,
        )
        return existing
      }
      const next = Runner.make<MessageV2.WithParts>(data.scope, {
        onIdle: Effect.gen(function* () {
          data.runners.delete(sessionID)
          yield* status.set(sessionID, { type: "idle" })
        }),
        onBusy: status.set(sessionID, { type: "busy" }),
        onInterrupt,
        busy: () => {
          throw new Session.BusyError(sessionID)
        },
      })
      data.runners.set(sessionID, next)
      yield* Effect.logInfo(
        `SessionRunState.runner create sid=${sessionID} mapId=${mapId} mapSize=${data.runners.size}`,
      )
      return next
    })

    const assertNotBusy = Effect.fn("SessionRunState.assertNotBusy")(function* (sessionID: SessionID) {
      const data = yield* InstanceState.get(state)
      const existing = data.runners.get(sessionID)
      if (existing?.busy) throw new Session.BusyError(sessionID)
    })

    const cancel = Effect.fn("SessionRunState.cancel")(function* (sessionID: SessionID) {
      const data = yield* InstanceState.get(state)
      const existing = data.runners.get(sessionID)
      if (!existing || !existing.busy) {
        yield* status.set(sessionID, { type: "idle" })
        return
      }
      yield* existing.cancel
    })

    const ensureRunning = Effect.fn("SessionRunState.ensureRunning")(function* (
      sessionID: SessionID,
      onInterrupt: Effect.Effect<MessageV2.WithParts>,
      work: Effect.Effect<MessageV2.WithParts>,
    ) {
      return yield* (yield* runner(sessionID, onInterrupt)).ensureRunning(work)
    })

    const startShell = Effect.fn("SessionRunState.startShell")(function* (
      sessionID: SessionID,
      onInterrupt: Effect.Effect<MessageV2.WithParts>,
      work: Effect.Effect<MessageV2.WithParts>,
      ready?: Latch.Latch,
    ) {
      return yield* (yield* runner(sessionID, onInterrupt)).startShell(work, ready)
    })

    return Service.of({ assertNotBusy, cancel, ensureRunning, startShell })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(SessionStatus.defaultLayer))

export * as SessionRunState from "./run-state"
