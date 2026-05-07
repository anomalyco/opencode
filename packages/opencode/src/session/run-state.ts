import { InstanceState } from "@/effect/instance-state"
import { Runner } from "@/effect/runner"
import { makeRuntime } from "@/effect/run-service"
import { Effect, Layer, Scope, Context } from "effect"
import { Session } from "."
import { MessageV2 } from "./message-v2"
import { SessionID } from "./schema"
import { SessionStatus } from "./status"

export namespace SessionRunState {
  export type BusyKind = "idle" | "prompt" | "runner" | "shell"

  export interface Interface {
    readonly assertNotBusy: (sessionID: SessionID) => Effect.Effect<void>
    readonly cancel: (sessionID: SessionID) => Effect.Effect<void>
    readonly requestStop: (sessionID: SessionID) => Effect.Effect<boolean>
    readonly finishStop: (sessionID: SessionID) => Effect.Effect<void>
    readonly isStopRequested: (sessionID: SessionID) => Effect.Effect<boolean>
    readonly busyKind: (sessionID: SessionID) => Effect.Effect<BusyKind>
    readonly isPromptRunning: (sessionID: SessionID) => Effect.Effect<boolean>
    readonly setPromptRunning: (sessionID: SessionID, running: boolean) => Effect.Effect<void>
    readonly ensureRunning: (
      sessionID: SessionID,
      onInterrupt: Effect.Effect<MessageV2.WithParts, unknown>,
      work: Effect.Effect<MessageV2.WithParts, unknown>,
    ) => Effect.Effect<MessageV2.WithParts, unknown>
    readonly startShell: (
      sessionID: SessionID,
      onInterrupt: Effect.Effect<MessageV2.WithParts, unknown>,
      work: Effect.Effect<MessageV2.WithParts, unknown>,
    ) => Effect.Effect<MessageV2.WithParts, unknown>
  }

  export class Service extends Context.Service<Service, Interface>()("@opencode/SessionRunState") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const status = yield* SessionStatus.Service

      const state = yield* InstanceState.make(
        Effect.fn("SessionRunState.state")(function* () {
          const scope = yield* Scope.Scope
          const runners = new Map<SessionID, Runner<MessageV2.WithParts, unknown>>()
          const activeTurns = new Set<SessionID>()
          const stopRequested = new Set<SessionID>()
          yield* Effect.addFinalizer(
            Effect.fnUntraced(function* () {
              yield* Effect.forEach(runners.values(), (runner) => runner.cancel, {
                concurrency: "unbounded",
                discard: true,
              })
              runners.clear()
              activeTurns.clear()
              stopRequested.clear()
            }),
          )
          return { runners, activeTurns, stopRequested, scope }
        }),
      )

      const runner = Effect.fn("SessionRunState.runner")(function* (
        sessionID: SessionID,
        onInterrupt: Effect.Effect<MessageV2.WithParts, unknown>,
      ) {
        const data = yield* InstanceState.get(state)
        const existing = data.runners.get(sessionID)
        if (existing) return existing
        const next = Runner.make<MessageV2.WithParts, unknown>(data.scope, {
          onIdle: Effect.gen(function* () {
            data.runners.delete(sessionID)
            data.activeTurns.delete(sessionID)
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
          data.activeTurns.delete(sessionID)
          yield* status.set(sessionID, { type: "idle" })
          return
        }
        yield* existing.cancel
      })

      const requestStop = Effect.fn("SessionRunState.requestStop")(function* (sessionID: SessionID) {
        const data = yield* InstanceState.get(state)
        data.stopRequested.add(sessionID)
        const existing = data.runners.get(sessionID)
        return !!existing?.busy
      })

      const finishStop = Effect.fn("SessionRunState.finishStop")(function* (sessionID: SessionID) {
        const data = yield* InstanceState.get(state)
        data.stopRequested.delete(sessionID)
      })

      const isStopRequested = Effect.fn("SessionRunState.isStopRequested")(function* (sessionID: SessionID) {
        const data = yield* InstanceState.get(state)
        return data.stopRequested.has(sessionID)
      })

      const busyKind = Effect.fn("SessionRunState.busyKind")(function* (sessionID: SessionID) {
        const data = yield* InstanceState.get(state)
        const existing = data.runners.get(sessionID)
        if (!existing || existing.state._tag === "Idle") return "idle" as const
        if (existing.state._tag === "Shell" || existing.state._tag === "ShellThenRun") return "shell" as const
        if (data.activeTurns.has(sessionID)) return "prompt" as const
        return "runner" as const
      })

      const isPromptRunning = Effect.fn("SessionRunState.isPromptRunning")(function* (sessionID: SessionID) {
        const data = yield* InstanceState.get(state)
        return data.activeTurns.has(sessionID)
      })

      const setPromptRunning = Effect.fn("SessionRunState.setPromptRunning")(function* (
        sessionID: SessionID,
        running: boolean,
      ) {
        const data = yield* InstanceState.get(state)
        if (running) data.activeTurns.add(sessionID)
        else data.activeTurns.delete(sessionID)
      })

      const ensureRunning = Effect.fn("SessionRunState.ensureRunning")(function* (
        sessionID: SessionID,
        onInterrupt: Effect.Effect<MessageV2.WithParts, unknown>,
        work: Effect.Effect<MessageV2.WithParts, unknown>,
      ) {
        return yield* (yield* runner(sessionID, onInterrupt)).ensureRunning(work)
      })

      const startShell = Effect.fn("SessionRunState.startShell")(function* (
        sessionID: SessionID,
        onInterrupt: Effect.Effect<MessageV2.WithParts, unknown>,
        work: Effect.Effect<MessageV2.WithParts, unknown>,
      ) {
        return yield* (yield* runner(sessionID, onInterrupt)).startShell(work)
      })

      return Service.of({
        assertNotBusy,
        cancel,
        requestStop,
        finishStop,
        isStopRequested,
        busyKind,
        isPromptRunning,
        setPromptRunning,
        ensureRunning,
        startShell,
      })
    }),
  )

  export const defaultLayer = layer.pipe(Layer.provide(SessionStatus.defaultLayer))
  const { runPromise } = makeRuntime(Service, defaultLayer)

  export async function assertNotBusy(sessionID: SessionID) {
    return runPromise((svc) => svc.assertNotBusy(sessionID))
  }
}
