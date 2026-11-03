import { DateTime, Effect } from "effect"
import { Resource } from "sst/resource"
import { DatabaseError } from "./database"
import {
  fromCatalogSnapshot,
  loadCatalogIdentity,
  toCatalogSnapshot,
  type CatalogSnapshot,
} from "./domain/catalog-identity"
import { GeoStatRepo, rowsFromAggregates as geoRowsFromAggregates } from "./domain/geo"
import {
  buildPeriodRetentionQuery,
  buildPeriodStatsQueries,
  hiddenStatModels,
  retentionPeriods,
  statPeriods,
  toGeoAggregate,
  toModelAggregate,
  toProviderAggregate,
  toRetentionAggregate,
} from "./domain/inference"
import { ModelStatRepo, rowsFromAggregates as modelRowsFromAggregates } from "./domain/model"
import { statProvider } from "./domain/model-normalization"
import { ProviderStatRepo, rowsFromAggregates as providerRowsFromAggregates } from "./domain/provider"
import { RetentionStatRepo, rowsFromAggregates as retentionRowsFromAggregates } from "./domain/retention"
import type { StatGrain } from "./domain/stat"
import { R2Sql, R2SqlQueryError } from "./r2-sql"
import { syncRange } from "./sync-range"

// Plans cross a Workflow step boundary, so every value is plain JSON.
export type StatsSyncPeriod = { grain: StatGrain; key: string; start: string; end: string }
export type StatsSyncRetentionPeriod = { start: string; end: string; returnStart: string; returnEnd: string }
export type StatsSyncPlan = {
  startedAt: string
  history: boolean
  periodStart: string
  periodEnd: string
  catalog: CatalogSnapshot
  periods: StatsSyncPeriod[]
  retentionPeriods: StatsSyncRetentionPeriod[]
}
export type SyncStatsResult = { ok: true; rows: number; startedAt: string; periodStart: string; periodEnd: string }
export type SyncStatsError = R2SqlQueryError | DatabaseError | CatalogUnavailableError

export class CatalogUnavailableError extends Error {
  readonly _tag = "CatalogUnavailableError"

  constructor() {
    super("Model catalog unavailable")
    this.name = "CatalogUnavailableError"
  }
}

const STATS_CURSOR = ["dimension", "tier", "provider", "model", "country"]

// Each stat period and retention cohort is independent: ranks, upserts and
// deletes stay inside one (grain, period_key) or one cohort. A run is one plan
// and one write per period and cohort, so each can be retried on its own.
export const syncStats = Effect.fn("StatSync.sync")(function* (options?: { history?: boolean }) {
  const plan = yield* planStatsSync(yield* DateTime.nowAsDate, { history: options?.history ?? false })
  const periods = yield* Effect.forEach(plan.periods, (period) => syncStatPeriod(period, plan.catalog), {
    concurrency: 2,
  })
  const cohorts = yield* Effect.forEach(plan.retentionPeriods, (period) => syncRetentionCohort(period, plan.catalog), {
    concurrency: 4,
  })
  yield* Effect.logInfo(
    `stats sync complete ${JSON.stringify({
      history: plan.history,
      startedAt: plan.startedAt,
      periodStart: plan.periodStart,
      periodEnd: plan.periodEnd,
      rows: periods.reduce((sum, item) => sum + item.modelRows, 0),
      providerRows: periods.reduce((sum, item) => sum + item.providerRows, 0),
      geoRows: periods.reduce((sum, item) => sum + item.geoRows, 0),
      retentionRows: cohorts.reduce((sum, item) => sum + item.rows, 0),
      stage: Resource.App.stage,
    })}`,
  )
  return {
    ok: true,
    rows: periods.reduce((sum, item) => sum + item.modelRows, 0),
    startedAt: plan.startedAt,
    periodStart: plan.periodStart,
    periodEnd: plan.periodEnd,
  } satisfies SyncStatsResult
})

export const planStatsSync = Effect.fn("StatSync.plan")(function* (startedAt: Date, options: { history: boolean }) {
  const retentionStats = yield* RetentionStatRepo
  const range = syncRange(startedAt, options.history)
  const identity = yield* Effect.promise(loadCatalogIdentity)
  // Without the catalog every period written would attribute models to
  // "unknown"; fail so the run retries instead.
  if (!identity.catalog) return yield* Effect.fail(new CatalogUnavailableError())
  if (identity.stale) yield* Effect.logWarning("model catalog unavailable; using cached identity")
  const retentionAvailable = yield* retentionStats.available()
  yield* logRuntimeCheck()

  const plan: StatsSyncPlan = {
    startedAt: startedAt.toISOString(),
    history: options.history,
    periodStart: range.periodStart.toISOString(),
    periodEnd: range.periodEnd.toISOString(),
    catalog: toCatalogSnapshot(identity.catalog),
    periods: statPeriods(range.periodStart, range.periodEnd).map((period) => ({
      grain: period.grain,
      key: period.key,
      start: period.start.toISOString(),
      end: period.end.toISOString(),
    })),
    retentionPeriods: retentionAvailable
      ? retentionPeriods(range.retentionStart, range.retentionEnd).map((period) => ({
          start: period.start.toISOString(),
          end: period.end.toISOString(),
          returnStart: period.returnStart.toISOString(),
          returnEnd: period.returnEnd.toISOString(),
        }))
      : [],
  }
  yield* Effect.logInfo(
    `stats sync planned ${JSON.stringify({
      history: plan.history,
      periodStart: plan.periodStart,
      periodEnd: plan.periodEnd,
      periods: plan.periods.length,
      retentionPeriods: plan.retentionPeriods.length,
      retentionAvailable,
    })}`,
  )
  return plan
})

