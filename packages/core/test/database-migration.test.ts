import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import { fileURLToPath } from "url"
import path from "path"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { Effect, Layer, Schema } from "effect"
import { eq, inArray, sql } from "drizzle-orm"
import { DatabaseMigration } from "@opencode-ai/core/database/migration"
import { migrations } from "@opencode-ai/core/database/migration.gen"
import sessionUsageMigration from "@opencode-ai/core/database/migration/20260510033149_session_usage"
import normalizeStoragePathsMigration from "@opencode-ai/core/database/migration/20260601010001_normalize_storage_paths"
import sessionMessageProjectionOrderMigration from "@opencode-ai/core/database/migration/20260603040000_session_message_projection_order"
import eventSourcedSessionInputMigration from "@opencode-ai/core/database/migration/20260604172448_event_sourced_session_input"
import contextEpochAgentMigration from "@opencode-ai/core/database/migration/20260605042240_add_context_epoch_agent"
import simplifyIntegrationCredentialsMigration from "@opencode-ai/core/database/migration/20260611192811_lush_chimera"
import simplifySessionInputMigration from "@opencode-ai/core/database/migration/20260622202450_simplify_session_input"
import resetSessionEventsMigration from "@opencode-ai/core/database/migration/20260703200000_reset_v2_session_events"
import durableSessionInboxMigration from "@opencode-ai/core/database/migration/20260707010146_durable_session_inbox"
import migratePrelaunchV2StateMigration from "@opencode-ai/core/database/migration/20260707120000_migrate_prelaunch_v2_state"
import renameInstructionsMigration from "@opencode-ai/core/database/migration/20260705180000_rename_instructions"
import addSessionForkMigration from "@opencode-ai/core/database/migration/20260706223930_add-session-fork"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { ProjectV2 } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionTable } from "@opencode-ai/core/session/sql"
import sessionMetadataMigration from "@opencode-ai/core/database/migration/20260511173437_session-metadata"
import type { SqlClient as SqlClientService } from "effect/unstable/sql/SqlClient"
import { Database } from "@opencode-ai/core/database/database"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { tmpdir } from "./fixture/tmpdir"

const run = <A, E>(effect: Effect.Effect<A, E, SqlClientService>) =>
  Effect.runPromise(
    effect.pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:", disableWAL: true })), Effect.scoped),
  )

const makeDb = EffectDrizzleSqlite.makeWithDefaults()

