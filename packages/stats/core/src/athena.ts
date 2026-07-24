import {
  AthenaClient as AwsAthenaClient,
  GetQueryExecutionCommand,
  GetQueryResultsCommand,
  StartQueryExecutionCommand,
  type Row,
} from "@aws-sdk/client-athena"
import { Effect, Layer } from "effect"
import * as Context from "effect/Context"
import { Resource } from "sst/resource"

const ATHENA_MAX_POLL_ATTEMPTS = 300
const ATHENA_PAGE_SIZE = 1000

export type AthenaData = Record<string, string>

export class AthenaQueryError extends Error {
  readonly _tag = "AthenaQueryError"
  readonly queryExecutionId?: string

  constructor(input: { message: string; queryExecutionId?: string; cause?: unknown }) {
    super(input.message, { cause: input.cause })
    this.name = "AthenaQueryError"
    this.queryExecutionId = input.queryExecutionId
  }
}

export class AthenaQueryTimeoutError extends Error {
  readonly _tag = "AthenaQueryTimeoutError"
  readonly queryExecutionId: string

  constructor(input: { message: string; queryExecutionId: string }) {
    super(input.message)
    this.name = "AthenaQueryTimeoutError"
    this.queryExecutionId = input.queryExecutionId
  }
}

export declare namespace Athena {
  export interface Service {
    readonly query: (query: string) => Effect.Effect<AthenaData[], AthenaQueryError | AthenaQueryTimeoutError>
  }
}

export class Athena extends Context.Service<Athena, Athena.Service>()("@opencode/stats/Athena") {
  static readonly layer: Layer.Layer<Athena> = Layer.effect(
    Athena,
    Effect.sync(() => {
      const client = new AwsAthenaClient({ region: Resource.InferenceEvent.region })

      const query = Effect.fn("Athena.query")(function* (query: string) {
        const started = yield* Effect.tryPromise({
          try: () =>
            client.send(
              new StartQueryExecutionCommand({
                QueryString: query,
                WorkGroup: Resource.InferenceEvent.workgroup,
                QueryExecutionContext: {
                  Catalog: Resource.InferenceEvent.catalog,
                  Database: Resource.InferenceEvent.database,
                },
              }),
            ),
          catch: (cause) => new AthenaQueryError({ message: "Failed to start Athena stats query", cause }),
        })
        const queryExecutionId = started.QueryExecutionId
        if (!queryExecutionId)
          return yield* Effect.fail(new AthenaQueryError({ message: "Athena did not return a query execution id" }))

        yield* poll(client, queryExecutionId)
        return yield* results(client, queryExecutionId)
      })

      return Athena.of({ query })
    }),
  )
}

const poll: (
  client: AwsAthenaClient,
  queryExecutionId: string,
  attempt?: number,
) => Effect.Effect<void, AthenaQueryError | AthenaQueryTimeoutError> = Effect.fn("Athena.poll")(function* (
  client: AwsAthenaClient,
  queryExecutionId: string,
  attempt = 0,
) {
  if (attempt > 0) yield* Effect.sleep("2 seconds")

  const result = yield* Effect.tryPromise({
    try: () => client.send(new GetQueryExecutionCommand({ QueryExecutionId: queryExecutionId })),
    catch: (cause) => new AthenaQueryError({ message: "Failed to poll Athena stats query", queryExecutionId, cause }),
  })
  const status = result.QueryExecution?.Status

  if (status?.State === "SUCCEEDED") return
  if (status?.State === "FAILED" || status?.State === "CANCELLED")
    return yield* Effect.fail(
      new AthenaQueryError({
        message: `Athena stats query ${status.State.toLowerCase()}: ${status.StateChangeReason ?? "unknown reason"}`,
        queryExecutionId,
      }),
    )

  if (attempt >= ATHENA_MAX_POLL_ATTEMPTS - 1)
    return yield* Effect.fail(
      new AthenaQueryTimeoutError({
        message: `Athena stats query ${queryExecutionId} did not complete`,
        queryExecutionId,
      }),
    )

  return yield* poll(client, queryExecutionId, attempt + 1)
})

const results: (client: AwsAthenaClient, queryExecutionId: string) => Effect.Effect<AthenaData[], AthenaQueryError> =
  Effect.fn("Athena.results")(function* (client: AwsAthenaClient, queryExecutionId: string) {
    // Accumulate pages iteratively; recursive spreads copied every previously
    // fetched row per page and blew up memory on large result sets.
    const rows: AthenaData[] = []
    let nextToken: string | undefined
    while (true) {
      const result = yield* Effect.tryPromise({
        try: () =>
          client.send(
            new GetQueryResultsCommand({
              QueryExecutionId: queryExecutionId,
              NextToken: nextToken,
              MaxResults: ATHENA_PAGE_SIZE,
            }),
          ),
        catch: (cause) =>
          new AthenaQueryError({ message: "Failed to read Athena stats results", queryExecutionId, cause }),
      })
      const columns = result.ResultSet?.ResultSetMetadata?.ColumnInfo?.map((item) => item.Name ?? "") ?? []
      // The first page starts with the header row.
      for (const row of (result.ResultSet?.Rows ?? []).slice(nextToken ? 0 : 1)) rows.push(rowData(columns, row))
      if (!result.NextToken) return rows
      nextToken = result.NextToken
    }
  })

function rowData(columns: string[], row: Row): AthenaData {
  return Object.fromEntries(
    columns.flatMap((column, index) => {
      const value = row.Data?.[index]?.VarCharValue
      if (!column || value === undefined) return []
      return [[column, value]]
    }),
  )
}
