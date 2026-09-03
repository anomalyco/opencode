import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionID } from "@/session/schema"
import { SessionPrompt } from "@/session/prompt"
import { BackgroundJob } from "@/background/job"
import { InstanceStore } from "@/project/instance-store"
import { HeartbeatStore } from "./store"
import { HeartbeatScheduler } from "./scheduler"
import { Cause, Context, Effect, Layer, Scope } from "effect"

export interface Interface {
  readonly recovered: number
}

export class Service extends Context.Service<Service, Interface>()("@opencode/HeartbeatRecovery") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const background = yield* BackgroundJob.Service
    const store = yield* HeartbeatStore.Service
    const prompts = yield* SessionPrompt.Service
    const instances = yield* InstanceStore.Service
    const scope = yield* Scope.Scope
    const pending = yield* store.recoverable()

    const results = yield* Effect.forEach(
      pending,
      (saved) =>
        Effect.gen(function* () {
          const heartbeat = saved.status === "firing" ? yield* store.requeue(saved.jobID, saved.revision) : saved
          if (!heartbeat) return false
          yield* instances.provide(
            { directory: heartbeat.directory },
            HeartbeatScheduler.arm({
              background,
              store,
              scope,
              heartbeat,
              deliver: (current) =>
                prompts
                  .prompt({
                    sessionID: SessionID.make(current.sessionID),
                    agent: current.agent,
                    parts: [
                      {
                        type: "text",
                        synthetic: true,
                        text: HeartbeatScheduler.promptText(current),
                      },
                    ],
                  })
                  .pipe(Effect.asVoid),
            }),
          )
          yield* Effect.logInfo("recovered durable heartbeat", {
            jobID: heartbeat.jobID,
            sessionID: heartbeat.sessionID,
            task: heartbeat.task,
            checkNumber: heartbeat.checkNumber,
            firesAt: heartbeat.firesAt,
          })
          return true
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.logError("failed to recover durable heartbeat", {
              jobID: saved.jobID,
              sessionID: saved.sessionID,
              task: saved.task,
              cause: Cause.pretty(cause),
            }).pipe(Effect.as(false)),
          ),
        ),
      { concurrency: "unbounded" },
    )
    const recovered = results.filter(Boolean).length
    if (pending.length > 0) {
      yield* Effect.logInfo("durable heartbeat recovery complete", { recovered, pending: pending.length })
    }
    return Service.of({ recovered })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [HeartbeatStore.node, BackgroundJob.node, SessionPrompt.node, InstanceStore.node],
})

export * as HeartbeatRecovery from "./recovery"
