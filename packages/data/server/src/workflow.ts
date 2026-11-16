import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep, type WorkflowStepConfig } from "cloudflare:workers"
import { R2Sql } from "@opencode/data-core/r2-sql"
import { layer } from "@opencode/data-core/runtime"
import {
  deterministicFailureAsResult,
  planDataSync,
  syncRetentionCohort,
  syncStatPeriod,
  type DataSyncError,
} from "@opencode/data-core/stat-sync"
import { Effect, Layer } from "effect"
import type { DataSyncParams } from "./schedule"

const runtimeLayer = Layer.mergeAll(layer, R2Sql.layer)
// Each step runs one period's R2 SQL queries (10-minute request timeout, with
// page retries) and its PlanetScale writes.
const STEP: WorkflowStepConfig = {
  timeout: "30 minutes",
  retries: { limit: 2, delay: "1 minute", backoff: "exponential" },
}

export class DataSyncWorkflow extends WorkflowEntrypoint<unknown, DataSyncParams> {
  async run(event: WorkflowEvent<DataSyncParams | undefined>, step: WorkflowStep) {
    // A dashboard trigger can start an instance without params.
    const plan = await step.do("plan", STEP, () =>
      run(
        planDataSync(new Date(event.payload?.startedAt ?? event.timestamp), {
          history: event.payload?.history ?? false,
        }),
      ),
    )

    // Steps run one at a time to keep one period's rows in memory. A failed
    // period does not stop the others; the run still ends as errored.
    const failed: string[] = []
    const fail = (name: string, error: unknown) => {
      failed.push(name)
      console.error(
        `data sync step failed ${JSON.stringify({
          step: name,
          error: error instanceof Error ? error.message : String(error),
          cause: error instanceof Error && error.cause !== undefined ? String(error.cause) : undefined,
        })}`,
      )
    }
    const settle = (name: string, attempt: Promise<object>) =>
      attempt.then(
        (result) => {
          if ("failed" in result) fail(name, result.failed)
        },
        (error) => fail(name, error),
      )
    for (const period of plan.periods) {
      const name = `${period.grain} ${period.key}`
      await settle(
        name,
        step.do(name, STEP, () => run(deterministicFailureAsResult(syncStatPeriod(period, plan.catalog)))),
      )
    }
    for (const period of plan.retentionPeriods) {
      const name = `retention ${period.start.slice(0, 10)}`
      await settle(
        name,
        step.do(name, STEP, () => run(deterministicFailureAsResult(syncRetentionCohort(period, plan.catalog)))),
      )
    }
    if (failed.length > 0) throw new Error(`data sync failed for ${failed.join(", ")}`)
    return { periods: plan.periods.length, retentionPeriods: plan.retentionPeriods.length }
  }
}

function run<A>(effect: Effect.Effect<A, DataSyncError, Layer.Success<typeof runtimeLayer>>) {
  return Effect.runPromise(effect.pipe(Effect.provide(runtimeLayer)))
}
