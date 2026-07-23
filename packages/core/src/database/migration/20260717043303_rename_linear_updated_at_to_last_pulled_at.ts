import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260717043303_rename_linear_updated_at_to_last_pulled_at",
  up(tx) {
    return Effect.gen(function* () {
      // Rename `linear_updated_at` → `last_pulled_at` to align the
      // pull-side watermark with the push-side `last_pushed_at`. The
      // column records the cloud-side `updatedAt` captured at the last
      // pull (ADR-0002 D5 revised). SQLite's RENAME COLUMN preserves
      // data and nullability; existing rows keep their watermark.
      //
      // Idempotent: the base migration `20260621201623_add_issue_table`
      // was amended to create `last_pulled_at` directly, so fresh
      // installs will NOT have a `linear_updated_at` column to rename.
      // Only existing installs that ran the original base migration
      // (with `linear_updated_at`) need this rename. The guard follows
      // the same pattern as `20260511173437_session-metadata`.
      const columns = yield* tx.all<{ name: string }>(`PRAGMA table_info(\`issue\`)`)
      const hasOldColumn = columns.some((column) => column.name === "linear_updated_at")
      if (!hasOldColumn) return
      yield* tx.run(`ALTER TABLE \`issue\` RENAME COLUMN \`linear_updated_at\` TO \`last_pulled_at\`;`)
    })
  },
} satisfies DatabaseMigration.Migration
