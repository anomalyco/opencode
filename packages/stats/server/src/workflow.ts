import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep, type WorkflowStepConfig } from "cloudflare:workers"
import { NonRetryableError } from "cloudflare:workflows"
import { isDeterministicR2SqlError, R2Sql, R2SqlQueryError } from "@opencode/stats-core/r2-sql"
import { layer } from "@opencode/stats-core/runtime"
import { planStatsSync, syncRetentionCohort, syncStatPeriod, type SyncStatsError } from "@opencode/stats-core/stat-sync"
import { Effect, Layer } from "effect"
import type { StatsSyncParams } from "./schedule"

const runtimeLayer = Layer.mergeAll(layer, R2Sql.layer)
// Each step runs one period's R2 SQL queries (10-minute request timeout, with
// page retries) and its PlanetScale writes.
const STEP: WorkflowStepConfig = {
  timeout: "30 minutes",
  retries: { limit: 2, delay: "1 minute", backoff: "exponential" },
}

export class StatsSyncWorkflow extends WorkflowEntrypoint<unknown, StatsSyncParams> {
  async run(event: WorkflowEvent<StatsSyncParams>, step: WorkflowStep) {
    const plan = await step.do("plan", STEP, () =>
      run(
        planStatsSync(new Date(event.payload.startedAt ?? event.timestamp), {
          history: event.payload.history ?? false,
        }),
      ),
    )

    // Steps run one at a time to keep one period's rows in memory. A failed
    // period does not stop the others; the run still ends as errored.
    const failed: string[] = []
    for (const period of plan.periods) {
      const name = `${period.grain} ${period.key}`
      await step.do(name, STEP, () => run(syncStatPeriod(period, plan.catalog))).catch(() => failed.push(name))
    }
    for (const period of plan.retentionPeriods) {
      const name = `retention ${period.start.slice(0, 10)}`
      await step.do(name, STEP, () => run(syncRetentionCohort(period, plan.catalog))).catch(() => failed.push(name))
    }
    if (failed.length > 0) throw new Error(`stats sync failed for ${failed.join(", ")}`)
    return { periods: plan.periods.length, retentionPeriods: plan.retentionPeriods.length }
  }
}

function run<A>(effect: Effect.Effect<A, SyncStatsError, Layer.Success<typeof runtimeLayer>>) {
  return Effect.runPromise(
    effect.pipe(
      // Retrying a rejected query repeats its R2 SQL spend for the same result.
      Effect.mapError((error) =>
        error instanceof R2SqlQueryError && isDeterministicR2SqlError(error)
          ? new NonRetryableError(error.message, error.name)
          : error,
      ),
      Effect.provide(runtimeLayer),
    ),
  )
}