export const syncStatPeriod = Effect.fn("StatSync.period")(function* (
  period: StatsSyncPeriod,
  snapshot: CatalogSnapshot,
) {
  const r2Sql = yield* R2Sql
  const modelStats = yield* ModelStatRepo
  const providerStats = yield* ProviderStatRepo
  const geoStats = yield* GeoStatRepo
  const catalog = fromCatalogSnapshot(snapshot)
  const queries = buildPeriodStatsQueries(
    { grain: period.grain, key: period.key, start: new Date(period.start), end: new Date(period.end) },
    undefined,
    catalog,
  )
  const rows = yield* Effect.forEach(
    queries,
    (query) =>
      r2Sql
        .query(query, STATS_CURSOR)
        .pipe(
          Effect.tapError((error) =>
            Effect.logError(
              `stats query failed ${JSON.stringify({ grain: period.grain, periodKey: period.key, error: error.message })}`,
            ),
          ),
        ),
    { concurrency: "unbounded" },
  ).pipe(Effect.map((batches) => batches.flat()))
  const modelRows = modelRowsFromAggregates(
    rows.filter((row) => row.dimension === "model").flatMap((row) => toModelAggregate(row, catalog)),
  )
  const providerRows = providerRowsFromAggregates(
    rows.filter((row) => row.dimension === "provider").flatMap((row) => toProviderAggregate(row, catalog)),
  )
  const geoRows = geoRowsFromAggregates(
    rows
      .filter((row) => row.dimension === "geo" || row.dimension === "geo_model")
      .flatMap((row) => toGeoAggregate(row, catalog)),
  )

  yield* Effect.all([modelStats.upsert(modelRows), providerStats.upsert(providerRows), geoStats.upsert(geoRows)], {
    concurrency: "unbounded",
    discard: true,
  })
  // Scope by the period rather than the rows written, so a period whose only
  // rows were just hidden still drops them.
  const scope = { grain: period.grain, periodKey: period.key, dataset: Resource.StatsSyncConfig.dataset }
  yield* Effect.all(
    [
      modelStats.deleteRetiredDimensions(scope, hiddenStatModels()),
      providerStats.deleteRetiredDimensions(scope),
      geoStats.deleteRetiredDimensions(scope, hiddenStatModels()),
    ],
    { concurrency: "unbounded", discard: true },
  )
  yield* Effect.all(
    [
      modelStats.deleteUnknownDimensions(
        modelRows.filter(
          (row) =>
            row.provider !== "unknown" &&
            (catalog.models.get(row.model) ?? statProvider(row.model, "", "unknown")) === row.provider,
        ),
      ),
      geoStats.deleteUnknownDimensions(
        geoRows.filter(
          (row) =>
            row.model !== "all" &&
            row.provider !== "unknown" &&
            (catalog.models.get(row.model ?? "all") ?? statProvider(row.model ?? "all", "", "unknown")) ===
              row.provider,
        ),
      ),
    ],
    { concurrency: "unbounded", discard: true },
  )

  const result = {
    grain: period.grain,
    periodKey: period.key,
    modelRows: modelRows.length,
    providerRows: providerRows.length,
    geoRows: geoRows.length,
  }
  yield* Effect.logInfo(`stats period synced ${JSON.stringify(result)}`)
  return result
})

export const syncRetentionCohort = Effect.fn("StatSync.retentionCohort")(function* (
  period: StatsSyncRetentionPeriod,
  snapshot: CatalogSnapshot,
) {
  const r2Sql = yield* R2Sql
  const retentionStats = yield* RetentionStatRepo
  const catalog = fromCatalogSnapshot(snapshot)
  const item = buildPeriodRetentionQuery(
    {
      start: new Date(period.start),
      end: new Date(period.end),
      returnStart: new Date(period.returnStart),
      returnEnd: new Date(period.returnEnd),
    },
    undefined,
    catalog,
  )
  const rows = retentionRowsFromAggregates(
    (yield* r2Sql
      .query(item.query)
      .pipe(
        Effect.tapError((error) =>
          Effect.logError(
            `retention query failed ${JSON.stringify({ cohortDates: item.cohortDates, error: error.message })}`,
          ),
        ),
      )).flatMap((row) => toRetentionAggregate(row, catalog)),
  )
  // Replace only after the query succeeds, so a failed query keeps the last cohort.
  yield* retentionStats.replace(rows, {
    cohortDates: item.cohortDates,
    dataset: Resource.StatsSyncConfig.dataset,
    tier: "Go",
  })

  const result = { cohortDate: item.cohortDates[0]!, rows: rows.length }
  yield* Effect.logInfo(`retention cohort synced ${JSON.stringify(result)}`)
  return result
})

function logRuntimeCheck() {
  return Effect.logInfo(
    `r2 sql stats runtime check ${JSON.stringify({
      accountId: Resource.R2Sql.accountId,
      bucket: Resource.R2Sql.bucket,
      dataset: Resource.StatsSyncConfig.dataset,
      namespace: Resource.R2Sql.namespace,
      table: Resource.R2Sql.table,
      stage: Resource.App.stage,
    })}`,
  )
}
