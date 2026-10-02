import { and, eq, inArray } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { DatabaseError, DrizzleClient } from "../database"
import { modelRetention } from "../database/schema"
import { chunks, UPSERT_CHUNK_SIZE } from "./stat"

export type RetentionStatRow = typeof modelRetention.$inferInsert
export type RetentionStatAggregate = {
  cohortDate: string
  dataset: string
  tier: string
  provider: string
  model: string
  eligibleUsers: number
  retainedUsers: number
}

export declare namespace RetentionStatRepo {
  export interface Service {
    readonly available: () => Effect.Effect<boolean, DatabaseError>
    readonly replace: (
      rows: RetentionStatRow[],
      scope: { cohortDates: string[]; dataset: string; tier: string },
    ) => Effect.Effect<void, DatabaseError>
  }
}

export class RetentionStatRepo extends Context.Service<RetentionStatRepo, RetentionStatRepo.Service>()(
  "@opencode/stats/RetentionStatRepo",
) {
  static readonly layer: Layer.Layer<RetentionStatRepo, never, DrizzleClient> = Layer.effect(
    RetentionStatRepo,
    Effect.gen(function* () {
      const db = yield* DrizzleClient

      const available = Effect.fn("RetentionStatRepo.available")(function* () {
        return yield* Effect.tryPromise({
          try: async () => {
            try {
              await db.select({ id: modelRetention.id }).from(modelRetention).limit(1)
              return true
            } catch (cause) {
              if (isMissingRetentionTable(cause)) return false
              throw cause
            }
          },
          catch: (cause) => DatabaseError.make({ cause }),
        })
      })

      const replace = Effect.fn("RetentionStatRepo.replace")(function* (
        rows: RetentionStatRow[],
        scope: { cohortDates: string[]; dataset: string; tier: string },
      ) {
        if (scope.cohortDates.length === 0) return

        yield* Effect.tryPromise({
          try: () =>
            db
              .delete(modelRetention)
              .where(
                and(
                  inArray(modelRetention.cohort_date, scope.cohortDates),
                  eq(modelRetention.dataset, scope.dataset),
                  eq(modelRetention.tier, scope.tier),
                ),
              ),
          catch: (cause) => DatabaseError.make({ cause }),
        })
        yield* Effect.forEach(
          chunks(rows, UPSERT_CHUNK_SIZE),
          (chunk) =>
            Effect.tryPromise({
              try: () => db.insert(modelRetention).values(chunk),
              catch: (cause) => DatabaseError.make({ cause }),
            }),
          { discard: true },
        )
      })

      return RetentionStatRepo.of({ available, replace })
    }),
  )
}

export function rowsFromAggregates(aggregates: RetentionStatAggregate[]): RetentionStatRow[] {
  return aggregates.map((row) => ({
    cohort_date: row.cohortDate,
    dataset: row.dataset,
    tier: row.tier,
    provider: row.provider,
    model: row.model,
    eligible_users: row.eligibleUsers,
    retained_users: row.retainedUsers,
  }))
}

export function isMissingRetentionTable(cause: unknown): boolean {
  const text = errorText(cause).toLowerCase()
  return text.includes("model_retention") && text.includes("exist")
}

function errorText(cause: unknown): string {
  if (cause instanceof Error) return `${cause.message} ${errorText((cause as { cause?: unknown }).cause)}`
  if (typeof cause === "object" && cause)
    return Object.values(cause as Record<string, unknown>)
      .map(errorText)
      .join(" ")
  return String(cause)
}
