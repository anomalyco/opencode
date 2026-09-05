import { describe, expect } from "bun:test"
import { Agent } from "@opencode-ai/schema/agent"
import { Event } from "@opencode-ai/schema/event"
import { Model } from "@opencode-ai/schema/model"
import { Money } from "@opencode-ai/schema/money"
import { Project } from "@opencode-ai/schema/project"
import { Provider } from "@opencode-ai/schema/provider"
import { Session } from "@opencode-ai/schema/session"
import { SessionEvent } from "@opencode-ai/schema/session-event"
import { SessionMessage } from "@opencode-ai/schema/session-message"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Database } from "@opencode-ai/core/database/database"
import { EventSequenceTable, EventTable } from "@opencode-ai/core/event/sql"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { SessionMessageTable, SessionTable } from "@opencode-ai/core/session/sql"
import { SessionStats } from "@opencode-ai/core/session/stats"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { DateTime, Effect, Schema } from "effect"
import { eq } from "drizzle-orm"
import { Statement } from "effect/unstable/sql"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(Database.node))
const projectID = Project.ID.make("stats-project")
const otherProjectID = Project.ID.make("stats-other-project")
const sessionID = Session.ID.make("ses_stats_root")
const childID = Session.ID.make("ses_stats_child")
const forkID = Session.ID.make("ses_stats_fork")
const usageOnlyID = Session.ID.make("ses_stats_usage_only")
const otherSessionID = Session.ID.make("ses_stats_other")
const encodeMessage = Schema.encodeSync(SessionMessage.Info)
const encodeUsage = Schema.encodeSync(SessionEvent.UsageRecorded.data)

