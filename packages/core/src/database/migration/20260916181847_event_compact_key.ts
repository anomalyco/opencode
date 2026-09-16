import { Effect } from "effect"
import { Durable } from "@opencode-ai/schema/durable-event-manifest"
import type { DatabaseMigration } from "../migration"

// Mirror of event.ts compactKeyValue: extract the compaction entity key from
// stored JSON for each event type's compact path.
function compactKeyValue(data: unknown, path: string): string | undefined {
  if (!path.startsWith("$.")) return undefined
  let current: unknown = data
  for (const segment of path.slice(2).split(".")) {
    if (current === null || typeof current !== "object") return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return typeof current === "string" ? current : undefined
}

export default {
  id: "20260916181847_event_compact_key",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`event\` ADD \`compact_key\` text;`)
      // Backfill existing rows so compaction and dedupe apply to pre-upgrade
      // data; a NULL key never matches the indexed lookup.
      for (const [type, definition] of Durable) {
        const path = definition.durable?.compact
        if (!path) continue
        const rows = yield* tx.all<{ id: string; data: unknown }>(
          `SELECT id, data FROM \`event\` WHERE type = ${JSON.stringify(type)} AND compact_key IS NULL`,
        )
        for (const row of rows) {
          const key = compactKeyValue(row.data, path)
          if (key === undefined) continue
          yield* tx.run(
            `UPDATE \`event\` SET compact_key = ${JSON.stringify(key)} WHERE id = ${JSON.stringify(row.id)}`,
          )
        }
      }
      yield* tx.run(
        `CREATE INDEX \`event_aggregate_type_compact_key_idx\` ON \`event\` (\`aggregate_id\`,\`type\`,\`compact_key\`);`,
      )
    })
  },
} satisfies DatabaseMigration.Migration
