import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260613064154_session_depth_rootid",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`session\` ADD \`depth\` integer DEFAULT 1 NOT NULL;`)
      yield* tx.run(`ALTER TABLE \`session\` ADD \`root_id\` text;`)
      yield* tx.run(`CREATE INDEX \`session_root_idx\` ON \`session\` (\`root_id\`);`)
      // One-shot recursive backfill for existing rows (nested-agents Issue 3).
      // Walks every parent_id chain from its roots, stamping depth (root = 1)
      // and root_id (the topmost ancestor's id; NULL for roots/orphans, matching
      // the create-time convention). SQLite cannot reference a WITH RECURSIVE CTE
      // from UPDATE ... FROM, so the CTE lives in correlated subqueries instead.
      // Idempotent: re-running stamps the same values; orphans (parent_id points
      // at a deleted session, so the row never appears in `tree`) are left at the
      // depth=1/root_id=NULL defaults and treated as roots — the safest reading.
      // Existing chains deeper than the new limit are stamped, never truncated:
      // the spawn limit only gates NEW spawns, legacy deep sessions stay readable.
      yield* tx.run(`
        WITH RECURSIVE tree(id, root_id, depth) AS (
          SELECT id, id, 1 FROM session WHERE parent_id IS NULL
          UNION ALL
          SELECT s.id, t.root_id, t.depth + 1
          FROM session s JOIN tree t ON s.parent_id = t.id
        )
        UPDATE session SET
          depth = (SELECT depth FROM tree WHERE tree.id = session.id),
          root_id = CASE WHEN session.parent_id IS NULL THEN NULL
                         ELSE (SELECT root_id FROM tree WHERE tree.id = session.id) END
        WHERE EXISTS (SELECT 1 FROM tree WHERE tree.id = session.id)
      `)
    })
  },
} satisfies DatabaseMigration.Migration
