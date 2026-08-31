import { Effect } from "effect"
import { DatabaseMigration } from "../migration"

export default {
  id: "20260831000000_personalization_tables",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE IF NOT EXISTS \`user_profile\` (
          \`user_id\` text PRIMARY KEY NOT NULL,
          \`profile_json\` text,
          \`user_vector\` blob,
          \`update_count\` integer DEFAULT 0,
          \`created_at\` integer NOT NULL,
          \`updated_at\` integer NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE IF NOT EXISTS \`personalization_memory\` (
          \`id\` text PRIMARY KEY NOT NULL,
          \`user_id\` text NOT NULL,
          \`tier\` text NOT NULL,
          \`category\` text NOT NULL,
          \`content\` text NOT NULL,
          \`confidence\` real DEFAULT 1.0,
          \`access_count\` integer DEFAULT 0,
          \`embedding\` blob,
          \`metadata\` text,
          \`created_at\` integer NOT NULL,
          \`updated_at\` integer NOT NULL,
          \`expires_at\` integer,
          CONSTRAINT \`fk_personalization_memory_user_id\` FOREIGN KEY (\`user_id\`) REFERENCES \`user_profile\`(\`user_id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE IF NOT EXISTS \`developer_behavior_event\` (
          \`id\` text PRIMARY KEY NOT NULL,
          \`user_id\` text NOT NULL,
          \`session_id\` text,
          \`event_type\` text NOT NULL,
          \`context_text\` text NOT NULL,
          \`inferred_key\` text,
          \`inferred_value\` text,
          \`weight\` real DEFAULT 1.0,
          \`applied\` integer DEFAULT 0,
          \`created_at\` integer NOT NULL
        );
      `)
    })
  },
} satisfies DatabaseMigration.Migration
