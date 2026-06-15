import { Effect, Schema, Option } from "effect"
import * as Tool from "./tool"
import { LoopState, LoopCompleteParams } from "./loop-state"
import { LoopOrchestrator } from "./loop-orchestrator"
import { EventV2Bridge } from "@/event-v2-bridge"
import { LoopCompleted } from "./loop-event"
import { setLoopMetrics, resetLoopMetrics } from "./loop-shared"

type Metadata = {
  status?: string
  elapsed?: string
  completed?: number
  failed?: number
  total?: number
}

export const LoopCompleteTool = Tool.define<typeof LoopCompleteParams, Metadata, LoopState.Service | LoopOrchestrator.Service>(
  "loop_complete",
  Effect.gen(function* () {
    const loop = yield* LoopState.Service
    const orchestrator = yield* LoopOrchestrator.Service
    const maybeEvents = yield* Effect.serviceOption(EventV2Bridge.Service)
    return {
      description:
        "Complete the loop mode and generate a final report. Call this when all phases are done or when the loop needs to be terminated early.",
      parameters: LoopCompleteParams,
      execute: (
        params: Schema.Schema.Type<typeof LoopCompleteParams>,
        ctx: Tool.Context<Metadata>,
      ) =>
        Effect.gen(function* () {
          const current = yield* loop.get()
          if (!current.plan) {
            return {
              title: "No active loop",
              output: "No loop is currently active. Nothing to complete.",
              metadata: {} as Metadata,
            }
          }

          const metrics = yield* orchestrator.metrics()
          const totalPhases = metrics.totalPhases
          const completed = metrics.completedPhases
          const failed = current.failedPhases
          const elapsedStr = metrics.formattedElapsed

          setLoopMetrics(metrics, current.plan.phases[current.plan.currentPhaseIndex]?.title, current.plan.phases[current.plan.currentPhaseIndex]?.status)

          const phaseSummary = current.plan.phases
            .map((p) => `- ${p.title} (${p.id}): ${p.status}${p.attempts > 0 ? ` (${p.attempts} attempt(s))` : ""}`)
            .join("\n")

          const report = [
            `# Loop Complete -- ${params.status}`,
            "",
            `## Summary`,
            `Status: ${params.status}`,
            `Elapsed: ${elapsedStr}`,
            `Phases: ${completed} completed, ${failed} failed, ${totalPhases} total`,
            "",
            `## Phase Details`,
            phaseSummary,
            "",
            `## Final Note`,
            params.finalSummary,
            "",
            ...(params.status === "success"
              ? ["All phases completed successfully."]
              : params.status === "partial"
                ? ["Some phases were not completed. Review the report above."]
                : ["The loop was blocked. Review the issues and restart if needed."]),
          ].join("\n")

          yield* loop.set({
            plan: null,
            startedAt: null,
            completedPhases: 0,
            failedPhases: 0,
            status: params.status,
          })

          yield* orchestrator.reset()
          resetLoopMetrics()

          if (Option.isSome(maybeEvents)) {
            yield* maybeEvents.value.publish(LoopCompleted, {
              timestamp: Date.now(),
              sessionID: ctx.sessionID,
              status: params.status,
              totalPhases,
              completedPhases: completed,
              failedPhases: failed,
              elapsedMs: metrics.elapsedMs,
            }).pipe(Effect.ignore)
          }

          const meta: Metadata = {
            status: params.status,
            elapsed: elapsedStr,
            completed,
            failed,
            total: totalPhases,
          }

          yield* ctx.metadata({
            title: `Loop completed: ${params.status}`,
            metadata: meta,
          })

          return {
            title: `Loop ${params.status}`,
            output: report,
            metadata: meta,
          }
        }).pipe(Effect.orDie),
    } satisfies Tool.DefWithoutID<typeof LoopCompleteParams, Metadata>
  }),
)
