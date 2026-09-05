import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260803120000_teamjules_tasks",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`teamjules_task\` (
          \`id\` text PRIMARY KEY,
          \`type\` text DEFAULT 'manual' NOT NULL CHECK (\`type\` IN ('issue', 'pr', 'manual')),
          \`status\` text DEFAULT 'pending' NOT NULL CHECK (\`status\` IN ('pending', 'queued', 'running', 'completed', 'failed', 'cancelled')),
          \`repo\` text NOT NULL,
          \`branch\` text NOT NULL,
          \`prompt\` text NOT NULL,
          \`result\` text,
          \`session_id\` text,
          \`worker_id\` text,
          \`attempt_count\` integer DEFAULT 0 NOT NULL,
          \`max_attempts\` integer DEFAULT 3 NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(`CREATE INDEX \`teamjules_task_status_created_idx\` ON \`teamjules_task\` (\`status\`, \`time_created\`);`)
      yield* tx.run(`CREATE INDEX \`teamjules_task_repo_idx\` ON \`teamjules_task\` (\`repo\`);`)
      yield* tx.run(`CREATE INDEX \`teamjules_task_worker_idx\` ON \`teamjules_task\` (\`worker_id\`);`)

      yield* tx.run(`
        CREATE TABLE \`teamjules_worker\` (
          \`id\` text PRIMARY KEY,
          \`status\` text DEFAULT 'idle' NOT NULL CHECK (\`status\` IN ('idle', 'busy', 'offline')),
          \`last_heartbeat\` integer NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(`CREATE INDEX \`teamjules_worker_status_heartbeat_idx\` ON \`teamjules_worker\` (\`status\`, \`last_heartbeat\`);`)
    })
  },
} satisfies DatabaseMigration.Migration