describe("SessionStats", () => {
  it.effect("covers the production usage query without loading message payloads", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const queries: ReturnType<Statement.Statement<unknown>["compile"]>[] = []
      yield* SessionStats.get({ from: 0, to: 2 * 24 * 60 * 60 * 1_000, tools: "none" }).pipe(
        Effect.provideService(Statement.CurrentTransformer, (statement) =>
          Effect.sync(() => {
            queries.push(statement.compile())
            return statement
          }),
        ),
      )
      const messages = queries.filter((query) => query[0].includes("json_extract(message.data, '$.tokens.input')"))
      expect(messages).toHaveLength(2)
      yield* Effect.forEach(messages, (query) =>
        Effect.gen(function* () {
          const plan = yield* database.db.$client.unsafe<{ detail: string }>(`EXPLAIN QUERY PLAN ${query[0]}`, query[1])
          expect(plan.some((row) => row.detail.includes("USING COVERING INDEX session_message_stats_idx"))).toBe(true)
        }),
      )
    }),
  )
  ;[
    {
      name: "spring DST",
      timezone: "America/New_York",
      times: [
        "2026-03-08T04:59:59.999Z",
        "2026-03-08T05:00:00Z",
        "2026-03-08T06:59:59Z",
        "2026-03-08T07:00:00Z",
        "2026-03-09T03:59:59.999Z",
        "2026-03-09T04:00:00Z",
      ],
      activity: [
        { date: "2026-03-07", steps: 1 },
        { date: "2026-03-08", steps: 4 },
        { date: "2026-03-09", steps: 1 },
      ],
    },
    {
      name: "fall DST",
      timezone: "America/New_York",
      times: [
        "2026-11-01T03:59:59.999Z",
        "2026-11-01T04:00:00Z",
        "2026-11-01T05:30:00Z",
        "2026-11-01T06:30:00Z",
        "2026-11-02T04:59:59.999Z",
        "2026-11-02T05:00:00Z",
      ],
      activity: [
        { date: "2026-10-31", steps: 1 },
        { date: "2026-11-01", steps: 4 },
        { date: "2026-11-02", steps: 1 },
      ],
    },
    {
      name: "quarter-hour offset",
      timezone: "Asia/Kathmandu",
      times: ["2026-01-01T18:14:59.999Z", "2026-01-01T18:15:00Z", "2026-01-02T18:14:59.999Z", "2026-01-02T18:15:00Z"],
      activity: [
        { date: "2026-01-01", steps: 1 },
        { date: "2026-01-02", steps: 2 },
        { date: "2026-01-03", steps: 1 },
      ],
    },
  ].forEach((fixture) => {
    it.effect(`groups activity by local calendar day across ${fixture.name}`, () =>
      Effect.gen(function* () {
        const database = yield* Database.Service
        yield* database.db
          .insert(ProjectTable)
          .values({ id: projectID, worktree: AbsolutePath.make("/stats"), sandboxes: [] })
          .run()
        yield* database.db
          .insert(SessionTable)
          .values({ id: sessionID, project_id: projectID, slug: "root", directory: "/stats", version: "test" })
          .run()
        yield* database.db
          .insert(SessionMessageTable)
          .values(
            fixture.times.map((time, index) =>
              messageRow(sessionID, index + 1, assistant(`msg_stats_zone_${index}`, Date.parse(time), [])),
            ),
          )
          .run()
        const stats = yield* SessionStats.get({
          from: Date.parse(fixture.times[0]),
          to: Date.parse(fixture.times[fixture.times.length - 1]) + 1,
          timezone: fixture.timezone,
          tools: "none",
        })
        expect(stats.activity).toEqual(fixture.activity)
        expect(stats.activeDays).toBe(3)
        expect(stats.streak).toBe(3)
      }),
    )
  })

  it.effect("preserves usage across windows and local dates with large message bodies", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const db = database.db
      yield* db
        .insert(ProjectTable)
        .values({ id: projectID, worktree: AbsolutePath.make("/stats"), sandboxes: [] })
        .run()
        .pipe(Effect.orDie)
      yield* db
        .insert(SessionTable)
        .values({ id: sessionID, project_id: projectID, slug: "root", directory: "/stats", version: "test" })
        .run()
        .pipe(Effect.orDie)
      const from = Date.UTC(2026, 0, 1)
      const boundary = from + 31 * 24 * 60 * 60 * 1_000
      const to = Date.UTC(2026, 1, 3)
      yield* db
        .insert(SessionMessageTable)
        .values([
          messageRow(
            sessionID,
            1,
            SessionMessage.User.make({
              id: SessionMessage.ID.make("msg_stats_large_user"),
              type: "user",
              text: "prompt ".repeat(100_000),
              time: { created: DateTime.makeUnsafe(from) },
            }),
          ),
          ...[boundary - 1, boundary, to].map((created, index) =>
            messageRow(
              sessionID,
              index + 2,
              SessionMessage.Assistant.make({
                ...assistant(`msg_stats_large_${index}`, created, [
                  SessionMessage.AssistantText.make({ type: "text", text: "content ".repeat(100_000) }),
                ]),
                model: {
                  providerID: Provider.ID.make("example"),
                  id: Model.ID.make("model-a"),
                  variant: Model.VariantID.make("high"),
                },
                cost: Money.USD.make(0.0123456789),
              }),
            ),
          ),
        ])
        .run()
        .pipe(Effect.orDie)

      const stats = yield* SessionStats.get({ from, to, projectID, timezone: "America/New_York", tools: "none" })
      expect(stats.sessions).toBe(1)
      expect(stats.prompts).toBe(1)
      expect(stats.steps).toBe(2)
      expect(stats.tokens).toEqual({ input: 20, output: 10, reasoning: 4, cache: { read: 8, write: 2 } })
      expect(stats.cost).toBe(Money.USD.make(0.0123456789 * 2))
      expect(stats.activity).toEqual([{ date: "2026-01-31", steps: 2 }])
      expect(stats.models).toEqual([
        {
          model: {
            providerID: Provider.ID.make("example"),
            id: Model.ID.make("model-a"),
            variant: Model.VariantID.make("high"),
          },
          steps: 2,
          tokens: stats.tokens,
          cost: stats.cost,
        },
      ])

      yield* db
        .update(SessionMessageTable)
        .set({
          data: messageRow(sessionID, 3, assistant("msg_stats_large_1", boundary, [], "model-b", 3)).data,
        })
        .where(eq(SessionMessageTable.id, SessionMessage.ID.make("msg_stats_large_1")))
        .run()
      const updated = yield* SessionStats.get({ from, to, tools: "none" })
      expect(updated.tokens.input).toBe(40)
      expect(updated.models[0].model.id).toBe(Model.ID.make("model-b"))
      expect(updated.cost).toBe(Money.USD.make(0.0123456789 + 4.5))

      yield* db
        .delete(SessionMessageTable)
        .where(eq(SessionMessageTable.id, SessionMessage.ID.make("msg_stats_large_1")))
        .run()
      const removed = yield* SessionStats.get({ from, to, tools: "none" })
      expect(removed.steps).toBe(1)
      expect(removed.tokens.input).toBe(10)
    }),
  )

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
      yield* db
        .insert(EventSequenceTable)
        .values([
          { aggregate_id: sessionID, seq: 0 },
          { aggregate_id: childID, seq: 0 },
          { aggregate_id: usageOnlyID, seq: 0 },
        ])
        .run()
        .pipe(Effect.orDie)
      yield* db
        .insert(EventTable)
        .values([
          {
            id: Event.ID.make("evt_stats_usage"),
            aggregate_id: sessionID,
            seq: 0,
            created: Date.UTC(2026, 0, 2, 10, 0, 3),
            type: SessionEvent.UsageRecorded.type,
            data: encodeUsage({
              sessionID,
              source: "title",
              cost: Money.USD.make(0.5),
              tokens: { input: 1, output: 1, reasoning: 1, cache: { read: 1, write: 1 } },
            }),
          },
          {
            id: Event.ID.make("evt_stats_usage_boundary"),
            aggregate_id: usageOnlyID,
            seq: 0,
            created: Date.UTC(2026, 0, 2, 10, 0, 3),
            type: SessionEvent.UsageRecorded.type,
            data: encodeUsage({
              sessionID: usageOnlyID,
              source: "compaction",
              cost: Money.USD.make(0.25),
              tokens: { input: 2, output: 2, reasoning: 2, cache: { read: 2, write: 2 } },
            }),
          },
        ])
        .run()
        .pipe(Effect.orDie)

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
