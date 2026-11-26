import { eq } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { DatabaseError, DrizzleClient } from "../database"
import { modelUserRecency } from "../database/schema"
import { errorText } from "./retention"
import { chunks, UPSERT_CHUNK_SIZE } from "./stat"

export type UserRecencyRow = typeof modelUserRecency.$inferInsert
// Whole UTC days: start inclusive, end exclusive.
export type UserRecencyWindow = { start: Date; end: Date }
export type UserRecencyAggregate = {
  dataset: string
  model: string
  lastActiveDate: string
  users: number
}

export declare namespace UserRecencyRepo {
  export interface Service {
    readonly available: () => Effect.Effect<boolean, DatabaseError>
    readonly replace: (rows: UserRecencyRow[], scope: { dataset: string }) => Effect.Effect<void, DatabaseError>
  }
}

export class UserRecencyRepo extends Context.Service<UserRecencyRepo, UserRecencyRepo.Service>()(
  "@opencode/data/UserRecencyRepo",
) {
  static readonly layer: Layer.Layer<UserRecencyRepo, never, DrizzleClient> = Layer.effect(
    UserRecencyRepo,
    Effect.gen(function* () {
      const db = yield* DrizzleClient

      const available = Effect.fn("UserRecencyRepo.available")(function* () {
        return yield* Effect.tryPromise({
          try: async () => {
            try {
              await db.select({ id: modelUserRecency.id }).from(modelUserRecency).limit(1)
              return true
            } catch (cause) {
              if (isMissingUserRecencyTable(cause)) return false
              throw cause
            }
          },
          catch: (cause) => DatabaseError.make({ cause }),
        })
      })

      const replace = Effect.fn("UserRecencyRepo.replace")(function* (
        rows: UserRecencyRow[],
        scope: { dataset: string },
      ) {
        // Readers never see a window emptied by an interrupted replace.
        yield* Effect.tryPromise({
          try: () =>
            db.transaction(async (tx) => {
              await tx.delete(modelUserRecency).where(eq(modelUserRecency.dataset, scope.dataset))
              for (const chunk of chunks(rows, UPSERT_CHUNK_SIZE)) await tx.insert(modelUserRecency).values(chunk)
            }),
          catch: (cause) => DatabaseError.make({ cause }),
        })
      })

      return UserRecencyRepo.of({ available, replace })
    }),
  )
}

// Two lake names can normalize to one model, so rows that share a key are summed.
export function rowsFromAggregates(aggregates: UserRecencyAggregate[], window: UserRecencyWindow): UserRecencyRow[] {
  const windowStart = window.start.toISOString().slice(0, 10)
  const windowEnd = window.end.toISOString().slice(0, 10)
  return [
    ...aggregates
      .reduce<Map<string, UserRecencyRow>>((result, row) => {
        const key = [row.dataset, row.model, row.lastActiveDate].join("\u0000")
        result.set(key, {
          dataset: row.dataset,
          model: row.model,
          last_active_date: row.lastActiveDate,
          users: (result.get(key)?.users ?? 0) + row.users,
          window_start: windowStart,
          window_end: windowEnd,
        })
        return result
      }, new Map())
      .values(),
  ]
}

export function isMissingUserRecencyTable(cause: unknown): boolean {
  const text = errorText(cause).toLowerCase()
  return text.includes("model_user_recency") && text.includes("exist")
}
