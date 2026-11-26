import { describe, expect } from "bun:test"
import path from "node:path"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { Agent } from "@opencode/schema/agent"
import { Model } from "@opencode/schema/model"
import { Money } from "@opencode/schema/money"
import { Project } from "@opencode/schema/project"
import { Provider } from "@opencode/schema/provider"
import { Session } from "@opencode/schema/session"
import { SessionEvent } from "@opencode/schema/session-event"
import { SessionMessage } from "@opencode/schema/session-message"
import { AbsolutePath } from "@opencode/core/schema"
import { Bus } from "@opencode/core/bus"
import { DatabaseBatch } from "@opencode/core/database/batch"
import { Database } from "@opencode/core/database/database"
import { sqliteLayer } from "@opencode/core/database/sqlite.workerd"
import { ProjectTable } from "@opencode/core/project/sql"
import { SessionMessageTable, SessionPartTable, SessionTable } from "@opencode/core/session/sql"
import { SessionHistory } from "@opencode/core/session/history"
import { SessionStats } from "@opencode/core/session/stats"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { DateTime, Deferred, Effect, Exit, Fiber, Layer, Logger, Schema } from "effect"
import { Reactivity } from "effect/reactivity"
import { SqlClient, Statement } from "effect/sql"
import { TestClock } from "effect/testing"
import { makeDurableObjectStorage } from "./fixture/durable-object-storage"
import { withTempDir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node]), [
    Bus.node.replace(Bus.configured({ persist: true })),
  ]),
)
const durableIt = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node]), [
    Bus.node.replace(Bus.configured({ persist: true })),
    Database.node.replace(
      Database.configuredClient(Layer.suspend(() => sqliteLayer({ storage: makeDurableObjectStorage() }))),
    ),
  ]),
)
const projectID = Project.ID.make("stats-project")
const otherProjectID = Project.ID.make("stats-other-project")
const sessionID = Session.ID.make("ses_stats_root")
const childID = Session.ID.make("ses_stats_child")
const forkID = Session.ID.make("ses_stats_fork")
const usageOnlyID = Session.ID.make("ses_stats_usage_only")
const otherSessionID = Session.ID.make("ses_stats_other")
const encodeMessage = Schema.encodeSync(SessionMessage.Info)

