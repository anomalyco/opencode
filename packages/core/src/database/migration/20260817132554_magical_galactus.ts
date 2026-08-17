import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260817132554_magical_galactus",
  up(tx) {
    return Effect.gen(function* () {
      const sessionColumns = yield* tx.all<{ name: string }>(`PRAGMA table_info(\`session\`)`)
      yield* tx.run(`
        CREATE TABLE IF NOT EXISTS \`permission_decisions\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`permission\` text NOT NULL,
          \`patterns\` text NOT NULL,
          \`metadata\` text,
          \`verdict\` text NOT NULL,
          \`reason\` text,
          \`model\` text NOT NULL,
          \`latency_ms\` integer NOT NULL,
          \`created_at\` integer NOT NULL,
          CONSTRAINT \`fk_permission_decisions_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE IF NOT EXISTS \`session_auto_summary\` (
          \`session_id\` text PRIMARY KEY,
          \`summary\` text NOT NULL,
          \`model\` text NOT NULL,
          \`turn_count\` integer NOT NULL,
          \`updated_at\` integer NOT NULL,
          CONSTRAINT \`fk_session_auto_summary_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      if (!sessionColumns.some((column) => column.name === "permission_validator")) {
        yield* tx.run(`ALTER TABLE \`session\` ADD \`permission_validator\` text;`)
      }
      if (
        (yield* tx.all<{ name: string }>(`PRAGMA table_info(\`permission_decisions\`)`)).some(
          (column) => column.name === "prompt",
        )
      ) {
        // Older development builds briefly persisted the raw validator prompt.
        // Remove it when upgrading; the current schema never writes it.
        yield* tx.run(`UPDATE \`permission_decisions\` SET \`prompt\` = NULL WHERE \`prompt\` IS NOT NULL;`)
      }
      // Older development builds also persisted raw commands, paths, and
      // tool metadata in these columns. Existing rows are scrubbed before the
      // store's redaction boundary handles new decisions.
      yield* tx.run(`UPDATE \`permission_decisions\` SET \`patterns\` = '[]', \`metadata\` = NULL;`)
      yield* tx.run(
        `CREATE INDEX IF NOT EXISTS \`permission_decisions_session_idx\` ON \`permission_decisions\` (\`session_id\`);`,
      )
    })
  },
} satisfies DatabaseMigration.Migration
