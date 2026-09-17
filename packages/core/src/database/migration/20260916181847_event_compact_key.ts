import { sql } from "drizzle-orm"
import { Effect } from "effect"
import { Durable } from "@opencode-ai/schema/durable-event-manifest"
import type { DatabaseMigration } from "../migration"

// Mirror of event.ts compactKeyValue: extract the compaction entity key from
// stored JSON for each event type's compact path.
function compactKeyValue(data: unknown, path: string): string | undefined {
  if (!path.startsWith("$.")) return undefined
  let current: unknown = data
  for (const segment of path.slice(2).split(".")) {
    if (typeof current !== "object" || current === null || !Object.hasOwn(current, segment)) return undefined
    current = Reflect.get(current, segment)
  }
  return typeof current === "string" ? current : undefined
}

// Mirror of event.ts accountingPart: step-finish rows must keep a NULL key, or
// a later live snapshot of the same part would sweep-delete the accounting
// rows during compaction.
function accountingPart(data: unknown): boolean {
  if (typeof data !== "object" || data === null) return false
  const part = Reflect.get(data, "part")
  return typeof part === "object" && part !== null && Reflect.get(part, "type") === "step-finish"
}

// Raw SQL bypasses drizzle's json-mode column mapping: `data` comes back as a
// serialized string, so it must be parsed before the key helpers run.
function parseData(raw: unknown): unknown {
  if (typeof raw !== "string") return raw
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

export default {
  id: "20260916181847_event_compact_key",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(sql`ALTER TABLE ${sql.identifier("event")} ADD ${sql.identifier("compact_key")} text;`)
      // Backfill existing rows so compaction and dedupe apply to pre-upgrade
      // data; a NULL key never matches the indexed lookup.
      for (const [type, definition] of Durable) {
        const path = definition.durable?.compact
        if (!path) continue
        const rows = yield* tx.all<{ id: string; data: unknown }>(
          sql`SELECT id, data FROM ${sql.identifier("event")} WHERE type = ${type} AND compact_key IS NULL`,
        )
        for (const row of rows) {
          const data = parseData(row.data)
          if (data === undefined || accountingPart(data)) continue
          const key = compactKeyValue(data, path)
          if (key === undefined) continue
          yield* tx.run(sql`UPDATE ${sql.identifier("event")} SET compact_key = ${key} WHERE id = ${row.id}`)
        }
      }
      yield* tx.run(
        sql`CREATE INDEX ${sql.identifier("event_aggregate_type_compact_key_idx")} ON ${sql.identifier("event")} (${sql.identifier("aggregate_id")},${sql.identifier("type")},${sql.identifier("compact_key")});`,
      )
    })
  },
} satisfies DatabaseMigration.Migration
