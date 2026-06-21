import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260618000001_zero_assistant_tables",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE IF NOT EXISTS zero_user_profile (
          id TEXT PRIMARY KEY,
          name TEXT,
          email TEXT,
          timezone TEXT,
          preferences TEXT,
          bio TEXT,
          facts TEXT,
          time_created INTEGER NOT NULL,
          time_updated INTEGER NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE IF NOT EXISTS zero_personal_notes (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          content TEXT NOT NULL,
          tags TEXT,
          folder TEXT,
          pinned INTEGER,
          time_created INTEGER NOT NULL,
          time_updated INTEGER NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE IF NOT EXISTS zero_personal_reminders (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          description TEXT,
          due_at INTEGER,
          remind_at INTEGER,
          status TEXT,
          priority TEXT,
          category TEXT,
          recurring TEXT,
          time_created INTEGER NOT NULL,
          time_updated INTEGER NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE IF NOT EXISTS zero_personal_events (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          description TEXT,
          location TEXT,
          start_at INTEGER NOT NULL,
          end_at INTEGER,
          all_day INTEGER,
          recurring TEXT,
          source TEXT,
          source_id TEXT,
          time_created INTEGER NOT NULL,
          time_updated INTEGER NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE IF NOT EXISTS zero_personal_contacts (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT,
          phone TEXT,
          notes TEXT,
          metadata TEXT,
          time_created INTEGER NOT NULL,
          time_updated INTEGER NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE IF NOT EXISTS zero_personal_api_connections (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          base_url TEXT NOT NULL,
          auth_type TEXT,
          auth_value TEXT,
          headers TEXT,
          time_created INTEGER NOT NULL,
          time_updated INTEGER NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE IF NOT EXISTS zero_personal_knowledge (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          content TEXT NOT NULL,
          source TEXT,
          tags TEXT,
          embedding TEXT,
          time_created INTEGER NOT NULL,
          time_updated INTEGER NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE IF NOT EXISTS zero_personal_workflows (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          steps TEXT,
          trigger TEXT,
          active INTEGER,
          time_created INTEGER NOT NULL,
          time_updated INTEGER NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE IF NOT EXISTS zero_personal_watchers (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          type TEXT NOT NULL,
          target TEXT NOT NULL,
          condition TEXT,
          action TEXT,
          active INTEGER,
          last_triggered INTEGER,
          time_created INTEGER NOT NULL,
          time_updated INTEGER NOT NULL
        );
      `)
    })
  },
} satisfies DatabaseMigration.Migration
