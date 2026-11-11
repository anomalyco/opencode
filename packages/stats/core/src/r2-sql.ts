import { Context, Effect, Layer, Schedule, Schema } from "effect"
import { Resource } from "./resource"

const R2_SQL_MAX_ROWS = 10_000
const R2_SQL_TIMEOUT_MS = 10 * 60_000
const R2SqlValue = Schema.Union([Schema.String, Schema.Number, Schema.Boolean, Schema.Null])
const R2SqlResponse = Schema.Struct({
  success: Schema.Boolean,
  result: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        request_id: Schema.String,
        rows: Schema.Array(Schema.Record(Schema.String, R2SqlValue)),
      }),
    ),
  ),
  errors: Schema.Array(Schema.Unknown),
})
const R2SqlApiError = Schema.Struct({ code: Schema.Number, message: Schema.String })
const decodeResponse = Schema.decodeUnknownEffect(Schema.fromJsonString(R2SqlResponse))

export type R2SqlData = Record<string, string>

export class R2SqlQueryError extends Error {
  readonly _tag = "R2SqlQueryError"
  readonly requestId?: string
  readonly status?: number
  readonly code?: number
  readonly rowLimit: boolean

  constructor(input: {
    message: string
    requestId?: string
    status?: number
    code?: number
    rowLimit?: boolean
    cause?: unknown
  }) {
    super(input.cause instanceof Error ? `${input.message}: ${input.cause.toString()}` : input.message, {
      cause: input.cause,
    })
    this.name = "R2SqlQueryError"
    this.requestId = input.requestId
    this.status = input.status
    this.code = input.code
    this.rowLimit = input.rowLimit ?? false
  }
}

// Retrying these repeats the same R2 SQL spend for the same failure: a rejected
// query, rejected credentials, or a result that will hit the row limit again.
export function isDeterministicR2SqlError(error: R2SqlQueryError) {
  if (isTransientR2SqlError(error)) return false
  return error.rowLimit || error.status === 400 || error.status === 401 || error.status === 403
}

// 40005 is a query timeout and 60104 an intermittent "Unprocessable Entity", both
// sent with 4xx statuses. fetch rejects with a TypeError when the connection drops.
function isTransientR2SqlError(error: R2SqlQueryError) {
  return (
    error.code === 40005 ||
    error.code === 60104 ||
    error.status === 429 ||
    (error.status !== undefined && error.status >= 500) ||
    error.cause instanceof TypeError
  )
}

export declare namespace R2Sql {
  export interface Service {
    readonly query: (query: string, columns?: readonly string[]) => Effect.Effect<R2SqlData[], R2SqlQueryError>
  }
}

export class R2Sql extends Context.Service<R2Sql, R2Sql.Service>()("@opencode/stats/R2Sql") {
  static readonly layer: Layer.Layer<R2Sql> = Layer.succeed(
    R2Sql,
    R2Sql.of({
      query: (query, columns) => queryR2SqlPages(query, columns, fetchRows),
    }),
  )
}

// Cursor columns must uniquely identify an aggregate row. Page after aggregation
// so distinct counts, averages, and country totals retain their original scope.
export const queryR2SqlPages = Effect.fn("R2Sql.query")(function* (
  query: string,
  columns: readonly string[] | undefined,
  fetchRows: (query: string) => Effect.Effect<R2SqlData[], R2SqlQueryError>,
) {
  const rows: R2SqlData[] = []
  let cursor: R2SqlData | undefined
  while (true) {
    const page = yield* Effect.suspend(() =>
      fetchRows(columns?.length ? pageQuery(query, columns, cursor) : query),
    ).pipe(
      // Retry only this page; a transient R2 failure must not discard the whole
      // period. Syntax, auth, row-limit, and request timeout errors still fail.
      Effect.retry({
        times: 2,
        schedule: Schedule.exponential("5 seconds"),
        while: isTransientR2SqlError,
      }),
    )
    if (page.length >= R2_SQL_MAX_ROWS && !columns?.length)
      return yield* Effect.fail(
        new R2SqlQueryError({ message: `R2 SQL stats query reached the ${R2_SQL_MAX_ROWS} row limit`, rowLimit: true }),
      )
    rows.push(...page)
    if (page.length < R2_SQL_MAX_ROWS) return rows
    cursor = page.at(-1)!
  }
})

function pageQuery(query: string, columns: readonly string[], cursor?: R2SqlData) {
  const keys = columns.map((column) => `COALESCE("${column.replace(/"/g, '""')}", '')`)
  const values = columns.map((column) => `'${(cursor?.[column] ?? "").replace(/'/g, "''")}'`)
  const after = keys.map((key, index) =>
    [
      ...keys.slice(0, index).map((prefix, before) => `${prefix} = ${values[before]}`),
      `${key} > ${values[index]}`,
    ].join(" AND "),
  )
  return `SELECT * FROM (${query}) AS stats_page
${cursor ? `WHERE ${after.map((condition) => `(${condition})`).join(" OR ")}` : ""}
ORDER BY ${keys.join(", ")}
LIMIT ${R2_SQL_MAX_ROWS}`
}

const fetchRows = Effect.fn("R2Sql.fetchRows")(function* (query: string) {
  const startedAt = Date.now()
  const response = yield* Effect.tryPromise({
    try: (signal) => {
      const options = {
        method: "POST",
        // Bun's fetch, used by the local CLI, otherwise stops at a five-minute
        // idle timer; Workers ignore the option. Bound the whole request and
        // cancel it when the sync is interrupted.
        timeout: false,
        signal: AbortSignal.any([signal, AbortSignal.timeout(R2_SQL_TIMEOUT_MS)]),
        headers: {
          Authorization: `Bearer ${Resource.R2SqlAuthToken.value}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query }),
      }
      return fetch(
        `https://api.sql.cloudflarestorage.com/api/v1/accounts/${Resource.R2Sql.accountId}/r2-sql/query/${Resource.R2Sql.bucket}`,
        options,
      )
    },
    catch: (cause) =>
      new R2SqlQueryError({
        message: `Failed to run R2 SQL stats query after ${Date.now() - startedAt}ms`,
        cause,
      }),
  })
  const body = yield* Effect.tryPromise({
    try: () => response.text(),
    catch: (cause) =>
      new R2SqlQueryError({ message: "Failed to read R2 SQL stats response", status: response.status, cause }),
  })
  const decoded = yield* decodeResponse(body).pipe(
    Effect.mapError(
      (cause) =>
        new R2SqlQueryError({
          message: "R2 SQL returned an invalid stats response",
          status: response.status,
          cause,
        }),
    ),
  )
  if (!response.ok || !decoded.success || !decoded.result)
    return yield* Effect.fail(
      new R2SqlQueryError({
        message: `R2 SQL stats query failed: ${JSON.stringify(decoded.errors)}`,
        requestId: decoded.result?.request_id,
        status: response.status,
        code: decoded.errors.find(Schema.is(R2SqlApiError))?.code,
      }),
    )

  return decoded.result.rows.map((row) =>
    Object.fromEntries(Object.entries(row).flatMap(([key, value]) => (value === null ? [] : [[key, String(value)]]))),
  )
})
