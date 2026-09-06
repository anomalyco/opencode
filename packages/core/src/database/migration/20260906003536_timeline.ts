import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

// Each existing Session, including copied forks, starts with an independent root.
// Rebuilds preserve IDs, payloads, sequence numbers and timestamps. Session dependents
// are evacuated inside this transaction so engines with mandatory FK cascades are safe.
const migration: DatabaseMigration.Migration = {
  id: "20260906003536_timeline",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`CREATE TABLE \`timeline\` (
          \`id\` text PRIMARY KEY,
          \`base_id\` text,
          \`base_seq\` integer,
          CONSTRAINT \`fk_timeline_base_id_timeline_id_fk\` FOREIGN KEY (\`base_id\`) REFERENCES \`timeline\`(\`id\`)
        );`)
      yield* tx.run(`INSERT INTO timeline (id) SELECT 'tl_' || id FROM session_v2`)
      yield* tx.run(`CREATE TABLE \`__new_session_message\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`timeline_id\` text NOT NULL,
          \`type\` text NOT NULL,
          \`seq\` integer NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          \`data\` text NOT NULL,
          CONSTRAINT \`fk_session_message_timeline_id_timeline_id_fk\` FOREIGN KEY (\`timeline_id\`) REFERENCES \`timeline\`(\`id\`) ON DELETE CASCADE
        );`)
      yield* tx.run(
        `INSERT INTO \`__new_session_message\` (\`id\`, \`session_id\`, \`timeline_id\`, \`type\`, \`seq\`, \`time_created\`, \`time_updated\`, \`data\`) SELECT \`id\`, \`session_id\`, 'tl_' || session_id, \`type\`, \`seq\`, \`time_created\`, \`time_updated\`, \`data\` FROM \`session_message\``,
      )
      yield* tx.run(`DROP TABLE \`session_message\``)
      yield* tx.run(`ALTER TABLE \`__new_session_message\` RENAME TO \`session_message\``)
      yield* tx.run(`CREATE TABLE __timeline_instruction_entry AS SELECT * FROM instruction_entry`)
      yield* tx.run(`DELETE FROM instruction_entry`)
      yield* tx.run(`CREATE TABLE __timeline_instruction_state AS SELECT * FROM instruction_state`)
      yield* tx.run(`DELETE FROM instruction_state`)
      yield* tx.run(`CREATE TABLE __timeline_session_inbox AS SELECT * FROM session_inbox`)
      yield* tx.run(`DELETE FROM session_inbox`)
      yield* tx.run(`CREATE TABLE __timeline_session_pending AS SELECT * FROM session_pending`)
      yield* tx.run(`DELETE FROM session_pending`)
      yield* tx.run(`CREATE TABLE \`__new_session_v2\` (
          \`id\` text PRIMARY KEY,
          \`timeline_id\` text NOT NULL,
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
          \`time_idle\` integer,
          \`time_viewed\` integer,
          \`idle_outcome\` text,
          \`time_compacting\` integer,
          \`time_archived\` integer,
          \`time_suspended\` integer,
          \`resume_attempts\` integer DEFAULT 0 NOT NULL,
          CONSTRAINT \`fk_session_v2_timeline_id_timeline_id_fk\` FOREIGN KEY (\`timeline_id\`) REFERENCES \`timeline\`(\`id\`),
          CONSTRAINT \`fk_session_v2_project_id_project_id_fk\` FOREIGN KEY (\`project_id\`) REFERENCES \`project\`(\`id\`) ON DELETE CASCADE
        );`)
      yield* tx.run(
        `INSERT INTO \`__new_session_v2\` (\`id\`, \`timeline_id\`, \`project_id\`, \`workspace_id\`, \`parent_id\`, \`fork_session_id\`, \`fork_boundary\`, \`slug\`, \`directory\`, \`path\`, \`title\`, \`version\`, \`share_url\`, \`summary_additions\`, \`summary_deletions\`, \`summary_files\`, \`summary_diffs\`, \`metadata\`, \`cost\`, \`tokens_input\`, \`tokens_output\`, \`tokens_reasoning\`, \`tokens_cache_read\`, \`tokens_cache_write\`, \`revert\`, \`permission\`, \`agent\`, \`model\`, \`time_created\`, \`time_updated\`, \`time_idle\`, \`time_viewed\`, \`idle_outcome\`, \`time_compacting\`, \`time_archived\`, \`time_suspended\`, \`resume_attempts\`) SELECT \`id\`, 'tl_' || id, \`project_id\`, \`workspace_id\`, \`parent_id\`, \`fork_session_id\`, \`fork_boundary\`, \`slug\`, \`directory\`, \`path\`, \`title\`, \`version\`, \`share_url\`, \`summary_additions\`, \`summary_deletions\`, \`summary_files\`, \`summary_diffs\`, \`metadata\`, \`cost\`, \`tokens_input\`, \`tokens_output\`, \`tokens_reasoning\`, \`tokens_cache_read\`, \`tokens_cache_write\`, \`revert\`, \`permission\`, \`agent\`, \`model\`, \`time_created\`, \`time_updated\`, \`time_idle\`, \`time_viewed\`, \`idle_outcome\`, \`time_compacting\`, \`time_archived\`, \`time_suspended\`, \`resume_attempts\` FROM \`session_v2\``,
      )
      yield* tx.run(`DROP TABLE \`session_v2\``)
      yield* tx.run(`ALTER TABLE \`__new_session_v2\` RENAME TO \`session_v2\``)
      yield* tx.run(`INSERT INTO instruction_entry SELECT * FROM __timeline_instruction_entry`)
      yield* tx.run(`DROP TABLE __timeline_instruction_entry`)
      yield* tx.run(`INSERT INTO instruction_state SELECT * FROM __timeline_instruction_state`)
      yield* tx.run(`DROP TABLE __timeline_instruction_state`)
      yield* tx.run(`INSERT INTO session_inbox SELECT * FROM __timeline_session_inbox`)
      yield* tx.run(`DROP TABLE __timeline_session_inbox`)
      yield* tx.run(`INSERT INTO session_pending SELECT * FROM __timeline_session_pending`)
      yield* tx.run(`DROP TABLE __timeline_session_pending`)
      yield* tx.run(
        `CREATE UNIQUE INDEX \`session_message_session_seq_idx\` ON \`session_message\` (\`session_id\`,\`seq\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`session_message_timeline_seq_idx\` ON \`session_message\` (\`timeline_id\`,\`seq\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`session_message_timeline_type_seq_idx\` ON \`session_message\` (\`timeline_id\`,\`type\`,\`seq\`);`,
      )
      yield* tx.run(`CREATE INDEX \`session_message_unsettled_idx\` ON \`session_message\` (\`timeline_id\`,\`seq\`) WHERE (("session_message"."type" = 'assistant' AND json_extract("session_message"."data", '$.time.completed') IS NULL)
            OR ("session_message"."type" IN ('shell', 'compaction') AND json_extract("session_message"."data", '$.status') = 'running'));`)
      yield* tx.run(
        `CREATE INDEX \`session_message_session_type_seq_idx\` ON \`session_message\` (\`session_id\`,\`type\`,\`seq\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`session_message_session_time_created_id_idx\` ON \`session_message\` (\`session_id\`,\`time_created\`,\`id\`);`,
      )
      yield* tx.run(`CREATE INDEX \`session_message_time_created_idx\` ON \`session_message\` (\`time_created\`);`)
      yield* tx.run(`CREATE INDEX \`session_v2_project_idx\` ON \`session_v2\` (\`project_id\`);`)
      yield* tx.run(`CREATE INDEX \`session_v2_workspace_idx\` ON \`session_v2\` (\`workspace_id\`);`)
      yield* tx.run(`CREATE INDEX \`session_v2_parent_idx\` ON \`session_v2\` (\`parent_id\`);`)
      yield* tx.run(
        `CREATE INDEX \`session_v2_time_suspended_idx\` ON \`session_v2\` (\`time_suspended\`) WHERE "session_v2"."time_suspended" is not null;`,
      )
    })
  },
}

export default migration
