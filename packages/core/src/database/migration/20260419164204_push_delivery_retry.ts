import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260419164204_push_delivery_retry",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE IF NOT EXISTS \`push_subscription\` (
          \`id\` text PRIMARY KEY,
          \`endpoint\` text NOT NULL,
          \`p256dh\` text NOT NULL,
          \`auth\` text NOT NULL,
          \`server_origin\` text NOT NULL,
          \`device_label\` text,
          \`expiration_time\` integer,
          \`enabled\` integer NOT NULL,
          \`notify_on_completion\` integer NOT NULL,
          \`notify_on_error\` integer NOT NULL,
          \`user_agent\` text,
          \`failure_count\` integer NOT NULL,
          \`last_error\` text,
          \`last_success_at\` integer,
          \`last_failure_at\` integer,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* addColumn("push_subscription", "server_origin", "`server_origin` text NOT NULL DEFAULT ''")
      yield* addColumn("push_subscription", "device_label", "`device_label` text")
      yield* addColumn("push_subscription", "failure_count", "`failure_count` integer NOT NULL DEFAULT 0")
      yield* addColumn("push_subscription", "last_success_at", "`last_success_at` integer")
      yield* addColumn("push_subscription", "last_failure_at", "`last_failure_at` integer")
      yield* tx.run(`
        CREATE TABLE IF NOT EXISTS \`push_delivery\` (
          \`id\` text PRIMARY KEY,
          \`subscription_id\` text NOT NULL,
          \`payload\` text NOT NULL,
          \`kind\` text NOT NULL,
          \`tag\` text NOT NULL,
          \`ttl_seconds\` integer NOT NULL,
          \`urgency\` text NOT NULL,
          \`attempt_count\` integer NOT NULL,
          \`next_attempt_at\` integer NOT NULL,
          \`last_error\` text,
          \`last_status\` integer,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
    })

    function addColumn(table: string, column: string, definition: string) {
      return Effect.gen(function* () {
        if ((yield* tx.all<{ name: string }>(`PRAGMA table_info(\`${table}\`)`)).some((item) => item.name === column))
          return
        yield* tx.run(`ALTER TABLE \`${table}\` ADD ${definition};`)
      })
    }
  },
} satisfies DatabaseMigration.Migration
