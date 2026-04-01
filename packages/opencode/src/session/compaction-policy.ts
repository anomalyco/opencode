import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { InstanceState } from "@/effect/instance-state"
import { makeRuntime } from "@/effect/run-service"
import { Log } from "@/util/log"
import { SessionID } from "./schema"
import { isOverflow as overflow } from "./overflow"
import type { Provider } from "@/provider/provider"
import type { MessageV2 } from "./message-v2"
import { Effect, Layer, ServiceMap } from "effect"
import z from "zod"

const COMPACTION_MAX_FAILURES = 3

export namespace SessionCompactionPolicy {
  const log = Log.create({ service: "session.compaction.policy" })

  export const Event = {
    BreakerTripped: BusEvent.define(
      "session.compaction.breaker-tripped",
      z.object({ sessionID: SessionID.zod, failures: z.number() }),
    ),
  }

  type State = {
    failures: Map<SessionID, number>
  }

  export interface Interface {
    readonly shouldAutoCompact: (input: {
      sessionID: SessionID
      tokens: MessageV2.Assistant["tokens"]
      model: Provider.Model
    }) => Effect.Effect<boolean>
    readonly canAutoCompact: (sessionID: SessionID) => Effect.Effect<boolean>
    readonly failAutoCompact: (sessionID: SessionID) => Effect.Effect<number>
    readonly resetAutoCompact: (sessionID: SessionID) => Effect.Effect<void>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/SessionCompactionPolicy") {}

  export const layer: Layer.Layer<Service, never, Bus.Service | Config.Service> = Layer.effect(
    Service,
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const config = yield* Config.Service

      const state = yield* InstanceState.make(
        Effect.fn("SessionCompactionPolicy.state")(() =>
          Effect.succeed<State>({ failures: new Map<SessionID, number>() }),
        ),
      )

      const canAutoCompact = Effect.fn("SessionCompactionPolicy.canAutoCompact")(
        function* (sessionID: SessionID) {
          const cfg = yield* config.get()
          const max = cfg.compaction?.max_failures ?? COMPACTION_MAX_FAILURES
          const s = yield* InstanceState.get(state)
          const current = s.failures.get(sessionID) ?? 0
          return current < max
        },
      )

      const shouldAutoCompact = Effect.fn("SessionCompactionPolicy.shouldAutoCompact")(
        function* (input: {
          sessionID: SessionID
          tokens: MessageV2.Assistant["tokens"]
          model: Provider.Model
        }) {
          const cfg = yield* config.get()
          if (cfg.compaction?.auto === false) return false
          if (!(yield* canAutoCompact(input.sessionID))) {
            log.info("breaker open", { sessionID: input.sessionID })
            return false
          }
          return overflow({ cfg, tokens: input.tokens, model: input.model })
        },
      )

      const failAutoCompact = Effect.fn("SessionCompactionPolicy.failAutoCompact")(
        function* (sessionID: SessionID) {
          const cfg = yield* config.get()
          const max = cfg.compaction?.max_failures ?? COMPACTION_MAX_FAILURES
          const s = yield* InstanceState.get(state)
          const current = (s.failures.get(sessionID) ?? 0) + 1
          s.failures.set(sessionID, current)
          log.info("failure recorded", { sessionID, current, max })
          if (current === max) {
            yield* bus.publish(Event.BreakerTripped, { sessionID, failures: current })
          }
          return current
        },
      )

      const resetAutoCompact = Effect.fn("SessionCompactionPolicy.resetAutoCompact")(
        function* (sessionID: SessionID) {
          const s = yield* InstanceState.get(state)
          s.failures.delete(sessionID)
          log.info("reset", { sessionID })
        },
      )

      return Service.of({ shouldAutoCompact, canAutoCompact, failAutoCompact, resetAutoCompact })
    }),
  )

  export const defaultLayer = layer.pipe(Layer.provide(Bus.layer), Layer.provide(Config.defaultLayer))

  const { runPromise } = makeRuntime(Service, defaultLayer)

  export function shouldAutoCompact(input: {
    sessionID: SessionID
    tokens: MessageV2.Assistant["tokens"]
    model: Provider.Model
  }) {
    return runPromise((s) => s.shouldAutoCompact(input))
  }

  export function canAutoCompact(sessionID: SessionID) {
    return runPromise((s) => s.canAutoCompact(sessionID))
  }

  export function failAutoCompact(sessionID: SessionID) {
    return runPromise((s) => s.failAutoCompact(sessionID))
  }

  export function resetAutoCompact(sessionID: SessionID) {
    return runPromise((s) => s.resetAutoCompact(sessionID))
  }
}
