import { DateTime, Effect } from "effect"
import { Resource } from "sst/resource"
import { DatabaseError } from "./database"
import { loadCatalogIdentity } from "./domain/catalog-identity"
import { GeoStatRepo, rowsFromAggregates as geoRowsFromAggregates } from "./domain/geo"
import {
  buildRetentionQueries,
  buildStatsQueries,
  hiddenStatModels,
  toGeoAggregate,
  toModelAggregate,
  toProviderAggregate,
  toRetentionAggregate,
} from "./domain/inference"
import { ModelStatRepo, rowsFromAggregates as modelRowsFromAggregates } from "./domain/model"
import { statProvider } from "./domain/model-normalization"
import { ProviderStatRepo, rowsFromAggregates as providerRowsFromAggregates } from "./domain/provider"
import { RetentionStatRepo, rowsFromAggregates as retentionRowsFromAggregates } from "./domain/retention"
import { R2Sql, R2SqlQueryError } from "./r2-sql"
import { syncRange } from "./sync-range"

export type SyncStatsResult = { ok: true; rows: number; startedAt: string; periodStart: string; periodEnd: string }
export type SyncStatsError = R2SqlQueryError | DatabaseError
type SyncStatsServices = R2Sql | ModelStatRepo | ProviderStatRepo | GeoStatRepo | RetentionStatRepo

export const syncStats: (options?: {
  history?: boolean
}) => Effect.Effect<SyncStatsResult, SyncStatsError, SyncStatsServices> = Effect.fn("StatSync.sync")(
  function* (options?: { history?: boolean }) {
    const startedAt = yield* DateTime.nowAsDate
    const range = syncRange(startedAt, options?.history)
    const r2Sql = yield* R2Sql
    const modelStats = yield* ModelStatRepo
    const providerStats = yield* ProviderStatRepo
    const geoStats = yield* GeoStatRepo
    const retentionStats = yield* RetentionStatRepo
    const identity = yield* Effect.promise(loadCatalogIdentity)
    const catalog = identity.catalog
    if (identity.stale)
      yield* Effect.logWarning(
        catalog
          ? "model catalog unavailable; using cached identity"
          : "model catalog unavailable; using legacy stats attribution",
      )

    yield* logRuntimeCheck()

    const queries = buildStatsQueries(range.periodStart, range.periodEnd, undefined, catalog)
    yield* Effect.logInfo(
      `stats sync started ${JSON.stringify({ history: options?.history ?? false, periodStart: range.periodStart, periodEnd: range.periodEnd, queries: queries.length })}`,
    )
    const rows = yield* Effect.forEach(
      queries,
      (query, index) =>
        r2Sql.query(query, ["dimension", "tier", "provider", "model", "country"]).pipe(
          Effect.tap((rows) =>
            Effect.logInfo(
              `stats query complete ${JSON.stringify({ index, total: queries.length, rows: rows.length })}`,
            ),
          ),
          Effect.tapError((error) =>
            Effect.logError(
              `stats query failed ${JSON.stringify({ index, total: queries.length, error: error.message })}`,
            ),
          ),
        ),
      {
        concurrency: 4,
      },
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
    const retentionAvailable = yield* retentionStats.available()
    const retentionQueries = retentionAvailable
      ? buildRetentionQueries(range.retentionStart, range.retentionEnd, undefined, catalog)
      : []
    yield* Effect.logInfo(`stats sync querying retention ${JSON.stringify({ queries: retentionQueries.length })}`)
    const retentionRows = retentionRowsFromAggregates(
      yield* Effect.forEach(
        retentionQueries,
        (item) =>
          r2Sql.query(item.query).pipe(
            Effect.tap((rows) =>
              Effect.logInfo(
                `retention query complete ${JSON.stringify({ cohortDates: item.cohortDates, rows: rows.length })}`,
              ),
            ),
            Effect.tapError((error) =>
              Effect.logError(
                `retention query failed ${JSON.stringify({ cohortDates: item.cohortDates, error: error.message })}`,
              ),
            ),
          ),
        { concurrency: 4 },
      ).pipe(
        Effect.map((batches) => batches.flatMap((batch) => batch.flatMap((row) => toRetentionAggregate(row, catalog)))),
      ),
    )

    yield* Effect.logInfo(
      `stats sync writing aggregates ${JSON.stringify({ modelRows: modelRows.length, providerRows: providerRows.length, geoRows: geoRows.length, retentionRows: retentionRows.length })}`,
    )
    yield* Effect.all(
      [
        modelStats.upsert(modelRows),
        providerStats.upsert(providerRows),
        geoStats.upsert(geoRows),
        retentionStats.replace(retentionRows, {
          cohortDates: retentionQueries.flatMap((item) => item.cohortDates),
          dataset: Resource.StatsSyncConfig.dataset,
          tier: "Go",
        }),
      ],
      {
        concurrency: "unbounded",
        discard: true,
      },
    )
    yield* Effect.all(
      [
        modelStats.deleteRetiredDimensions(modelRows, hiddenStatModels()),
        providerStats.deleteRetiredDimensions(providerRows),
        geoStats.deleteRetiredDimensions(geoRows, hiddenStatModels()),
      ],
      { concurrency: "unbounded", discard: true },
    )
    yield* Effect.all(
      [
        modelStats.deleteUnknownDimensions(
          modelRows.filter(
            (row) =>
              row.provider !== "unknown" &&
              (catalog?.models.get(row.model) ?? statProvider(row.model, "", "unknown")) === row.provider,
          ),
        ),
        geoStats.deleteUnknownDimensions(
          geoRows.filter(
            (row) =>
              row.model !== "all" &&
              row.provider !== "unknown" &&
              (catalog?.models.get(row.model ?? "all") ?? statProvider(row.model ?? "all", "", "unknown")) ===
                row.provider,
          ),
        ),
      ],
      { concurrency: "unbounded", discard: true },
    )

    yield* Effect.logInfo(
      `stats sync complete ${JSON.stringify({
        history: options?.history ?? false,
        startedAt: startedAt.toISOString(),
        periodStart: range.periodStart.toISOString(),
        periodEnd: range.periodEnd.toISOString(),
        rows: modelRows.length,
        providerRows: providerRows.length,
        geoRows: geoRows.length,
        retentionRows: retentionRows.length,
        retentionAvailable,
        stage: Resource.App.stage,
      })}`,
    )

    return {
      ok: true,
      rows: modelRows.length,
      startedAt: startedAt.toISOString(),
      periodStart: range.periodStart.toISOString(),
      periodEnd: range.periodEnd.toISOString(),
    }
  },
)

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
