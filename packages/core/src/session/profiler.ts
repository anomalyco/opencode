export * as SessionProfiler from "./profiler"

import { Context, Effect, Layer, Schema } from "effect"
import { makeLocationNode } from "../effect/app-node"
import { SessionKnowledge } from "./knowledge"

export const ProfileInsightType = Schema.Literals([
  "friction-point",
  "repeated-pattern",
  "technical-debt",
  "test-fragility",
])
export type ProfileInsightType = typeof ProfileInsightType.Type

export const ProfileInsight = Schema.Struct({
  type: ProfileInsightType,
  metric: Schema.String,
  evidence: Schema.Array(Schema.String),
  suggestion: Schema.String,
  severity: Schema.Literals(["suggestion", "warning", "critical"]),
})
export type ProfileInsight = typeof ProfileInsight.Type

export interface Interface {
  readonly recordMetrics: (input: {
    readonly sessionID: string
    readonly steps: number
    readonly filesChanged: ReadonlyArray<string>
    readonly errors: ReadonlyArray<string>
    readonly finishedSuccessfully: boolean
  }) => Effect.Effect<void>

  readonly getInsights: (context: string) => Effect.Effect<ReadonlyArray<ProfileInsight>>

  readonly getEditHeatmap: (context: string, limit?: number) => Effect.Effect<ReadonlyArray<{ file: string; count: number }>>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/SessionProfiler") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const knowledge = yield* SessionKnowledge.Service

    return Service.of({
      recordMetrics: Effect.fn("SessionProfiler.recordMetrics")(function* (input) {
        if (input.filesChanged.length > 0) {
          yield* knowledge.record({
            sessionID: input.sessionID as any,
            type: "pattern",
            content: `Files changed: ${input.filesChanged.join(", ")} (${input.steps} steps)`,
            context: `profiler:edit:${input.sessionID}`,
          }).pipe(Effect.catch(() => Effect.void))
          for (const file of input.filesChanged) {
            yield* knowledge.record({
              sessionID: input.sessionID as any,
              type: "pattern",
              content: file,
              context: `profiler:edit-count:${file}`,
            }).pipe(Effect.catch(() => Effect.void))
          }
        }
        if (!input.finishedSuccessfully) {
          yield* knowledge.record({
            sessionID: input.sessionID as any,
            type: "constraint",
            content: `Step failed: ${input.errors.slice(0, 3).join("; ")}`,
            context: `profiler:error:${input.sessionID}`,
          }).pipe(Effect.catch(() => Effect.void))
        }
      }),

      getInsights: Effect.fn("SessionProfiler.getInsights")(function* (context) {
        const facts = yield* knowledge.queryByContext(context)
        const insights: ProfileInsight[] = []
        const editCounts = new Map<string, number>()
        const errorCounts = new Map<string, number>()

        for (const fact of facts) {
          if (fact.context?.startsWith("profiler:edit-count:")) {
            const file = fact.content
            editCounts.set(file, (editCounts.get(file) ?? 0) + 1)
          }
          if (fact.context?.startsWith("profiler:error:")) {
            const errorKey = fact.content.split(";")[0].trim()
            errorCounts.set(errorKey, (errorCounts.get(errorKey) ?? 0) + 1)
          }
        }

        for (const [file, count] of editCounts) {
          if (count >= 5) {
            insights.push({
              type: "friction-point",
              metric: `edit-frequency:${count} на файл ${file}`,
              evidence: [`Файл изменён ${count} раз`],
              suggestion: `Подумайте о рефакторинге ${file} — слишком часто меняется`,
              severity: count >= 10 ? "critical" : count >= 7 ? "warning" : "suggestion",
            })
          }
        }

        for (const [error, count] of errorCounts) {
          if (count >= 3) {
            insights.push({
              type: "repeated-pattern",
              metric: `error-frequency:${count} на ошибку "${error}"`,
              evidence: [`Ошибка возникла ${count} раз`],
              suggestion: `Похоже, ошибка повторяется. Стоит добавить тест или исправить корневую причину.`,
              severity: count >= 5 ? "warning" : "suggestion",
            })
          }
        }

        return insights
      }),

      getEditHeatmap: Effect.fn("SessionProfiler.getEditHeatmap")(function* (context, limit) {
        const facts = yield* knowledge.queryByContext(context)
        const counts = new Map<string, number>()
        for (const fact of facts) {
          if (fact.context?.startsWith("profiler:edit-count:")) {
            const file = fact.content
            counts.set(file, (counts.get(file) ?? 0) + 1)
          }
        }
        return [...counts.entries()]
          .map(([file, count]) => ({ file, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, limit ?? 20)
      }),
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [SessionKnowledge.node],
})
