import { afterEach, describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import type { CatalogSnapshot } from "./domain/catalog-identity"
import type { StatPeriodScope } from "./domain/stat"
import type { R2SqlData } from "./r2-sql"

process.env.SST_RESOURCE_App = JSON.stringify({ name: "opencode", stage: "test" })
process.env.SST_RESOURCE_R2Sql = JSON.stringify({
  accountId: "account",
  bucket: "bucket",
  namespace: "inference",
  table: "generation",
})
process.env.SST_RESOURCE_StatsSyncConfig = JSON.stringify({ dataset: "zen" })
process.env.SST_RESOURCE_StatsHiddenModels = JSON.stringify({ value: "secret-model" })

const { GeoStatRepo } = await import("./domain/geo")
const { ModelStatRepo } = await import("./domain/model")
const { ProviderStatRepo } = await import("./domain/provider")
const { RetentionStatRepo } = await import("./domain/retention")
const { R2Sql, R2SqlQueryError } = await import("./r2-sql")
const { CatalogUnavailableError, planStatsSync, syncRetentionCohort, syncStatPeriod } = await import("./stat-sync")

const catalog: CatalogSnapshot = { offerings: [["opencode/model-a", "lab"]], models: [["model-a", "lab"]] }
const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("stats sync plan", () => {
  // Runs first: the catalog loader caches a successful response for five minutes.
  test("fails instead of planning a run without the model catalog", async () => {
    globalThis.fetch = Object.assign(() => Promise.reject(new TypeError("network down")), {
      preconnect: originalFetch.preconnect,
    })

    const error = await Effect.runPromise(
      planStatsSync(new Date("2026-10-23T19:05:00.000Z"), { history: false }).pipe(
        Effect.flip,
        Effect.provide(services({ events: [] })),
      ),
    )

    expect(error).toBeInstanceOf(CatalogUnavailableError)
  })

  test("plans the current week for hourly runs and the rest of the window for history runs", async () => {
    globalThis.fetch = Object.assign(
      () =>
        Promise.resolve(
          Response.json({
            models: { "lab/model-a": {} },
            providers: { opencode: { models: { "model-a": { canonical_model_id: "lab/model-a" } } } },
          }),
        ),
      { preconnect: originalFetch.preconnect },
    )
    const startedAt = new Date("2026-10-23T19:05:00.000Z")
    const plan = (history: boolean) =>
      Effect.runPromise(planStatsSync(startedAt, { history }).pipe(Effect.provide(services({ events: [] }))))

    const hourly = await plan(false)
    expect(hourly.catalog).toEqual({ offerings: [["opencode/model-a", "lab"]], models: [["model-a", "lab"]] })
    expect(hourly.periods.map((period) => `${period.grain} ${period.key}`)).toEqual([
      "week 2026-W43",
      "day 2026-10-19",
      "day 2026-10-20",
      "day 2026-10-21",
      "day 2026-10-22",
      "day 2026-10-23",
    ])
    expect(hourly.periods.at(-1)).toEqual({
      grain: "day",
      key: "2026-10-23",
      start: "2026-10-23T00:00:00.000Z",
      end: "2026-10-23T19:00:00.000Z",
    })
    expect(hourly.retentionPeriods).toEqual([
      {
        start: "2026-10-05T00:00:00.000Z",
        end: "2026-10-12T00:00:00.000Z",
        returnStart: "2026-10-12T00:00:00.000Z",
        returnEnd: "2026-10-19T00:00:00.000Z",
      },
    ])

    const history = await plan(true)
    expect(history.periods.filter((period) => period.grain === "week").map((period) => period.key)).toEqual([
      "2026-W35",
      "2026-W36",
      "2026-W37",
      "2026-W38",
      "2026-W39",
      "2026-W40",
      "2026-W41",
      "2026-W42",
    ])
    expect(history.periods.filter((period) => period.grain === "day")).toHaveLength(52)
    expect(history.periods.at(-1)?.key).toBe("2026-10-18")
    expect(history.retentionPeriods.map((period) => period.start.slice(0, 10))).toEqual([
      "2026-08-24",
      "2026-08-31",
      "2026-09-07",
      "2026-09-14",
      "2026-09-21",
      "2026-09-28",
    ])
  })
})

describe("stats sync steps", () => {
  test("drops retired and hidden dimensions from a period with no remaining rows", async () => {
    const events: string[] = []

    const result = await Effect.runPromise(
      syncStatPeriod(
        { grain: "day", key: "2026-10-22", start: "2026-10-22T00:00:00.000Z", end: "2026-10-23T00:00:00.000Z" },
        catalog,
      ).pipe(Effect.provide(services({ events }))),
    )

    expect(result).toEqual({ grain: "day", periodKey: "2026-10-22", modelRows: 0, providerRows: 0, geoRows: 0 })
    expect(events.filter((event) => event.startsWith("deleteRetired")).toSorted()).toEqual([
      'deleteRetired geo {"grain":"day","periodKey":"2026-10-22","dataset":"zen"} secret-model',
      'deleteRetired model {"grain":"day","periodKey":"2026-10-22","dataset":"zen"} secret-model',
      'deleteRetired provider {"grain":"day","periodKey":"2026-10-22","dataset":"zen"}',
    ])
  })

  test("replaces a retention cohort only after its query returns", async () => {
    const events: string[] = []

    const result = await Effect.runPromise(
      syncRetentionCohort(retentionPeriod, catalog).pipe(
        Effect.provide(
          services({
            events,
            rows: [
              {
                cohort_date: "2026-10-05",
                dataset: "zen",
                tier: "Go",
                provider: "lab",
                model: "model-a",
                eligible_users: "10",
                retained_users: "4",
              },
            ],
          }),
        ),
      ),
    )

    expect(result).toEqual({ cohortDate: "2026-10-05", rows: 1 })
    expect(events).toEqual(["query", 'replace ["2026-10-05"] zen Go model-a:10:4'])
  })

  test("keeps the existing cohort when its query fails", async () => {
    const events: string[] = []
    const failure = new R2SqlQueryError({ message: "unavailable", status: 400 })

    const error = await Effect.runPromise(
      syncRetentionCohort(retentionPeriod, catalog).pipe(Effect.flip, Effect.provide(services({ events, failure }))),
    )

    expect(error).toBe(failure)
    expect(events).toEqual(["query"])
  })
})

const retentionPeriod = {
  start: "2026-10-05T00:00:00.000Z",
  end: "2026-10-12T00:00:00.000Z",
  returnStart: "2026-10-12T00:00:00.000Z",
  returnEnd: "2026-10-19T00:00:00.000Z",
}

function services(input: { events: string[]; rows?: R2SqlData[]; failure?: InstanceType<typeof R2SqlQueryError> }) {
  const unused = () => Effect.die("unused")
  const retired = (table: string) => (scope: StatPeriodScope, hidden?: readonly string[]) =>
    Effect.sync(() => {
      input.events.push(`deleteRetired ${table} ${JSON.stringify(scope)}${hidden ? ` ${hidden.join(",")}` : ""}`)
    })
  return Layer.mergeAll(
    Layer.succeed(
      R2Sql,
      R2Sql.of({
        query: () =>
          Effect.suspend(() => {
            input.events.push("query")
            return input.failure ? Effect.fail(input.failure) : Effect.succeed(input.rows ?? [])
          }),
      }),
    ),
    Layer.succeed(
      ModelStatRepo,
      ModelStatRepo.of({
        listDaily: unused,
        upsert: () => Effect.void,
        deleteRetiredDimensions: retired("model"),
        deleteUnknownDimensions: () => Effect.void,
      }),
    ),
    Layer.succeed(
      ProviderStatRepo,
      ProviderStatRepo.of({
        listDaily: unused,
        listByPeriod: unused,
        upsert: () => Effect.void,
        deleteRetiredDimensions: retired("provider"),
      }),
    ),
    Layer.succeed(
      GeoStatRepo,
      GeoStatRepo.of({
        listDaily: unused,
        listByPeriod: unused,
        upsert: () => Effect.void,
        deleteRetiredDimensions: retired("geo"),
        deleteUnknownDimensions: () => Effect.void,
      }),
    ),
    Layer.succeed(
      RetentionStatRepo,
      RetentionStatRepo.of({
        available: () => Effect.succeed(true),
        replace: (rows, scope) =>
          Effect.sync(() => {
            input.events.push(
              `replace ${JSON.stringify(scope.cohortDates)} ${scope.dataset} ${scope.tier} ${rows
                .map((row) => `${row.model}:${row.eligible_users}:${row.retained_users}`)
                .join(",")}`,
            )
          }),
      }),
    ),
  )
}