describe("DatabaseMigration", () => {
  test("migrates pre-launch V2 state in place", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* makeDb
        yield* db.run(
          sql`CREATE TABLE session_message (id text PRIMARY KEY, session_id text NOT NULL, type text NOT NULL, seq integer NOT NULL, time_created integer NOT NULL, time_updated integer NOT NULL, data text NOT NULL)`,
        )
        yield* db.run(
          sql`CREATE TABLE session_input (id text PRIMARY KEY, session_id text NOT NULL, type text NOT NULL, prompt text, delivery text, admitted_seq integer NOT NULL, promoted_seq integer, time_created integer NOT NULL)`,
        )
        yield* db.run(
          sql`CREATE TABLE event (id text PRIMARY KEY, aggregate_id text NOT NULL, seq integer NOT NULL, created integer NOT NULL, type text NOT NULL, data text NOT NULL)`,
        )
        yield* db.run(
          sql`CREATE TABLE event_sequence (aggregate_id text PRIMARY KEY, seq integer NOT NULL, owner_id text)`,
        )
        yield* db.run(
          sql`CREATE TABLE instruction_checkpoint (session_id text PRIMARY KEY, baseline text NOT NULL, snapshot text NOT NULL, baseline_seq integer NOT NULL)`,
        )
        const messages = [
          ["msg_skill", "skill", { name: "effect", text: "Use Effect", time: { created: 1 } }],
          [
            "msg_shell",
            "shell",
            {
              shell: { id: "sh_old", command: "pwd", status: "exited", exit: 0, cwd: "/tmp" },
              output: { output: "/tmp", cursor: 4, size: 4, truncated: false },
              time: { created: 2, completed: 3 },
            },
          ],
          [
            "msg_assistant",
            "assistant",
            {
              agent: "build",
              model: { id: "model", providerID: "provider" },
              content: [
                {
                  type: "tool",
                  id: "call_old",
                  name: "read",
                  provider: "removed",
                  state: { status: "pending", input: '{"path":"README.md"}', title: "removed" },
                  time: { created: 3 },
                },
              ],
              time: { created: 3 },
            },
          ],
          [
            "msg_failed",
            "compaction",
            {
              status: "failed",
              reason: "manual",
              summary: "removed",
              recent: "removed",
              time: { created: 4 },
            },
          ],
          [
            "msg_queued",
            "compaction",
            { status: "queued", reason: "manual", summary: "", recent: "", time: { created: 5 } },
          ],
          [
            "msg_synthetic",
            "synthetic",
            { sessionID: "ses_test", text: "context", description: "source", time: { created: 6 } },
          ],
          [
            "msg_running",
            "compaction",
            { status: "running", reason: "auto", summary: "partial", recent: "recent", time: { created: 7 } },
          ],
          [
            "msg_completed",
            "compaction",
            { status: "completed", reason: "auto", summary: "summary", recent: "recent", time: { created: 8 } },
          ],
        ] as const
        for (const [id, type, data] of messages)
          yield* db.run(
            sql`INSERT INTO session_message VALUES (${id}, 'ses_test', ${type}, 1, 10, 11, ${JSON.stringify(data)})`,
          )
        yield* db.run(
          sql`INSERT INTO session_input VALUES ('msg_queued', 'ses_test', 'compaction', NULL, NULL, 4, NULL, 5)`,
        )
        yield* db.run(sql`INSERT INTO event_sequence VALUES ('ses_test', 9, 'owner')`)
        yield* db.run(sql`INSERT INTO instruction_checkpoint VALUES ('ses_test', 'baseline', '{"source":"value"}', 7)`)
        const events = [
          ["evt_skill", 1, 101, "session.skill.activated.1", { sessionID: "ses_test", name: "effect", text: "Use" }],
          ["evt_started", 2, 102, "session.compaction.started.1", { sessionID: "ses_test", reason: "auto" }],
          ["evt_delta", 3, 103, "session.compaction.delta.1", { sessionID: "ses_test", text: "partial" }],
          ["evt_failed", 4, 104, "session.compaction.failed.1", { sessionID: "ses_test" }],
          [
            "evt_revert",
            5,
            105,
            "session.revert.staged.1",
            {
              sessionID: "ses_test",
              revert: {
                messageID: "msg_skill",
                snapshot: "tree",
                diff: "removed",
                files: [{ path: "src/a.ts", patch: "@@", additions: 1, deletions: 0, status: "modified" }],
              },
            },
          ],
          [
            "evt_skill_current",
            6,
            106,
            "session.skill.activated.2",
            { sessionID: "ses_test", id: "effect-id", name: "Effect", text: "Use" },
          ],
        ] as const
        for (const [id, seq, created, type, data] of events)
          yield* db.run(
            sql`INSERT INTO event VALUES (${id}, 'ses_test', ${seq}, ${created}, ${type}, ${JSON.stringify(data)})`,
          )

        yield* DatabaseMigration.applyOnly(db, [migratePrelaunchV2StateMigration])

        const rows = yield* db.all<{
          id: string
          type: string
          seq: number
          time_created: number
          time_updated: number
          data: string
        }>(sql`SELECT id, type, seq, time_created, time_updated, data FROM session_message ORDER BY id`)
        for (const row of rows)
          Schema.decodeUnknownSync(SessionMessage.Info)({ ...JSON.parse(row.data), id: row.id, type: row.type })
        expect(rows.every((row) => row.seq === 1 && row.time_created === 10 && row.time_updated === 11)).toBe(true)
        expect(rows.map((row) => [row.id, JSON.parse(row.data)])).toEqual([
          [
            "msg_assistant",
            expect.objectContaining({
              content: [expect.objectContaining({ state: { status: "streaming", input: '{"path":"README.md"}' } })],
            }),
          ],
          ["msg_completed", expect.objectContaining({ status: "completed", summary: "summary", recent: "recent" })],
          [
            "msg_failed",
            {
              time: { created: 4 },
              status: "failed",
              reason: "manual",
              error: {
                type: "compaction.failed",
                message: "Compaction failed before recording an error",
              },
            },
          ],
          ["msg_running", expect.objectContaining({ status: "running", summary: "partial", recent: "recent" })],
          ["msg_shell", expect.objectContaining({ shellID: "sh_old", command: "pwd", status: "exited", exit: 0 })],
          ["msg_skill", { time: { created: 1 }, skill: "effect", name: "effect", text: "Use Effect" }],
          ["msg_synthetic", { time: { created: 6 }, text: "context", description: "source" }],
        ])
        expect(yield* db.get(sql`SELECT * FROM session_input`)).toEqual({
          id: "msg_queued",
          session_id: "ses_test",
          type: "compaction",
          prompt: null,
          delivery: null,
          admitted_seq: 4,
          promoted_seq: null,
          time_created: 5,
        })
        const migratedEvents = yield* db.all<{
          id: string
          aggregate_id: string
          seq: number
          created: number
          type: string
          data: string
        }>(sql`SELECT * FROM event ORDER BY seq`)
        expect(migratedEvents.map((event) => ({ ...event, data: JSON.parse(event.data) }))).toEqual([
          {
            id: "evt_skill",
            aggregate_id: "ses_test",
            seq: 1,
            created: 101,
            type: "session.skill.activated.1",
            data: { sessionID: "ses_test", id: "effect", name: "effect", text: "Use" },
          },
          {
            id: "evt_started",
            aggregate_id: "ses_test",
            seq: 2,
            created: 102,
            type: "session.compaction.started.1",
            data: { sessionID: "ses_test", reason: "auto", recent: "" },
          },
          {
            id: "evt_failed",
            aggregate_id: "ses_test",
            seq: 4,
            created: 104,
            type: "session.compaction.failed.1",
            data: {
              sessionID: "ses_test",
              reason: "auto",
              error: {
                type: "compaction.failed",
                message: "Compaction failed before recording an error",
              },
            },
          },
          {
            id: "evt_revert",
            aggregate_id: "ses_test",
            seq: 5,
            created: 105,
            type: "session.revert.staged.1",
            data: {
              sessionID: "ses_test",
              revert: {
                messageID: "msg_skill",
                snapshot: "tree",
                files: [{ file: "src/a.ts", patch: "@@", additions: 1, deletions: 0, status: "modified" }],
              },
            },
          },
          {
            id: "evt_skill_current",
            aggregate_id: "ses_test",
            seq: 6,
            created: 106,
            type: "session.skill.activated.1",
            data: { sessionID: "ses_test", id: "effect-id", name: "Effect", text: "Use" },
          },
        ])
        expect(yield* db.get(sql`SELECT * FROM event_sequence`)).toEqual({
          aggregate_id: "ses_test",
          seq: 9,
          owner_id: "owner",
        })
        expect(yield* db.get(sql`SELECT * FROM instruction_checkpoint`)).toEqual({
          session_id: "ses_test",
          baseline: "baseline",
          snapshot: '{"source":"value"}',
          baseline_seq: 7,
        })
      }),
    )
  })

  test("resets incompatible V2 Session event history", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* makeDb
        yield* db.run(sql`CREATE TABLE session_input (id text PRIMARY KEY)`)
        yield* db.run(sql`CREATE TABLE session_message (id text PRIMARY KEY)`)
        yield* db.run(sql`CREATE TABLE event (id text PRIMARY KEY)`)
        yield* db.run(sql`CREATE TABLE event_sequence (aggregate_id text PRIMARY KEY, seq integer NOT NULL)`)
        yield* db.run(sql`INSERT INTO session_input (id) VALUES ('input')`)
        yield* db.run(sql`INSERT INTO session_message (id) VALUES ('message')`)
        yield* db.run(sql`INSERT INTO event (id) VALUES ('event')`)
        yield* db.run(sql`INSERT INTO event_sequence (aggregate_id, seq) VALUES ('session', 1)`)

        yield* DatabaseMigration.applyOnly(db, [resetSessionEventsMigration])

        expect(yield* db.get(sql`SELECT id FROM session_input`)).toBeUndefined()
        expect(yield* db.get(sql`SELECT id FROM session_message`)).toBeUndefined()
        expect(yield* db.get(sql`SELECT id FROM event`)).toBeUndefined()
        expect(yield* db.get(sql`SELECT aggregate_id FROM event_sequence`)).toBeUndefined()
      }),
    )
  })

  test("serializes concurrent embedded initialization for one database path", async () => {
    await using tmp = await tmpdir()
    const filename = path.join(tmp.path, "embedded.sqlite")
    const layers = [Database.layerFromPath(filename), Database.layerFromPath(filename)]

    await Effect.runPromise(
      Effect.all(
        layers.map((layer) => Effect.scoped(Layer.build(layer))),
        { concurrency: "unbounded" },
      ),
    )
  })
  if (process.platform === "linux") {
    test("declared schema has no ungenerated migrations", async () => {
      const result = await $`bun ${fileURLToPath(new URL("../script/migration.ts", import.meta.url))} --check`
        .quiet()
        .nothrow()
      expect(result.exitCode, result.stderr.toString()).toBe(0)
      expect(result.stdout.toString()).toContain("No schema changes, nothing to migrate")
    }, 30_000)
  }

  test("applies tracked migrations to an empty database", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* makeDb
        yield* DatabaseMigration.apply(db)

        expect(yield* db.get(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session'`)).toEqual({
          name: "session",
        })
        expect(
          yield* db.get(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session_input'`),
        ).toEqual({ name: "session_input" })
        expect(
          yield* db.get(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'instruction_checkpoint'`),
        ).toEqual({ name: "instruction_checkpoint" })
        expect(
          yield* db.get(
            sql`SELECT name FROM pragma_table_info('instruction_checkpoint') WHERE name IN ('agent', 'replacement_seq', 'revision')`,
          ),
        ).toBeUndefined()
        expect(yield* db.get(sql`SELECT count(*) as count FROM migration`)).toEqual({ count: migrations.length })
        expect(
          yield* db.all(
            sql`SELECT name FROM sqlite_master WHERE type = 'index' AND name IN ('event_aggregate_seq_idx', 'event_aggregate_type_seq_idx', 'session_input_session_pending_seq_idx', 'session_input_session_pending_delivery_seq_idx', 'session_input_session_pending_type_delivery_seq_idx', 'session_input_session_pending_compaction_idx', 'session_input_session_admitted_seq_idx', 'session_input_session_promoted_seq_idx', 'session_message_session_idx', 'session_message_session_type_idx', 'session_message_session_seq_idx', 'session_message_session_type_seq_idx', 'session_message_session_time_created_id_idx') ORDER BY name`,
          ),
        ).toEqual([
          { name: "event_aggregate_seq_idx" },
          { name: "event_aggregate_type_seq_idx" },
          { name: "session_input_session_admitted_seq_idx" },
          { name: "session_input_session_pending_compaction_idx" },
          { name: "session_input_session_pending_type_delivery_seq_idx" },
          { name: "session_input_session_promoted_seq_idx" },
          { name: "session_message_session_seq_idx" },
          { name: "session_message_session_time_created_id_idx" },
          { name: "session_message_session_type_seq_idx" },
        ])
      }),
    )
  })

  test("rejects a non-empty database without a session table", async () => {
    await expect(
      run(
        Effect.gen(function* () {
          const db = yield* makeDb
          yield* db.run(sql`CREATE TABLE unrelated (id text PRIMARY KEY)`)
          yield* DatabaseMigration.apply(db)
        }),
      ),
    ).rejects.toThrow("Database is not empty and has no session table")
  })

  test("backfills existing Context Epoch rows to the build agent", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* makeDb
        yield* db.run(
          sql`CREATE TABLE session_context_epoch (session_id text PRIMARY KEY, baseline text NOT NULL, snapshot text NOT NULL, baseline_seq integer NOT NULL, replacement_seq integer, revision integer DEFAULT 0 NOT NULL)`,
        )
        yield* db.run(
          sql`INSERT INTO session_context_epoch (session_id, baseline, snapshot, baseline_seq) VALUES ('ses_existing', 'baseline', '{}', 0)`,
        )

        yield* DatabaseMigration.applyOnly(db, [contextEpochAgentMigration])

        expect(yield* db.get(sql`SELECT agent FROM session_context_epoch WHERE session_id = 'ses_existing'`)).toEqual({
          agent: "build",
        })
      }),
    )
  })

  test("separates existing fork provenance from subagent hierarchy", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* makeDb
        yield* db.run(sql`CREATE TABLE session (id text PRIMARY KEY, parent_id text)`)
        yield* db.run(
          sql`CREATE TABLE event (aggregate_id text NOT NULL, seq integer NOT NULL, type text NOT NULL, data text NOT NULL)`,
        )
        yield* db.run(sql`INSERT INTO session VALUES ('ses_source', NULL), ('ses_fork', 'ses_source')`)
        yield* db.run(
          sql`INSERT INTO event VALUES ('ses_fork', 0, 'session.forked', '{"sessionID":"ses_fork","parentID":"ses_source","from":"msg_boundary"}')`,
        )

        yield* DatabaseMigration.applyOnly(db, [addSessionForkMigration])

        expect(
          yield* db.get(sql`SELECT parent_id, fork_session_id, fork_message_id FROM session WHERE id = 'ses_fork'`),
        ).toEqual({
          parent_id: null,
          fork_session_id: "ses_source",
          fork_message_id: "msg_boundary",
        })
        expect(
          yield* db.get(sql`SELECT parent_id, fork_session_id, fork_message_id FROM session WHERE id = 'ses_source'`),
        ).toEqual({
          parent_id: null,
          fork_session_id: null,
          fork_message_id: null,
        })
      }),
    )
  })

  test("renames instruction state without losing rows or durable updates", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* makeDb
        yield* db.run(sql`CREATE TABLE session (id text PRIMARY KEY)`)
        yield* db.run(
          sql`CREATE TABLE session_context_entry (session_id text NOT NULL, key text NOT NULL, value text NOT NULL, time_created integer NOT NULL, time_updated integer NOT NULL, PRIMARY KEY(session_id, key))`,
        )
        yield* db.run(
          sql`CREATE TABLE session_context_epoch (session_id text PRIMARY KEY, baseline text NOT NULL, snapshot text NOT NULL, baseline_seq integer NOT NULL)`,
        )
        yield* db.run(sql`CREATE TABLE event (type text NOT NULL)`)
        yield* db.run(sql`INSERT INTO session_context_entry VALUES ('ses_test', 'plan', '"ready"', 1, 2)`)
        yield* db.run(sql`INSERT INTO session_context_epoch VALUES ('ses_test', 'baseline', '{}', 7)`)
        yield* db.run(sql`INSERT INTO event VALUES ('session.context.updated.1')`)

        yield* DatabaseMigration.applyOnly(db, [renameInstructionsMigration])

        expect(yield* db.get(sql`SELECT * FROM instruction_entry`)).toEqual({
          session_id: "ses_test",
          key: "plan",
          value: '"ready"',
          time_created: 1,
          time_updated: 2,
        })
        expect(yield* db.get(sql`SELECT * FROM instruction_checkpoint`)).toEqual({
          session_id: "ses_test",
          baseline: "baseline",
          snapshot: "{}",
          baseline_seq: 7,
        })
        expect(yield* db.get(sql`SELECT type FROM event`)).toEqual({ type: "session.instructions.updated.1" })
      }),
    )
  })

  test("keeps legacy credential fields nullable", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* makeDb
        yield* db.run(
          sql`CREATE TABLE credential (id text PRIMARY KEY, connector_id text NOT NULL, method_id text NOT NULL, label text NOT NULL, value text NOT NULL, active integer DEFAULT false NOT NULL, time_created integer NOT NULL, time_updated integer NOT NULL)`,
        )
        yield* db.run(
          sql`CREATE UNIQUE INDEX credential_connector_active_idx ON credential (connector_id) WHERE active = 1`,
        )
        yield* DatabaseMigration.applyOnly(db, [simplifyIntegrationCredentialsMigration])

        yield* db.run(
          sql`INSERT INTO credential (id, connector_id, method_id, label, value, active, time_created, time_updated) VALUES ('legacy', 'openai', 'oauth', 'Legacy', '{}', 1, 1, 1)`,
        )
        yield* db.run(
          sql`INSERT INTO credential (id, integration_id, label, value, time_created, time_updated) VALUES ('current', 'anthropic', 'Current', '{}', 2, 2)`,
        )
        expect(yield* db.get(sql`SELECT connector_id, method_id, active FROM credential WHERE id = 'current'`)).toEqual(
          { connector_id: null, method_id: null, active: null },
        )
      }),
    )
  })

  test("resets beta history and rebuilds event-sourced Session input storage", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* makeDb
        yield* db.run(sql`CREATE TABLE session (id text PRIMARY KEY, workspace_id text)`)
        yield* db.run(sql`CREATE TABLE workspace (id text PRIMARY KEY)`)
        yield* db.run(sql`CREATE TABLE message (id text PRIMARY KEY)`)
        yield* db.run(sql`CREATE TABLE part (id text PRIMARY KEY)`)
        yield* db.run(sql`CREATE TABLE event_sequence (aggregate_id text PRIMARY KEY, seq integer NOT NULL)`)
        yield* db.run(
          sql`CREATE TABLE event (id text PRIMARY KEY, aggregate_id text NOT NULL, seq integer NOT NULL, type text NOT NULL, data text NOT NULL)`,
        )
        yield* db.run(sql`CREATE INDEX event_aggregate_seq_idx ON event (aggregate_id, seq)`)
        yield* db.run(sql`CREATE INDEX event_aggregate_type_seq_idx ON event (aggregate_id, type, seq)`)
        yield* db.run(
          sql`CREATE TABLE session_message (id text PRIMARY KEY, session_id text NOT NULL, type text NOT NULL, seq integer NOT NULL, time_created integer NOT NULL, time_updated integer NOT NULL, data text NOT NULL)`,
        )
        yield* db.run(sql`CREATE INDEX session_message_session_seq_idx ON session_message (session_id, seq)`)
        yield* db.run(
          sql`CREATE TABLE session_input (seq integer PRIMARY KEY AUTOINCREMENT, id text NOT NULL UNIQUE, session_id text NOT NULL, prompt text NOT NULL, delivery text NOT NULL, promoted_seq integer, time_created integer NOT NULL)`,
        )
        yield* db.run(
          sql`CREATE INDEX session_input_session_pending_delivery_seq_idx ON session_input (session_id, promoted_seq, delivery, seq)`,
        )
        yield* db.run(sql`INSERT INTO session (id, workspace_id) VALUES ('session', 'wrk_old')`)
        yield* db.run(sql`INSERT INTO workspace (id) VALUES ('wrk_old')`)
        yield* db.run(sql`INSERT INTO message (id) VALUES ('message')`)
        yield* db.run(sql`INSERT INTO part (id) VALUES ('part')`)
        yield* db.run(sql`INSERT INTO event_sequence (aggregate_id, seq) VALUES ('session', 0)`)
        yield* db.run(
          sql`INSERT INTO event (id, aggregate_id, seq, type, data) VALUES ('evt_old', 'session', 0, 'old.1', '{}')`,
        )
        yield* db.run(
          sql`INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data) VALUES ('msg_old', 'session', 'user', 0, 1, 1, '{}')`,
        )
        yield* db.run(
          sql`INSERT INTO session_input (id, session_id, prompt, delivery, time_created) VALUES ('msg_pending', 'session', '{}', 'steer', 1)`,
        )

        yield* DatabaseMigration.applyOnly(db, [eventSourcedSessionInputMigration])

        expect(yield* db.all(sql`SELECT id, workspace_id FROM session`)).toEqual([
          { id: "session", workspace_id: null },
        ])
        expect(yield* db.all(sql`SELECT id FROM workspace`)).toEqual([])
        expect(yield* db.all(sql`SELECT id FROM message`)).toEqual([{ id: "message" }])
        expect(yield* db.all(sql`SELECT id FROM part`)).toEqual([{ id: "part" }])
        expect(yield* db.all(sql`SELECT id FROM event`)).toEqual([])
        expect(yield* db.all(sql`SELECT aggregate_id FROM event_sequence`)).toEqual([])
        expect(yield* db.all(sql`SELECT id FROM session_message`)).toEqual([])
        expect(yield* db.all(sql`SELECT id FROM session_input`)).toEqual([])
        expect(
          (yield* db.all<{ name: string }>(sql`PRAGMA table_info(session_input)`)).map((column) => column.name),
        ).toEqual(["id", "session_id", "prompt", "delivery", "admitted_seq", "promoted_seq", "time_created"])
        expect(
          (yield* db.all<{ name: string; unique: number }>(sql`PRAGMA index_list(session_message)`)).find(
            (index) => index.name === "session_message_session_seq_idx",
          ),
        ).toMatchObject({ unique: 1 })
        expect(
          (yield* db.all<{ name: string; unique: number }>(sql`PRAGMA index_list(event)`)).find(
            (index) => index.name === "event_aggregate_seq_idx",
          ),
        ).toMatchObject({ unique: 1 })
        expect(
          (yield* db.all<{ name: string; unique: number }>(sql`PRAGMA index_list(session_input)`)).filter((index) =>
            ["session_input_session_admitted_seq_idx", "session_input_session_promoted_seq_idx"].includes(index.name),
          ),
        ).toEqual([
          expect.objectContaining({ name: "session_input_session_promoted_seq_idx", unique: 1 }),
          expect.objectContaining({ name: "session_input_session_admitted_seq_idx", unique: 1 }),
        ])
      }),
    )
  })

  test("preserves canonical V1 state and restarts its event stream", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* makeDb
        yield* db.run(sql`PRAGMA foreign_keys = ON`)
        yield* DatabaseMigration.apply(db)
        yield* db.run(
          sql`INSERT INTO project (id, worktree, time_created, time_updated, sandboxes) VALUES ('global', '/project', 1, 1, '[]')`,
        )
        yield* db.run(
          sql`INSERT INTO workspace (id, type, project_id, time_used) VALUES ('workspace', 'local', 'global', 1)`,
        )
        yield* db.run(
          sql`INSERT INTO session (id, project_id, workspace_id, slug, directory, title, version, time_created, time_updated) VALUES ('session', 'global', 'workspace', 'session', '/project', 'Before', 'test', 1, 1)`,
        )
        yield* db.run(
          sql`INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES ('message', 'session', 1, 1, '{}')`,
        )
        yield* db.run(
          sql`INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES ('part', 'message', 'session', 1, 1, '{}')`,
        )
        yield* db.run(sql`INSERT INTO event_sequence (aggregate_id, seq) VALUES ('session', 9)`)
        yield* db.run(
          sql`INSERT INTO event (id, aggregate_id, seq, type, data, created) VALUES ('event', 'session', 9, 'session.updated.1', '{}', 1)`,
        )
        yield* db.run(
          sql`INSERT INTO session_input (id, session_id, type, prompt, delivery, admitted_seq, time_created) VALUES ('input', 'session', 'prompt', '{}', 'steer', 9, 1)`,
        )
        yield* db.run(
          sql`INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data) VALUES ('projected', 'session', 'user', 9, 1, 1, '{}')`,
        )
        yield* db.run(
          sql`INSERT INTO instruction_checkpoint (session_id, baseline, snapshot, baseline_seq) VALUES ('session', 'baseline', '{}', 9)`,
        )
        yield* db.run(sql`ALTER TABLE instruction_checkpoint RENAME TO session_context_epoch`)
        yield* db.run(sql`DELETE FROM migration WHERE id = ${simplifySessionInputMigration.id}`)
        yield* DatabaseMigration.applyOnly(db, [simplifySessionInputMigration])
        yield* db.run(sql`ALTER TABLE session_context_epoch RENAME TO instruction_checkpoint`)

        const database = Layer.succeed(Database.Service, { db })
        yield* EventV2.Service.use((service) =>
          service.publish(SessionV1.Event.Updated, {
            sessionID: SessionSchema.ID.make("session"),
            info: {
              id: SessionSchema.ID.make("session"),
              slug: "session",
              projectID: ProjectV2.ID.global,
              directory: "/project",
              title: "After",
              version: "test",
              time: { created: 1, updated: 2 },
            },
          }),
        ).pipe(
          Effect.provide(
            AppNodeBuilder.build(LayerNode.group([EventV2.node, SessionProjector.node]), [[Database.node, database]]),
          ),
        )

        expect(
          yield* db.get(sql`
            SELECT
              (SELECT title FROM session WHERE id = 'session') AS title,
              (SELECT workspace_id FROM session WHERE id = 'session') AS workspaceID,
              (SELECT COUNT(*) FROM message WHERE id = 'message') AS messages,
              (SELECT COUNT(*) FROM part WHERE id = 'part') AS parts,
              (SELECT COUNT(*) FROM workspace) AS workspaces,
              (SELECT COUNT(*) FROM session_input) AS sessionInputs,
              (SELECT COUNT(*) FROM session_message) AS sessionMessages,
              (SELECT COUNT(*) FROM instruction_checkpoint) AS instructionCheckpoints,
              (SELECT seq FROM event_sequence WHERE aggregate_id = 'session') AS seq,
              (SELECT type FROM event WHERE aggregate_id = 'session') AS eventType
          `),
        ).toEqual({
          title: "After",
          workspaceID: null,
          messages: 1,
          parts: 1,
          workspaces: 0,
          sessionInputs: 0,
          sessionMessages: 0,
          instructionCheckpoints: 0,
          seq: 0,
          eventType: "session.updated.1",
        })
      }),
    )
  })

  test("preserves admitted prompts while generalizing the durable inbox", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* makeDb
        yield* db.run(
          sql`CREATE TABLE session_input (id text PRIMARY KEY, session_id text NOT NULL, prompt text NOT NULL, delivery text NOT NULL, admitted_seq integer NOT NULL, promoted_seq integer, time_created integer NOT NULL)`,
        )
        yield* db.run(
          sql`INSERT INTO session_input (id, session_id, prompt, delivery, admitted_seq, promoted_seq, time_created) VALUES ('input', 'session', '{"text":"hello"}', 'steer', 4, NULL, 1)`,
        )

        yield* DatabaseMigration.applyOnly(db, [durableSessionInboxMigration])

        expect(
          yield* db.all(
            sql`SELECT id, type, prompt, delivery, admitted_seq, promoted_seq FROM session_input ORDER BY admitted_seq`,
          ),
        ).toEqual([
          {
            id: "input",
            type: "prompt",
            prompt: '{"text":"hello"}',
            delivery: "steer",
            admitted_seq: 4,
            promoted_seq: null,
          },
        ])
      }),
    )
  })

  test("resets incompatible projected Session messages before adding sequence order", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* makeDb
        yield* db.run(sql`CREATE TABLE session (id text PRIMARY KEY)`)
        yield* db.run(
          sql`CREATE TABLE message (id text PRIMARY KEY, session_id text NOT NULL, time_created integer NOT NULL, time_updated integer NOT NULL, data text NOT NULL)`,
        )
        yield* db.run(
          sql`CREATE TABLE part (id text PRIMARY KEY, message_id text NOT NULL, session_id text NOT NULL, time_created integer NOT NULL, time_updated integer NOT NULL, data text NOT NULL)`,
        )
        yield* db.run(sql`CREATE TABLE event (id text PRIMARY KEY, seq integer NOT NULL)`)
        yield* db.run(
          sql`CREATE TABLE session_message (id text PRIMARY KEY, session_id text NOT NULL, type text NOT NULL, time_created integer NOT NULL, time_updated integer NOT NULL, data text NOT NULL)`,
        )
        yield* db.run(
          sql`CREATE INDEX session_message_session_time_created_id_idx ON session_message (session_id, time_created, id)`,
        )
        yield* db.run(
          sql`CREATE INDEX session_message_session_type_time_created_id_idx ON session_message (session_id, type, time_created, id)`,
        )
        yield* db.run(sql`INSERT INTO session (id) VALUES ('session')`)
        yield* db.run(
          sql`INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES ('legacy_message', 'session', 1, 1, '{"role":"user"}')`,
        )
        yield* db.run(
          sql`INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES ('legacy_part', 'legacy_message', 'session', 1, 1, '{"type":"text","text":"hello"}')`,
        )
        yield* db.run(
          sql`INSERT INTO session_message (id, session_id, type, time_created, time_updated, data) VALUES ('stale_projection', 'session', 'user', 1, 1, '{}')`,
        )

        yield* DatabaseMigration.applyOnly(db, [sessionMessageProjectionOrderMigration])

        expect(yield* db.all(sql`SELECT id, session_id, data FROM message`)).toEqual([
          { id: "legacy_message", session_id: "session", data: '{"role":"user"}' },
        ])
        expect(yield* db.all(sql`SELECT id, message_id, session_id, data FROM part`)).toEqual([
          {
            id: "legacy_part",
            message_id: "legacy_message",
            session_id: "session",
            data: '{"type":"text","text":"hello"}',
          },
        ])
        expect(yield* db.all(sql`SELECT id FROM session_message`)).toEqual([])

        yield* db.run(
          sql`INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data) VALUES ('fresh_projection', 'session', 'user', 7, 2, 2, '{}')`,
        )
        expect(yield* db.get(sql`SELECT id, seq FROM session_message`)).toEqual({ id: "fresh_projection", seq: 7 })
      }),
    )
  })

  test("runs session usage backfill in order with schema changes", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* makeDb
        yield* db.run(sql`CREATE TABLE session (id text PRIMARY KEY, time_updated integer NOT NULL)`)
        yield* db.run(sql`CREATE TABLE message (id text PRIMARY KEY, session_id text NOT NULL, data text NOT NULL)`)
        yield* db.run(sql`INSERT INTO session (id, time_updated) VALUES ('session_1', 1)`)
        yield* db.run(
          sql`INSERT INTO message (id, session_id, data) VALUES ('message_1', 'session_1', '{"role":"assistant","cost":1.25,"tokens":{"input":2,"output":3,"reasoning":4,"cache":{"read":5,"write":6}}}')`,
        )

        yield* DatabaseMigration.applyOnly(db, [sessionUsageMigration])

        expect(
          yield* db.get(
            sql`SELECT cost, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write FROM session WHERE id = 'session_1'`,
          ),
        ).toEqual({
          cost: 1.25,
          tokens_input: 2,
          tokens_output: 3,
          tokens_reasoning: 4,
          tokens_cache_read: 5,
          tokens_cache_write: 6,
        })
      }),
    )
  })

  test("normalizes Windows storage paths and leaves POSIX paths untouched", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* makeDb
        yield* db.run(sql`CREATE TABLE project (id text PRIMARY KEY, worktree text NOT NULL, sandboxes text NOT NULL)`)
        yield* db.run(sql`CREATE TABLE session (id text PRIMARY KEY, directory text NOT NULL, path text)`)
        // Windows-shaped rows (drive + backslash) must be normalized.
        yield* db.run(
          sql`INSERT INTO project (id, worktree, sandboxes) VALUES (${"win"}, ${"C:\\Repo\\Thing"}, ${JSON.stringify([
            "C:\\Repo\\Thing\\sandbox",
          ])})`,
        )
        yield* db.run(
          sql`INSERT INTO session (id, directory, path) VALUES (${"win"}, ${"C:\\Repo\\Thing\\packages\\api"}, ${"packages\\api"})`,
        )
        // UNC worktrees and their sandboxes must normalize too (not just drive paths).
        yield* db.run(
          sql`INSERT INTO project (id, worktree, sandboxes) VALUES (${"unc"}, ${"\\\\server\\share"}, ${JSON.stringify([
            "\\\\server\\share\\sandbox",
          ])})`,
        )
        // The "/" worktree sentinel and POSIX paths (including a pathological
        // backslash in a POSIX filename) must survive byte-for-byte.
        yield* db.run(sql`INSERT INTO project (id, worktree, sandboxes) VALUES (${"global"}, ${"/"}, ${"[]"})`)
        yield* db.run(
          sql`INSERT INTO session (id, directory, path) VALUES (${"posix"}, ${"/home/me/we\\ird"}, ${"src\\weird"})`,
        )

        yield* DatabaseMigration.applyOnly(db, [normalizeStoragePathsMigration])

        expect(yield* db.get(sql`SELECT worktree, sandboxes FROM project WHERE id = 'win'`)).toEqual({
          worktree: "C:/Repo/Thing",
          sandboxes: JSON.stringify(["C:/Repo/Thing/sandbox"]),
        })
        expect(yield* db.get(sql`SELECT directory, path FROM session WHERE id = 'win'`)).toEqual({
          directory: "C:/Repo/Thing/packages/api",
          path: "packages/api",
        })
        expect(yield* db.get(sql`SELECT worktree, sandboxes FROM project WHERE id = 'unc'`)).toEqual({
          worktree: "//server/share",
          sandboxes: JSON.stringify(["//server/share/sandbox"]),
        })
        expect(yield* db.get(sql`SELECT worktree FROM project WHERE id = 'global'`)).toEqual({ worktree: "/" })
        expect(yield* db.get(sql`SELECT directory, path FROM session WHERE id = 'posix'`)).toEqual({
          directory: "/home/me/we\\ird",
          path: "src\\weird",
        })
      }),
    )
  })

  test("maps native Windows paths through database columns", async () => {
    if (process.platform !== "win32") return
    await run(
      Effect.gen(function* () {
        const db = yield* makeDb
        yield* DatabaseMigration.apply(db)
        const projectID = ProjectV2.ID.make("codec_project")
        const worktree = AbsolutePath.make("C:\\Repo\\Thing")
        const sandbox = AbsolutePath.make("C:\\Repo\\Thing\\sandbox")
        const directory = "C:\\Repo\\Thing\\packages\\api"
        const sessionID = SessionSchema.ID.make("ses_codec")

        expect(() =>
          Effect.runSync(
            db
              .insert(ProjectTable)
              .values({
                id: ProjectV2.ID.make("invalid_path"),
                worktree: AbsolutePath.make("not-absolute"),
                sandboxes: [],
                time_created: 1,
                time_updated: 1,
              })
              .run(),
          ),
        ).toThrow()

        yield* db
          .insert(ProjectTable)
          .values({
            id: projectID,
            worktree,
            sandboxes: [sandbox],
            time_created: 1,
            time_updated: 1,
          })
          .run()
        yield* db
          .insert(SessionTable)
          .values({
            id: sessionID,
            project_id: projectID,
            slug: "codec",
            directory,
            path: "packages\\api",
            title: "Codec",
            version: "test",
            time_created: 1,
            time_updated: 1,
          })
          .run()

        expect(
          yield* db.get<{ worktree: string; sandboxes: string }>(
            sql`SELECT worktree, sandboxes FROM project WHERE id = ${projectID}`,
          ),
        ).toEqual({
          worktree: "C:/Repo/Thing",
          sandboxes: JSON.stringify(["C:/Repo/Thing/sandbox"]),
        })
        expect(
          yield* db.get<{ directory: string; path: string }>(
            sql`SELECT directory, path FROM session WHERE id = ${sessionID}`,
          ),
        ).toEqual({
          directory: "C:/Repo/Thing/packages/api",
          path: "packages/api",
        })

        const project = yield* db.select().from(ProjectTable).where(eq(ProjectTable.worktree, worktree)).get()
        const session = yield* db.select().from(SessionTable).where(eq(SessionTable.directory, directory)).get()
        expect(project?.worktree).toBe(worktree)
        expect(project?.sandboxes).toEqual([sandbox])
        expect(session?.directory).toBe(directory)
        expect(session?.path).toBe("packages/api")

        expect((yield* db.select().from(SessionTable).where(eq(SessionTable.path, "packages\\api")).get())?.id).toBe(
          sessionID,
        )

        const moved = AbsolutePath.make("D:\\Moved\\Thing")
        const updated = yield* db
          .update(ProjectTable)
          .set({ worktree: moved, sandboxes: [moved] })
          .where(eq(ProjectTable.id, projectID))
          .returning()
          .get()
        expect(updated?.worktree).toBe(moved)
        expect(updated?.sandboxes).toEqual([moved])
        expect(
          yield* db.get<{ worktree: string; sandboxes: string }>(
            sql`SELECT worktree, sandboxes FROM project WHERE id = ${projectID}`,
          ),
        ).toEqual({ worktree: "D:/Moved/Thing", sandboxes: JSON.stringify(["D:/Moved/Thing"]) })
        expect(
          (yield* db
            .select()
            .from(ProjectTable)
            .where(inArray(ProjectTable.worktree, [moved]))
            .get())?.id,
        ).toBe(projectID)

        yield* db.run(sql`UPDATE project SET worktree = ${"not-absolute"} WHERE id = ${projectID}`)
        expect(() =>
          Effect.runSync(db.select().from(ProjectTable).where(eq(ProjectTable.id, projectID)).get()),
        ).toThrow()
      }),
    )
  })

  test("imports existing drizzle migration state", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* makeDb
        yield* db.run(
          sql`CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash text NOT NULL, created_at numeric, name text, applied_at TEXT)`,
        )
        yield* db.run(sql`
          INSERT INTO __drizzle_migrations (hash, created_at, name, applied_at)
          VALUES ('hash', 1, '20260127222353_familiar_lady_ursula', ${new Date().toISOString()})
        `)

        yield* DatabaseMigration.applyOnly(db, [])

        expect(yield* db.get(sql`SELECT id FROM migration`)).toEqual({ id: "20260127222353_familiar_lady_ursula" })
      }),
    )
  })

  test("does not replay a migrated session metadata column", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* makeDb
        yield* db.run(sql`CREATE TABLE session (id text PRIMARY KEY, metadata text)`)
        yield* db.run(
          sql`CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash text NOT NULL, created_at numeric, name text, applied_at TEXT)`,
        )
        yield* db.run(sql`
          INSERT INTO __drizzle_migrations (hash, created_at, name, applied_at)
          VALUES ('hash', 1, '20260511173437_session-metadata', ${new Date().toISOString()})
        `)

        yield* DatabaseMigration.applyOnly(db, [sessionMetadataMigration])

        expect(yield* db.all(sql`SELECT id FROM migration`)).toEqual([{ id: "20260511173437_session-metadata" }])
      }),
    )
  })

  test("accepts the temporary replacement session metadata migration id", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* makeDb
        yield* db.run(sql`CREATE TABLE session (id text PRIMARY KEY, metadata text)`)
        yield* db.run(sql`CREATE TABLE migration (id TEXT PRIMARY KEY, time_completed INTEGER NOT NULL)`)
        yield* db.run(sql`INSERT INTO migration (id, time_completed) VALUES ('20260530232709_lovely_romulus', 1)`)

        yield* DatabaseMigration.applyOnly(db, [sessionMetadataMigration])

        expect(yield* db.all(sql`SELECT id FROM migration ORDER BY id`)).toEqual([
          { id: "20260511173437_session-metadata" },
          { id: "20260530232709_lovely_romulus" },
        ])
      }),
    )
  })

  test("skips drizzle import when migration table already has state", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* makeDb
        yield* db.run(sql`CREATE TABLE migration (id TEXT PRIMARY KEY, time_completed INTEGER NOT NULL)`)
        yield* db.run(sql`INSERT INTO migration (id, time_completed) VALUES ('existing', 1)`)
        yield* db.run(
          sql`CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash text NOT NULL, created_at numeric, name text, applied_at TEXT)`,
        )
        yield* db.run(sql`
          INSERT INTO __drizzle_migrations (hash, created_at, name, applied_at)
          VALUES ('hash', 1, '20260127222353_familiar_lady_ursula', ${new Date().toISOString()})
        `)

        yield* DatabaseMigration.applyOnly(db, [])

        expect(yield* db.all(sql`SELECT id FROM migration ORDER BY id`)).toEqual([{ id: "existing" }])
      }),
    )
  })
})
