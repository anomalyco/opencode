import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260730195856_optional_session_title",
  disableForeignKeys: true,
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`__new_session\` (
          \`id\` text PRIMARY KEY,
          \`project_id\` text NOT NULL,
          \`workspace_id\` text,
          \`parent_id\` text,
          \`fork_session_id\` text,
          \`fork_boundary\` text,
          \`slug\` text NOT NULL,
          \`directory\` text NOT NULL,
          \`path\` text,
          \`title\` text,
          \`version\` text NOT NULL,
          \`share_url\` text,
          \`summary_additions\` integer,
          \`summary_deletions\` integer,
          \`summary_files\` integer,
          \`summary_diffs\` text,
          \`metadata\` text,
          \`cost\` real DEFAULT 0 NOT NULL,
          \`tokens_input\` integer DEFAULT 0 NOT NULL,
          \`tokens_output\` integer DEFAULT 0 NOT NULL,
          \`tokens_reasoning\` integer DEFAULT 0 NOT NULL,
          \`tokens_cache_read\` integer DEFAULT 0 NOT NULL,
          \`tokens_cache_write\` integer DEFAULT 0 NOT NULL,
          \`revert\` text,
          \`permission\` text,
          \`agent\` text,
          \`model\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          \`time_compacting\` integer,
          \`time_archived\` integer,
          \`time_suspended\` integer,
          CONSTRAINT \`fk_session_project_id_project_id_fk\` FOREIGN KEY (\`project_id\`) REFERENCES \`project\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(
        `INSERT INTO \`__new_session\`(\`id\`, \`project_id\`, \`workspace_id\`, \`parent_id\`, \`fork_session_id\`, \`fork_boundary\`, \`slug\`, \`directory\`, \`path\`, \`title\`, \`version\`, \`share_url\`, \`summary_additions\`, \`summary_deletions\`, \`summary_files\`, \`summary_diffs\`, \`metadata\`, \`cost\`, \`tokens_input\`, \`tokens_output\`, \`tokens_reasoning\`, \`tokens_cache_read\`, \`tokens_cache_write\`, \`revert\`, \`permission\`, \`agent\`, \`model\`, \`time_created\`, \`time_updated\`, \`time_compacting\`, \`time_archived\`, \`time_suspended\`) SELECT \`id\`, \`project_id\`, \`workspace_id\`, \`parent_id\`, \`fork_session_id\`, \`fork_boundary\`, \`slug\`, \`directory\`, \`path\`, \`title\`, \`version\`, \`share_url\`, \`summary_additions\`, \`summary_deletions\`, \`summary_files\`, \`summary_diffs\`, \`metadata\`, \`cost\`, \`tokens_input\`, \`tokens_output\`, \`tokens_reasoning\`, \`tokens_cache_read\`, \`tokens_cache_write\`, \`revert\`, \`permission\`, \`agent\`, \`model\`, \`time_created\`, \`time_updated\`, \`time_compacting\`, \`time_archived\`, \`time_suspended\` FROM \`session\`;`,
      )
      yield* tx.run(`DROP TABLE \`session\`;`)
      yield* tx.run(`ALTER TABLE \`__new_session\` RENAME TO \`session\`;`)
      yield* tx.run(`CREATE INDEX \`session_project_idx\` ON \`session\` (\`project_id\`);`)
      yield* tx.run(`CREATE INDEX \`session_workspace_idx\` ON \`session\` (\`workspace_id\`);`)
      yield* tx.run(`CREATE INDEX \`session_parent_idx\` ON \`session\` (\`parent_id\`);`)
      yield* tx.run(
        `CREATE INDEX \`session_time_suspended_idx\` ON \`session\` (\`time_suspended\`) WHERE "session"."time_suspended" is not null;`,
      )
    })
  },
} satisfies DatabaseMigration.Migration
