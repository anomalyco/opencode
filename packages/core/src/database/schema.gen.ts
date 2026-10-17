import { sql } from "drizzle-orm"
import { Effect } from "effect"
import { prefixedIdentifier } from "./drizzle.js"
import type { DatabaseMigration } from "./migration.js"
import { AccountStateTable, AccountTable, ControlAccountTable } from "../account/sql.js"
import { CredentialTable } from "../credential/sql.js"
import { EventSequenceTable, EventTable } from "../event/sql.js"
import { KVTable } from "../kv/sql.js"
import { PermissionTable } from "../permission/sql.js"
import { ProjectDirectoryTable, ProjectTable } from "../project/sql.js"
import {
  InstructionBlobTable,
  InstructionEntryTable,
  InstructionStateTable,
  SessionInboxTable,
  SessionMessageTable,
  SessionPendingTable,
  SessionTable,
} from "../session/sql.js"
import { WorkspaceTable } from "../workspace/sql.js"
import { WorktreeTable } from "../worktree/sql.js"

const schema: Omit<DatabaseMigration.Migration, "id"> = {
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(sql`
        CREATE TABLE ${AccountStateTable} (
          \`id\` integer PRIMARY KEY,
          \`active_account_id\` text,
          \`active_org_id\` text,
          CONSTRAINT \`fk_account_state_active_account_id_account_id_fk\` FOREIGN KEY (\`active_account_id\`) REFERENCES ${AccountTable}(\`id\`) ON DELETE SET NULL
        );
      `)
      yield* tx.run(sql`
        CREATE TABLE ${AccountTable} (
          \`id\` text PRIMARY KEY,
          \`email\` text NOT NULL,
          \`url\` text NOT NULL,
          \`access_token\` text NOT NULL,
          \`refresh_token\` text NOT NULL,
          \`token_expiry\` integer,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(sql`
        CREATE TABLE ${ControlAccountTable} (
          \`email\` text NOT NULL,
          \`url\` text NOT NULL,
          \`access_token\` text NOT NULL,
          \`refresh_token\` text NOT NULL,
          \`token_expiry\` integer,
          \`active\` integer NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`control_account_pk\` PRIMARY KEY(\`email\`, \`url\`)
        );
      `)
      yield* tx.run(sql`
        CREATE TABLE ${CredentialTable} (
          \`id\` text PRIMARY KEY,
          \`integration_id\` text,
          \`label\` text NOT NULL,
          \`value\` text NOT NULL,
          \`connector_id\` text,
          \`method_id\` text,
          \`active\` integer,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(sql`
        CREATE TABLE ${EventSequenceTable} (
          \`aggregate_id\` text PRIMARY KEY,
          \`seq\` integer NOT NULL,
          \`owner_id\` text
        );
      `)
      yield* tx.run(sql`
        CREATE TABLE ${EventTable} (
          \`id\` text PRIMARY KEY,
          \`aggregate_id\` text NOT NULL,
          \`seq\` integer NOT NULL,
          \`created\` integer DEFAULT 0 NOT NULL,
          \`type\` text NOT NULL,
          \`data\` text NOT NULL,
          CONSTRAINT \`fk_event_aggregate_id_event_sequence_aggregate_id_fk\` FOREIGN KEY (\`aggregate_id\`) REFERENCES ${EventSequenceTable}(\`aggregate_id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(sql`
        CREATE TABLE ${KVTable} (
          \`key\` text PRIMARY KEY,
          \`value\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(sql`
        CREATE TABLE ${PermissionTable} (
          \`id\` text PRIMARY KEY,
          \`project_id\` text NOT NULL,
          \`action\` text NOT NULL,
          \`resource\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_permission_project_id_project_id_fk\` FOREIGN KEY (\`project_id\`) REFERENCES ${ProjectTable}(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(sql`
        CREATE TABLE ${ProjectDirectoryTable} (
          \`project_id\` text NOT NULL,
          \`directory\` text NOT NULL,
          \`type\` text,
          \`strategy\` text,
          \`time_created\` integer NOT NULL,
          CONSTRAINT \`project_directory_pk\` PRIMARY KEY(\`project_id\`, \`directory\`),
          CONSTRAINT \`fk_project_directory_project_id_project_id_fk\` FOREIGN KEY (\`project_id\`) REFERENCES ${ProjectTable}(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(sql`
        CREATE TABLE ${ProjectTable} (
          \`id\` text PRIMARY KEY,
          \`worktree\` text NOT NULL,
          \`vcs\` text,
          \`name\` text,
          \`icon_url\` text,
          \`icon_url_override\` text,
          \`icon_color\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          \`time_initialized\` integer,
          \`time_active\` integer DEFAULT 0 NOT NULL,
          \`time_archived\` integer,
          \`sandboxes\` text NOT NULL,
          \`commands\` text
        );
      `)
      yield* tx.run(sql`
        CREATE TABLE ${InstructionBlobTable} (
          \`hash\` text PRIMARY KEY,
          \`value\` text
        );
      `)
      yield* tx.run(sql`
        CREATE TABLE ${InstructionEntryTable} (
          \`session_id\` text NOT NULL,
          \`key\` text NOT NULL,
          \`value\` text,
          \`removed\` integer DEFAULT false NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`instruction_entry_pk\` PRIMARY KEY(\`session_id\`, \`key\`),
          CONSTRAINT \`fk_instruction_entry_session_id_session_v2_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES ${SessionTable}(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(sql`
        CREATE TABLE ${InstructionStateTable} (
          \`session_id\` text PRIMARY KEY,
          \`epoch_start\` integer NOT NULL,
          \`through_seq\` integer NOT NULL,
          \`initial_values\` text NOT NULL,
          \`current_values\` text NOT NULL,
          CONSTRAINT \`fk_instruction_state_session_id_session_v2_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES ${SessionTable}(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(sql`
        CREATE TABLE ${SessionInboxTable} (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`type\` text NOT NULL,
          \`payload\` text NOT NULL,
          \`delivery\` text NOT NULL,
          \`enqueued_seq\` integer NOT NULL,
          \`time_created\` integer NOT NULL,
          CONSTRAINT \`fk_session_inbox_session_id_session_v2_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES ${SessionTable}(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(sql`
        CREATE TABLE ${SessionMessageTable} (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`type\` text NOT NULL,
          \`seq\` integer NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          \`data\` text NOT NULL,
          CONSTRAINT \`fk_session_message_session_id_session_v2_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES ${SessionTable}(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(sql`
        CREATE TABLE ${SessionPendingTable} (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`type\` text NOT NULL,
          \`data\` text NOT NULL,
          \`delivery\` text,
          \`admitted_seq\` integer NOT NULL,
          \`time_created\` integer NOT NULL,
          CONSTRAINT \`fk_session_pending_session_id_session_v2_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES ${SessionTable}(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(sql`
        CREATE TABLE ${SessionTable} (
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
          \`time_idle\` integer,
          \`time_viewed\` integer,
          \`idle_outcome\` text,
          \`time_compacting\` integer,
          \`time_archived\` integer,
          \`time_suspended\` integer,
          \`resume_attempts\` integer DEFAULT 0 NOT NULL,
          CONSTRAINT \`fk_session_v2_project_id_project_id_fk\` FOREIGN KEY (\`project_id\`) REFERENCES ${ProjectTable}(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(sql`
        CREATE TABLE ${WorkspaceTable} (
          \`id\` text PRIMARY KEY,
          \`provider\` text NOT NULL,
          \`binding\` text,
          \`created_at\` integer NOT NULL,
          \`last_used_at\` integer NOT NULL
        );
      `)
      yield* tx.run(sql`
        CREATE TABLE ${WorktreeTable} (
          \`project_id\` text NOT NULL,
          \`directory\` text NOT NULL,
          \`strategy\` text,
          \`time_created\` integer NOT NULL,
          CONSTRAINT \`worktree_pk\` PRIMARY KEY(\`project_id\`, \`directory\`),
          CONSTRAINT \`fk_worktree_project_id_project_id_fk\` FOREIGN KEY (\`project_id\`) REFERENCES ${ProjectTable}(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(
        sql`CREATE UNIQUE INDEX ${prefixedIdentifier("event_aggregate_seq_idx")} ON ${EventTable} (\`aggregate_id\`,\`seq\`);`,
      )
      yield* tx.run(
        sql`CREATE INDEX ${prefixedIdentifier("event_aggregate_type_seq_idx")} ON ${EventTable} (\`aggregate_id\`,\`type\`,\`seq\`);`,
      )
      yield* tx.run(
        sql`CREATE UNIQUE INDEX ${prefixedIdentifier("permission_project_action_resource_idx")} ON ${PermissionTable} (\`project_id\`,\`action\`,\`resource\`);`,
      )
      yield* tx.run(
        sql`CREATE INDEX ${prefixedIdentifier("session_inbox_session_delivery_seq_idx")} ON ${SessionInboxTable} (\`session_id\`,\`delivery\`,\`enqueued_seq\`);`,
      )
      yield* tx.run(
        sql`CREATE UNIQUE INDEX ${prefixedIdentifier("session_inbox_session_enqueued_seq_idx")} ON ${SessionInboxTable} (\`session_id\`,\`enqueued_seq\`);`,
      )
      yield* tx.run(
        sql`CREATE UNIQUE INDEX ${prefixedIdentifier("session_message_session_seq_idx")} ON ${SessionMessageTable} (\`session_id\`,\`seq\`);`,
      )
      yield* tx.run(
        sql`CREATE INDEX ${prefixedIdentifier("session_message_session_type_seq_idx")} ON ${SessionMessageTable} (\`session_id\`,\`type\`,\`seq\`);`,
      )
      yield* tx.run(
        sql`CREATE INDEX ${prefixedIdentifier("session_message_session_time_created_id_idx")} ON ${SessionMessageTable} (\`session_id\`,\`time_created\`,\`id\`);`,
      )
      yield* tx.run(
        sql`CREATE INDEX ${prefixedIdentifier("session_message_time_created_idx")} ON ${SessionMessageTable} (\`time_created\`);`,
      )
      yield* tx.run(
        sql`CREATE INDEX ${prefixedIdentifier("session_pending_session_delivery_seq_idx")} ON ${SessionPendingTable} (\`session_id\`,\`delivery\`,\`admitted_seq\`);`,
      )
      yield* tx.run(
        sql`CREATE UNIQUE INDEX ${prefixedIdentifier("session_pending_session_compaction_idx")} ON ${SessionPendingTable} (\`session_id\`) WHERE ${SessionPendingTable.type} = 'compaction';`,
      )
      yield* tx.run(
        sql`CREATE UNIQUE INDEX ${prefixedIdentifier("session_pending_session_admitted_seq_idx")} ON ${SessionPendingTable} (\`session_id\`,\`admitted_seq\`);`,
      )
      yield* tx.run(
        sql`CREATE INDEX ${prefixedIdentifier("session_v2_project_idx")} ON ${SessionTable} (\`project_id\`);`,
      )
      yield* tx.run(
        sql`CREATE INDEX ${prefixedIdentifier("session_v2_workspace_idx")} ON ${SessionTable} (\`workspace_id\`);`,
      )
      yield* tx.run(
        sql`CREATE INDEX ${prefixedIdentifier("session_v2_parent_idx")} ON ${SessionTable} (\`parent_id\`);`,
      )
      yield* tx.run(
        sql`CREATE INDEX ${prefixedIdentifier("session_v2_time_suspended_idx")} ON ${SessionTable} (\`time_suspended\`) WHERE ${SessionTable.time_suspended} is not null;`,
      )
    })
  },
}

export default schema
