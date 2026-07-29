import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260729131500_agent-teams",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`team_member\` (
          \`team_id\` text NOT NULL,
          \`name\` text NOT NULL,
          \`session_id\` text NOT NULL,
          \`agent\` text NOT NULL,
          \`model\` text NOT NULL,
          \`role\` text NOT NULL,
          \`permission\` text NOT NULL,
          \`status\` text NOT NULL,
          \`current_task_id\` text,
          \`error\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`team_member_pk\` PRIMARY KEY(\`team_id\`, \`name\`),
          CONSTRAINT \`fk_team_member_team_id_team_id_fk\` FOREIGN KEY (\`team_id\`) REFERENCES \`team\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`fk_team_member_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`team_message\` (
          \`id\` text PRIMARY KEY,
          \`team_id\` text NOT NULL,
          \`from_name\` text NOT NULL,
          \`to_name\` text NOT NULL,
          \`body\` text NOT NULL,
          \`delivered\` integer DEFAULT false NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_delivered\` integer,
          CONSTRAINT \`fk_team_message_team_id_team_id_fk\` FOREIGN KEY (\`team_id\`) REFERENCES \`team\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`team\` (
          \`id\` text PRIMARY KEY,
          \`name\` text NOT NULL,
          \`lead_session_id\` text NOT NULL,
          \`status\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_team_lead_session_id_session_id_fk\` FOREIGN KEY (\`lead_session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`team_task\` (
          \`id\` text PRIMARY KEY,
          \`team_id\` text NOT NULL,
          \`title\` text NOT NULL,
          \`description\` text NOT NULL,
          \`status\` text NOT NULL,
          \`assignee\` text,
          \`dependencies\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_team_task_team_id_team_id_fk\` FOREIGN KEY (\`team_id\`) REFERENCES \`team\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`CREATE UNIQUE INDEX \`team_member_session_idx\` ON \`team_member\` (\`session_id\`);`)
      yield* tx.run(`CREATE INDEX \`team_member_team_status_idx\` ON \`team_member\` (\`team_id\`,\`status\`);`)
      yield* tx.run(
        `CREATE INDEX \`team_message_recipient_idx\` ON \`team_message\` (\`team_id\`,\`to_name\`,\`delivered\`,\`time_created\`);`,
      )
      yield* tx.run(`CREATE UNIQUE INDEX \`team_lead_session_idx\` ON \`team\` (\`lead_session_id\`);`)
      yield* tx.run(`CREATE INDEX \`team_task_team_status_idx\` ON \`team_task\` (\`team_id\`,\`status\`);`)
    })
  },
} satisfies DatabaseMigration.Migration
