import { InstanceState } from "@/effect"
import { Runner } from "@/effect"
import { Effect, Layer, Scope, Context } from "effect"
import * as Session from "./session"
import { MessageV2 } from "./message-v2"
import { SessionID } from "./schema"
import { SessionStatus } from "./status"

export namespace SessionRunState {
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
          const runners = new Map<SessionID, Runner.Runner<MessageV2.WithParts>>()
          yield* Effect.addFinalizer(
            Effect.fnUntraced(function* () {
              yield* Effect.forEach(runners.values(), (runner) => runner.cancel, {
                concurrency: "unbounded",
                discard: true,
              })
              runners.clear()
            }),
          )
          return { runners, scope }
        }),
      )

      const runner = Effect.fn("SessionRunState.runner")(function* (
        sessionID: SessionID,
        onInterrupt: Effect.Effect<MessageV2.WithParts>,
      ) {
        const data = yield* InstanceState.get(state)
        const existing = data.runners.get(sessionID)
        if (existing) return existing
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
      ) {
        return yield* (yield* runner(sessionID, onInterrupt)).startShell(work)
      })

      return Service.of({ assertNotBusy, cancel, ensureRunning, startShell })
    }),
  )

  export const defaultLayer = layer.pipe(Layer.provide(SessionStatus.defaultLayer))
}