describe("SessionStats", () => {
  it.effect("aggregates activity and tool reliability without reading message payloads outside the range", () =>
    Effect.gen(function* () {
      const db = (yield* Database.Service).db
      yield* db
        .insert(ProjectTable)
        .values([
          { id: projectID, worktree: AbsolutePath.make("/stats"), name: "stats", sandboxes: [] },
          { id: otherProjectID, worktree: AbsolutePath.make("/other"), name: "other", sandboxes: [] },
        ])
        .run()
        .pipe(Effect.orDie)
      yield* db
        .insert(SessionTable)
        .values([
          { id: sessionID, project_id: projectID, slug: "root", directory: "/stats", version: "test" },
          {
            id: childID,
            project_id: projectID,
            parent_id: sessionID,
            slug: "child",
            directory: "/stats",
            version: "test",
          },
          {
            id: forkID,
            project_id: projectID,
            fork_session_id: sessionID,
            slug: "fork",
            directory: "/stats",
            version: "test",
            time_created: Date.UTC(2026, 0, 4),
          },
          { id: usageOnlyID, project_id: projectID, slug: "usage", directory: "/stats", version: "test" },
          { id: otherSessionID, project_id: otherProjectID, slug: "other", directory: "/other", version: "test" },
        ])
        .run()
        .pipe(Effect.orDie)
      yield* db
        .insert(SessionMessageTable)
        .values([
          messageRow(
            sessionID,
            1,
            SessionMessage.User.make({
              id: SessionMessage.ID.make("msg_stats_user"),
              type: "user",
              text: "hello",
              time: { created: DateTime.makeUnsafe(Date.UTC(2026, 0, 2, 9)) },
            }),
          ),
          messageRow(
            sessionID,
            2,
            assistant("msg_stats_assistant", Date.UTC(2026, 0, 2, 10), [
              SessionMessage.AssistantTool.make({
                type: "tool",
                id: "call_read",
                name: "read",
                state: SessionMessage.ToolStateCompleted.make({
                  status: "completed",
                  input: {},
                  content: [{ type: "text", text: "ok" }],
                }),
                time: {
                  created: DateTime.makeUnsafe(Date.UTC(2026, 0, 2, 10)),
                  ran: DateTime.makeUnsafe(Date.UTC(2026, 0, 2, 10, 0, 1)),
                  completed: DateTime.makeUnsafe(Date.UTC(2026, 0, 2, 10, 0, 1, 250)),
                },
              }),
              SessionMessage.AssistantTool.make({
                type: "tool",
                id: "call_edit",
                name: "edit",
                state: SessionMessage.ToolStateError.make({
                  status: "error",
                  input: {},
                  error: { type: "tool", message: "failed" },
                }),
                time: {
                  created: DateTime.makeUnsafe(Date.UTC(2026, 0, 2, 10)),
                  completed: DateTime.makeUnsafe(Date.UTC(2026, 0, 2, 10, 0, 2)),
                },
              }),
              SessionMessage.AssistantTool.make({
                type: "tool",
                id: "call_pending",
                name: "pending",
                state: SessionMessage.ToolStateRunning.make({ status: "running", input: {}, metadata: {} }),
                time: { created: DateTime.makeUnsafe(Date.UTC(2026, 0, 2, 10)) },
              }),
            ]),
          ),
          messageRow(childID, 1, assistant("msg_stats_child", Date.UTC(2026, 0, 3, 10), [], "large", 2)),
          messageRow(
            forkID,
            1,
            SessionMessage.User.make({
              id: SessionMessage.ID.make("msg_stats_fork_copied_user"),
              type: "user",
              text: "copied",
              time: { created: DateTime.makeUnsafe(Date.UTC(2026, 0, 2, 9)) },
            }),
          ),
          messageRow(
            forkID,
            2,
            assistant("msg_stats_fork_copied_assistant", Date.UTC(2026, 0, 2, 10), [
              SessionMessage.AssistantTool.make({
                type: "tool",
                id: "call_copied",
                name: "copied",
                state: SessionMessage.ToolStateCompleted.make({
                  status: "completed",
                  input: {},
                  content: [{ type: "text", text: "copied" }],
                }),
                time: {
                  created: DateTime.makeUnsafe(Date.UTC(2026, 0, 2, 10)),
                  completed: DateTime.makeUnsafe(Date.UTC(2026, 0, 2, 10, 0, 1)),
                },
              }),
            ]),
          ),
          messageRow(forkID, 3, assistant("msg_stats_fork_new", Date.UTC(2026, 0, 5, 10), [], "fork-new")),
          messageRow(sessionID, 3, assistant("msg_stats_outside", Date.UTC(2025, 11, 31, 10), [])),
          messageRow(usageOnlyID, 1, assistant("msg_stats_usage_only", Date.UTC(2025, 11, 30, 10), [])),
          messageRow(otherSessionID, 1, assistant("msg_stats_other", Date.UTC(2020, 0, 1, 10), [])),
        ])
        .run()
        .pipe(Effect.orDie)
      // Publish through the real Bus so the stored event type is whatever the
      // writer persists rather than a string the test assumes.
      const bus = yield* Bus.Service
      yield* TestClock.setTime(Date.UTC(2026, 0, 2, 10, 0, 3))
      yield* bus.publish(SessionEvent.UsageRecorded, {
        sessionID,
        source: "title",
        cost: Money.USD.make(0.5),
        tokens: { input: 1, output: 1, reasoning: 1, cache: { read: 1, write: 1 } },
      })
      yield* bus.publish(SessionEvent.UsageRecorded, {
        sessionID: usageOnlyID,
        source: "compaction",
        cost: Money.USD.make(0.25),
        tokens: { input: 2, output: 2, reasoning: 2, cache: { read: 2, write: 2 } },
      })

      const stats = yield* SessionStats.get({
        from: Date.UTC(2026, 0, 1),
        to: Date.UTC(2026, 1, 1),
        timezone: "UTC",
        tools: "detail",
      })

      expect(stats.sessions).toBe(2)
      expect(stats.subagents).toBe(1)
      expect(stats.prompts).toBe(1)
      expect(stats.steps).toBe(3)
      expect(stats.tokens).toEqual({ input: 42, output: 22, reasoning: 10, cache: { read: 18, write: 6 } })
      expect(stats.cost).toBe(Money.USD.make(6.25))
      expect(stats.tools).toMatchObject({
        mode: "detail",
        totals: { calls: 3, succeeded: 1, failed: 1, unfinished: 1 },
      })
      expect(stats.activity).toEqual([
        { date: "2026-01-02", steps: 1 },
        { date: "2026-01-03", steps: 1 },
        { date: "2026-01-05", steps: 1 },
      ])
      expect(stats.streak).toBe(2)
      expect(stats.models.map((model) => String(model.model.id))).toEqual(["large", "sonnet", "fork-new"])
      expect(stats.tools.mode).toBe("detail")
      if (stats.tools.mode !== "detail") throw new Error("Expected detailed tool statistics")
      expect(stats.tools.usage).toMatchObject([
        { name: "read", calls: 1, succeeded: 1, failed: 0, durationP50: 250 },
        { name: "edit", calls: 1, succeeded: 0, failed: 1, durationP50: 2_000 },
        { name: "pending", calls: 1, succeeded: 0, failed: 0, unfinished: 1 },
      ])

      const summary = yield* SessionStats.get({
        from: Date.UTC(2026, 0, 1),
        to: Date.UTC(2026, 1, 1),
        timezone: "UTC",
      })
      expect(summary.models.map((model) => String(model.model.id))).toEqual(["large", "sonnet", "fork-new"])
      expect(summary.tools).toEqual({
        mode: "summary",
        totals: { calls: 3, succeeded: 1, failed: 1, unfinished: 1 },
      })

      const withoutTools = yield* SessionStats.get({
        from: Date.UTC(2026, 0, 1),
        to: Date.UTC(2026, 1, 1),
        timezone: "UTC",
        tools: "none",
      })
      expect(withoutTools.tools).toEqual({ mode: "none" })

      const project = yield* SessionStats.get({ projectID, timezone: "UTC", tools: "none" })
      expect(DateTime.toEpochMillis(project.range.from)).toBe(Date.UTC(2025, 11, 30, 10))

      const error = yield* Effect.flip(
        SessionStats.get({ from: Date.UTC(2026, 1, 1), to: Date.UTC(2026, 0, 1), tools: "none" }),
      )
      expect(error).toEqual(
        new SessionStats.InvalidRangeError({ from: Date.UTC(2026, 1, 1), to: Date.UTC(2026, 0, 1) }),
      )

      const future = yield* Effect.flip(SessionStats.get({ from: Number.MAX_SAFE_INTEGER, tools: "none" }))
      expect(future._tag).toBe("SessionStats.InvalidRangeError")
    }),
  )

  it.effect("counts tool calls in both session_part rows and inline content an older build left on one message", () =>
    Effect.gen(function* () {
      const db = (yield* Database.Service).db
      yield* db
        .insert(ProjectTable)
        .values({ id: projectID, worktree: AbsolutePath.make("/stats"), name: "stats", sandboxes: [] })
        .run()
        .pipe(Effect.orDie)
      yield* db
        .insert(SessionTable)
        .values({ id: sessionID, project_id: projectID, slug: "root", directory: "/stats", version: "test" })
        .run()
        .pipe(Effect.orDie)
      const created = Date.UTC(2026, 0, 2, 10)
      const time = { created: DateTime.makeUnsafe(created), completed: DateTime.makeUnsafe(created + 1_000) }
      const row = messageRow(
        sessionID,
        1,
        assistant("msg_stats_hybrid", created, [
          SessionMessage.AssistantTool.make({
            type: "tool",
            id: "call_inline",
            name: "edit",
            state: SessionMessage.ToolStateError.make({
              status: "error",
              input: {},
              error: { type: "tool", message: "failed" },
            }),
            time,
          }),
        ]),
      )
      yield* db.insert(SessionMessageTable).values(row).run().pipe(Effect.orDie)
      yield* db
        .insert(SessionPartTable)
        .values({
          message_id: row.id,
          session_id: sessionID,
          ordinal: 0,
          type: "tool",
          call_id: "call_part",
          time_created: created,
          time_updated: created,
          data: SessionHistory.encodePart(
            SessionMessage.AssistantTool.make({
              type: "tool",
              id: "call_part",
              name: "read",
              state: SessionMessage.ToolStateCompleted.make({
                status: "completed",
                input: {},
                content: [{ type: "text", text: "ok" }],
              }),
              time,
            }),
          ),
        })
        .run()
        .pipe(Effect.orDie)

      const range = { from: Date.UTC(2026, 0, 1), to: Date.UTC(2026, 1, 1), timezone: "UTC" }
      expect((yield* SessionStats.get(range)).tools).toEqual({
        mode: "summary",
        totals: { calls: 2, succeeded: 1, failed: 1, unfinished: 0 },
      })
      const detail = (yield* SessionStats.get({ ...range, tools: "detail" })).tools
      if (detail.mode !== "detail") throw new Error("Expected detailed tool statistics")
      expect(detail.usage.map((tool) => tool.name).toSorted()).toEqual(["edit", "read"])
    }),
  )

  durableIt.effect("aggregates compaction usage across more than 100 sessions under the 100-parameter limit", () =>
    Effect.gen(function* () {
      const db = (yield* Database.Service).db
      const bus = yield* Bus.Service
      yield* db
        .insert(ProjectTable)
        .values({ id: projectID, worktree: AbsolutePath.make("/stats"), name: "stats", sandboxes: [] })
        .run()
        .pipe(Effect.orDie)

      const ids = Array.from({ length: 120 }, (_, i) => Session.ID.make(`ses_stats_${String(i).padStart(3, "0")}`))
      const created = Date.UTC(2026, 0, 2, 10)
      yield* Effect.forEach(
        DatabaseBatch.insertBatches(
          SessionTable,
          ids.map((id, i) => ({
            id,
            project_id: projectID,
            slug: `session-${i}`,
            directory: "/stats",
            version: "test",
          })),
        ),
        (batch) => db.insert(SessionTable).values(batch).run().pipe(Effect.orDie),
        { discard: true },
      )
      yield* Effect.forEach(
        DatabaseBatch.insertBatches(
          SessionMessageTable,
          ids.map((id, i) => messageRow(id, 1, assistant(`msg_stats_${i}`, created, []))),
        ),
        (batch) => db.insert(SessionMessageTable).values(batch).run().pipe(Effect.orDie),
        { discard: true },
      )

      yield* TestClock.setTime(created + 1_000)
      yield* bus.publish(SessionEvent.UsageRecorded, {
        sessionID: ids[0]!,
        source: "compaction",
        cost: Money.USD.make(0.25),
        tokens: { input: 2, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
      })
      yield* bus.publish(SessionEvent.UsageRecorded, {
        sessionID: ids.at(-1)!,
        source: "compaction",
        cost: Money.USD.make(0.75),
        tokens: { input: 3, output: 4, reasoning: 0, cache: { read: 0, write: 0 } },
      })

      const stats = yield* SessionStats.get({
        from: Date.UTC(2026, 0, 1),
        to: Date.UTC(2026, 1, 1),
        projectID,
        timezone: "UTC",
        tools: "none",
      })
      expect(stats.sessions).toBe(120)
      expect(stats.steps).toBe(120)
      expect(stats.tokens).toEqual({
        input: 120 * 10 + 5,
        output: 120 * 5 + 5,
        reasoning: 120 * 2,
        cache: { read: 120 * 4, write: 120 },
      })
      expect(stats.cost).toBe(Money.USD.make(120 * 1.5 + 1))
    }),
  )

  it.live("produces identical stats in the read-only worker and in-process on a file-backed database", () =>
    withTempDir((tmp) => {
      const file = path.join(tmp.path, "stats.db")
      const layer = AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node]), [
        Bus.node.replace(Bus.configured({ persist: true })),
        Database.node.replace(Database.configured({ path: file })),
      ])
      return Effect.gen(function* () {
        const database = yield* Database.Service
        const db = database.db
        const bus = yield* Bus.Service
        expect(database.path).toBe(file)

        const now = Date.now()
        const day = 24 * 60 * 60 * 1_000
        const day1 = now - 3 * day
        const day2 = now - 2 * day
        const day3 = now - day
        const forkCreated = now - 12 * 60 * 60 * 1_000

        yield* db
          .insert(ProjectTable)
          .values([
            { id: projectID, worktree: AbsolutePath.make("/stats"), name: "stats", sandboxes: [] },
            { id: otherProjectID, worktree: AbsolutePath.make("/other"), name: "other", sandboxes: [] },
          ])
          .run()
          .pipe(Effect.orDie)
        yield* db
          .insert(SessionTable)
          .values([
            { id: sessionID, project_id: projectID, slug: "root", directory: "/stats", version: "test" },
            {
              id: childID,
              project_id: projectID,
              parent_id: sessionID,
              slug: "child",
              directory: "/stats",
              version: "test",
            },
            {
              id: forkID,
              project_id: projectID,
              fork_session_id: sessionID,
              slug: "fork",
              directory: "/stats",
              version: "test",
              time_created: forkCreated,
            },
            { id: otherSessionID, project_id: otherProjectID, slug: "other", directory: "/other", version: "test" },
          ])
          .run()
          .pipe(Effect.orDie)

        const partMessage = messageRow(sessionID, 2, assistant("msg_worker_parts", day1 + 1_000, [], "sonnet", 1))
        const hybridMessage = messageRow(
          sessionID,
          3,
          assistant("msg_worker_hybrid", day2, [
            SessionMessage.AssistantTool.make({
              type: "tool",
              id: "call_inline_edit",
              name: "edit",
              state: SessionMessage.ToolStateError.make({
                status: "error",
                input: {},
                error: { type: "tool", message: "boom" },
              }),
              time: {
                created: DateTime.makeUnsafe(day2),
                completed: DateTime.makeUnsafe(day2 + 1_500),
              },
            }),
          ]),
        )
        yield* db
          .insert(SessionMessageTable)
          .values([
            messageRow(
              sessionID,
              1,
              SessionMessage.User.make({
                id: SessionMessage.ID.make("msg_worker_user"),
                type: "user",
                text: "x".repeat(4_096),
                time: { created: DateTime.makeUnsafe(day1) },
              }),
            ),
            partMessage,
            hybridMessage,
            messageRow(childID, 1, assistant("msg_worker_child", day3, [], "opus", 2)),
            messageRow(forkID, 1, assistant("msg_worker_fork_copied", day1, [], "sonnet", 1)),
            messageRow(forkID, 2, assistant("msg_worker_fork_new", forkCreated + 1_000, [], "haiku", 1)),
            messageRow(otherSessionID, 1, assistant("msg_worker_other", day2, [], "other-model", 3)),
          ])
          .run()
          .pipe(Effect.orDie)
        yield* db
          .insert(SessionPartTable)
          .values([
            {
              message_id: partMessage.id,
              session_id: sessionID,
              ordinal: 0,
              type: "tool",
              call_id: "call_part_read",
              time_created: day1 + 1_000,
              time_updated: day1 + 1_000,
              data: SessionHistory.encodePart(
                SessionMessage.AssistantTool.make({
                  type: "tool",
                  id: "call_part_read",
                  name: "read",
                  state: SessionMessage.ToolStateCompleted.make({
                    status: "completed",
                    input: {},
                    content: [{ type: "text", text: "ok" }],
                  }),
                  time: {
                    created: DateTime.makeUnsafe(day1 + 1_000),
                    ran: DateTime.makeUnsafe(day1 + 1_100),
                    completed: DateTime.makeUnsafe(day1 + 1_350),
                  },
                }),
              ),
            },
            {
              message_id: hybridMessage.id,
              session_id: sessionID,
              ordinal: 0,
              type: "tool",
              call_id: "call_part_pending",
              time_created: day2,
              time_updated: day2,
              data: SessionHistory.encodePart(
                SessionMessage.AssistantTool.make({
                  type: "tool",
                  id: "call_part_pending",
                  name: "bash",
                  state: SessionMessage.ToolStateRunning.make({ status: "running", input: {}, metadata: {} }),
                  time: { created: DateTime.makeUnsafe(day2) },
                }),
              ),
            },
          ])
          .run()
          .pipe(Effect.orDie)

        yield* bus.publish(SessionEvent.UsageRecorded, {
          sessionID,
          source: "compaction",
          cost: Money.USD.make(0.4),
          tokens: { input: 7, output: 3, reasoning: 1, cache: { read: 2, write: 1 } },
        })
        yield* bus.publish(SessionEvent.UsageRecorded, {
          sessionID,
          source: "title",
          cost: Money.USD.make(9.99),
          tokens: { input: 99, output: 99, reasoning: 0, cache: { read: 0, write: 0 } },
        })
        yield* bus.publish(SessionEvent.UsageRecorded, {
          sessionID: otherSessionID,
          source: "compaction",
          cost: Money.USD.make(1.2),
          tokens: { input: 5, output: 5, reasoning: 0, cache: { read: 0, write: 0 } },
        })

        let spawned = 0
        const workerGet = SessionStats.makeGet(SessionStats.runInWorker(undefined, () => spawned++))
        const inProcessService = { db }
        const cases = [
          { from: day1 - day, to: Date.now() + day, timezone: "America/New_York", tools: "detail" as const },
          { from: day1 - day, to: Date.now() + day, timezone: "UTC", tools: "summary" as const },
          { projectID, to: Date.now() + day, timezone: "UTC", tools: "none" as const },
        ]
        for (const query of cases) {
          const fromWorker = yield* workerGet(query)
          const fromMain = yield* SessionStats.get(query).pipe(
            Effect.provideService(Database.Service, inProcessService),
          )
          expect(fromWorker).toEqual(fromMain)
        }
        expect(spawned).toBe(cases.length)
      }).pipe(Effect.provide(layer), Effect.scoped)
    }),
  )

  it.live("keeps the main event loop responsive while a file-backed stats query runs in a worker", () =>
    withTempDir((tmp) => {
      const file = path.join(tmp.path, "responsive.db")
      const layer = AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node]), [
        Database.node.replace(Database.configured({ path: file })),
      ])
      return Effect.gen(function* () {
        const db = (yield* Database.Service).db
        const base = Date.UTC(2026, 0, 1)
        yield* db
          .insert(ProjectTable)
          .values({ id: projectID, worktree: AbsolutePath.make("/stats"), name: "stats", sandboxes: [] })
          .run()
          .pipe(Effect.orDie)
        yield* db
          .insert(SessionTable)
          .values({ id: sessionID, project_id: projectID, slug: "root", directory: "/stats", version: "test" })
          .run()
          .pipe(Effect.orDie)

        const messages = Array.from({ length: 150 }, (_, i) =>
          messageRow(sessionID, i + 1, assistant(`msg_resp_${i}`, base + i * 60_000, [], "sonnet", 1)),
        )
        yield* Effect.forEach(
          DatabaseBatch.insertBatches(SessionMessageTable, messages),
          (batch) => db.insert(SessionMessageTable).values(batch).run().pipe(Effect.orDie),
          { discard: true },
        )

        let done = false
        const fiber = yield* Effect.forkChild(
          SessionStats.get({ from: base, to: base + 30 * 24 * 60 * 60 * 1_000, timezone: "UTC", tools: "detail" }).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                done = true
              }),
            ),
          ),
          { startImmediately: true },
        )
        let ticks = 0
        while (!done) {
          ticks++
          yield* Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, 1)))
        }
        const stats = yield* Fiber.join(fiber)
        expect(ticks).toBeGreaterThan(0)
        expect(stats.steps).toBe(150)
      }).pipe(Effect.provide(layer), Effect.scoped)
    }),
  )

  it.live("terminates the stats worker cleanly when the fiber is interrupted", () =>
    withTempDir((tmp) => {
      const file = path.join(tmp.path, "interrupt.db")
      const layer = AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node]), [
        Database.node.replace(Database.configured({ path: file })),
      ])
      return Effect.gen(function* () {
        const spawned = yield* Deferred.make<void>()
        const exited = yield* Deferred.make<void>()
        const get = SessionStats.makeGet(
          SessionStats.runInWorker(new URL("./fixture/stats-hang-worker.ts", import.meta.url), (worker) => {
            worker.once("exit", () => Deferred.doneUnsafe(exited, Effect.void))
            Deferred.doneUnsafe(spawned, Effect.void)
          }),
        )

        const fiber = yield* Effect.forkChild(get({ tools: "none" }), { startImmediately: true })
        yield* Deferred.await(spawned)
        yield* Fiber.interrupt(fiber)

        expect(Exit.hasInterrupts(yield* Fiber.await(fiber))).toBe(true)
        yield* Deferred.await(exited).pipe(Effect.timeout("5 seconds"))
      }).pipe(Effect.provide(layer), Effect.scoped)
    }),
  )

  it.live("falls back to in-process stats when the worker cannot start, warning once", () =>
    withTempDir((tmp) => {
      const file = path.join(tmp.path, "fallback.db")
      const warnings: unknown[] = []
      const logger = Logger.make(({ logLevel, message }) => {
        if (logLevel === "Warn") warnings.push(message)
      })
      const layer = AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node]), [
        Database.node.replace(Database.configured({ path: file })),
      ])
      return Effect.gen(function* () {
        const db = (yield* Database.Service).db
        const created = Date.UTC(2026, 0, 2, 10)
        yield* db
          .insert(ProjectTable)
          .values({ id: projectID, worktree: AbsolutePath.make("/stats"), name: "stats", sandboxes: [] })
          .run()
          .pipe(Effect.orDie)
        yield* db
          .insert(SessionTable)
          .values({ id: sessionID, project_id: projectID, slug: "root", directory: "/stats", version: "test" })
          .run()
          .pipe(Effect.orDie)
        yield* db
          .insert(SessionMessageTable)
          .values(messageRow(sessionID, 1, assistant("msg_fallback", created, [])))
          .run()
          .pipe(Effect.orDie)

        const get = SessionStats.makeGet(
          SessionStats.runInWorker(new URL("./missing-stats-worker.js", import.meta.url)),
        )
        const query = { from: Date.UTC(2026, 0, 1), to: Date.UTC(2026, 1, 1), timezone: "UTC", tools: "none" as const }
        const first = yield* get(query)
        const second = yield* get(query)
        expect(first.steps).toBe(1)
        expect(second).toEqual(first)
        expect(warnings).toHaveLength(1)
      }).pipe(Effect.provide(layer), Effect.provide(Logger.layer([logger])), Effect.scoped)
    }),
  )

  it.effect("queries compaction events in a single indexed query instead of O(sessions) batches", () => {
    const executed: Array<{ query: string; params: ReadonlyArray<unknown> }> = []
    const recordingClient = Layer.effect(
      SqlClient.SqlClient,
      Effect.gen(function* () {
        const client = yield* SqlClient.SqlClient
        const connection = yield* client.reserve
        const record = (query: string, params: ReadonlyArray<unknown>) => {
          executed.push({ query, params })
        }
        return yield* SqlClient.make({
          acquirer: Effect.succeed({
            ...connection,
            execute: (query, params, transform) => {
              record(query, params)
              return connection.execute(query, params, transform)
            },
            executeRaw: (query, params) => {
              record(query, params)
              return connection.executeRaw(query, params)
            },
            executeValues: (query, params) => {
              record(query, params)
              return connection.executeValues(query, params)
            },
          }),
          compiler: Statement.makeCompilerSqlite(),
          driver: client.driver,
          spanAttributes: [],
        })
      }),
    ).pipe(
      Layer.provide(SqliteClient.layer({ filename: ":memory:", disableWAL: true })),
      Layer.provide(Reactivity.layer),
      Layer.orDie,
    )

    const layer = AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node]), [
      Bus.node.replace(Bus.configured({ persist: true })),
      Database.node.replace(Database.configuredClient(recordingClient)),
    ])

    return Effect.gen(function* () {
      const db = (yield* Database.Service).db
      const bus = yield* Bus.Service
      yield* db
        .insert(ProjectTable)
        .values({ id: projectID, worktree: AbsolutePath.make("/stats"), name: "stats", sandboxes: [] })
        .run()
        .pipe(Effect.orDie)

      const ids = Array.from({ length: 250 }, (_, i) => Session.ID.make(`ses_idx_${String(i).padStart(3, "0")}`))
      const created = Date.UTC(2026, 0, 2, 10)
      yield* Effect.forEach(
        DatabaseBatch.insertBatches(
          SessionTable,
          ids.map((id, i) => ({
            id,
            project_id: projectID,
            slug: `session-${i}`,
            directory: "/stats",
            version: "test",
          })),
        ),
        (batch) => db.insert(SessionTable).values(batch).run().pipe(Effect.orDie),
        { discard: true },
      )
      yield* Effect.forEach(
        DatabaseBatch.insertBatches(
          SessionMessageTable,
          ids.map((id, i) => messageRow(id, 1, assistant(`msg_idx_${i}`, created, []))),
        ),
        (batch) => db.insert(SessionMessageTable).values(batch).run().pipe(Effect.orDie),
        { discard: true },
      )

      yield* TestClock.setTime(created + 1_000)
      yield* bus.publish(SessionEvent.UsageRecorded, {
        sessionID: ids[0]!,
        source: "compaction",
        cost: Money.USD.make(0.5),
        tokens: { input: 5, output: 5, reasoning: 0, cache: { read: 0, write: 0 } },
      })
      yield* bus.publish(SessionEvent.UsageRecorded, {
        sessionID: ids[249]!,
        source: "compaction",
        cost: Money.USD.make(0.5),
        tokens: { input: 5, output: 5, reasoning: 0, cache: { read: 0, write: 0 } },
      })

      executed.length = 0
      const stats = yield* SessionStats.get({
        from: Date.UTC(2026, 0, 1),
        to: Date.UTC(2026, 1, 1),
        projectID,
        timezone: "UTC",
        tools: "none",
      })

      const eventQueries = executed.filter((entry) => entry.query.includes('"event"'))
      expect(eventQueries).toHaveLength(1)
      expect(executed.filter((entry) => entry.query.includes('from "session_v2"'))).toHaveLength(0)

      const plan = yield* db.$client
        .unsafe<{ detail: string }>(`EXPLAIN QUERY PLAN ${eventQueries[0]!.query}`, [...eventQueries[0]!.params])
        .pipe(Effect.orDie)
      expect(plan.map((step) => step.detail).join("\n")).toContain("event_usage_recorded_created_idx")

      expect(stats.sessions).toBe(250)
      expect(stats.cost).toBe(Money.USD.make(250 * 1.5 + 1))
    }).pipe(Effect.provide(layer), Effect.scoped)
  })
})

function assistant(
  id: string,
  created: number,
  content: SessionMessage.AssistantContent[],
  model = "sonnet",
  scale = 1,
) {
  return SessionMessage.Assistant.make({
    id: SessionMessage.ID.make(id),
    type: "assistant",
    agent: Agent.ID.make("build"),
    model: { id: Model.ID.make(model), providerID: Provider.ID.make("anthropic") },
    content,
    cost: Money.USD.make(1.5 * scale),
    tokens: { input: 10 * scale, output: 5 * scale, reasoning: 2 * scale, cache: { read: 4 * scale, write: scale } },
    time: { created: DateTime.makeUnsafe(created), completed: DateTime.makeUnsafe(created + 2_000) },
  })
}

function messageRow(
  sessionID: Session.ID,
  seq: number,
  message: SessionMessage.Info,
): typeof SessionMessageTable.$inferInsert {
  const encoded = encodeMessage(message)
  const { id, type, ...data } = encoded
  return { id: SessionMessage.ID.make(id), session_id: sessionID, type, seq, time_created: encoded.time.created, data }
}
