import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { LoopState, LoopSummaryParams } from "./loop-state"
import { LoopOrchestrator } from "./loop-orchestrator"
import { setLoopMetrics } from "./loop-shared"

type Metadata = {
  progress?: number
  completed?: number
  total?: number
  elapsed?: string
  status?: string
}

export const LoopSummaryTool = Tool.define<typeof LoopSummaryParams, Metadata, LoopState.Service | LoopOrchestrator.Service>(
  "loop_summary",
  Effect.gen(function* () {
    const loop = yield* LoopState.Service
    const orchestrator = yield* LoopOrchestrator.Service
    return {
      description:
        "Generate a summary of the current loop progress. Shows completed phases, current phase, elapsed time, and estimated remaining work.",
      parameters: LoopSummaryParams,
      execute: (
        params: Schema.Schema.Type<typeof LoopSummaryParams>,
        ctx: Tool.Context<Metadata>,
      ) =>
        Effect.gen(function* () {
          const current = yield* loop.get()
          if (!current.plan) {
            return {
              title: "No active loop",
              output: "No loop is currently active. Use loop_plan_create to start a new loop.",
              metadata: {} as Metadata,
            }
          }

          const metrics = yield* orchestrator.metrics()
          const completed = metrics.completedPhases
          const totalPhases = metrics.totalPhases
          const failed = current.failedPhases
          const remaining = totalPhases - completed - failed
          const progress = metrics.percentage

          const phaseTitle = current.plan.phases[current.plan.currentPhaseIndex]?.title ?? ""
          setLoopMetrics(metrics, phaseTitle, current.plan.phases[current.plan.currentPhaseIndex]?.status ?? "pending")

          const phaseList = current.plan.phases
            .map(
              (p, i) =>
                `${i === current.plan!.currentPhaseIndex ? "->" : "  "} Phase ${i + 1}: ${p.title} [${p.status}]`,
            )
            .join("\n")

          const isFull = params.detail === "full"

          const summary = [
            `# Loop Progress Summary`,
            "",
            `Status: ${current.status}`,
            `Elapsed: ${metrics.formattedElapsed}`,
            `Progress: ${completed}/${totalPhases} phases completed (${progress}%)`,
            ...(failed > 0 ? [`Failed: ${failed} phase(s)`] : []),
            ...(remaining > 0 ? [`Remaining: ${remaining} phase(s)`] : []),
            "",
            "## Phases",
            phaseList,
            ...(isFull && current.plan.description ? ["", `## Plan`, current.plan.description] : []),
            ...(isFull
              ? [
                  "",
                  "## Next Steps",
                  remaining > 0
                    ? `Continue with the next phase.`
                    : failed > 0
                      ? "Some phases failed. Address issues and retry."
                      : "All phases complete! Run loop_complete to finalize.",
                ]
              : []),
          ].join("\n")

          const meta: Metadata = {
            progress,
            completed,
            total: totalPhases,
            elapsed: metrics.formattedElapsed,
            status: current.status,
          }

          yield* ctx.metadata({
            title: `Progress: ${progress}% (${completed}/${totalPhases})`,
            metadata: meta,
          })

          return {
            title: "Loop summary generated",
            output: summary,
            metadata: meta,
          }
        }).pipe(Effect.orDie),
    } satisfies Tool.DefWithoutID<typeof LoopSummaryParams, Metadata>
  }),
)
