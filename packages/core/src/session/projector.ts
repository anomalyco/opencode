export * as SessionProjector from "./projector"

import { and, eq, sql } from "drizzle-orm"
import { DateTime, Effect, Layer, Schema } from "effect"
import { Database } from "../database/database"
import { EventV2 } from "../event"
import { SessionEvent } from "./event"
import { SessionLegacy } from "./legacy"
import { WorkspaceTable } from "../control-plane/workspace.sql"
import { SessionMessage } from "./message"
import { SessionMessageUpdater } from "./message-updater"
import { MessageTable, PartTable, SessionMessageTable, SessionTable } from "./sql"
import type { DeepMutable } from "../schema"

type DatabaseService = Database.Interface["db"]

const decodeMessage = Schema.decodeUnknownSync(SessionMessage.Message)
const encodeMessage = Schema.encodeSync(SessionMessage.Message)

type Usage = {
  cost: number
  tokens: {
    input: number
    output: number
    reasoning: number
    cache: { read: number; write: number }
  }
}

function usage(part: (typeof SessionLegacy.Event.PartUpdated.Type)["data"]["part"] | unknown): Usage | undefined {
  if (typeof part !== "object" || part === null) return undefined
  const value = part as Record<string, unknown>
  if (value.type !== "step-finish") return undefined
  if (!("cost" in value) || !("tokens" in value)) return undefined
  return { cost: value.cost as Usage["cost"], tokens: value.tokens as Usage["tokens"] }
}

function sessionRow(info: SessionLegacy.SessionInfo): typeof SessionTable.$inferInsert {
  return {
    id: info.id,
    project_id: info.projectID,
    workspace_id: info.workspaceID ?? null,
    parent_id: info.parentID,
    slug: info.slug,
    directory: info.directory,
    path: info.path,
    title: info.title,
    agent: info.agent,
    model: info.model,
    version: info.version,
    share_url: info.share?.url,
    summary_additions: info.summary?.additions,
    summary_deletions: info.summary?.deletions,
    summary_files: info.summary?.files,
    summary_diffs: info.summary?.diffs ? [...info.summary.diffs] : undefined,
    metadata: info.metadata,
    cost: info.cost ?? 0,
    tokens_input: (info.tokens ?? { input: 0 }).input,
    tokens_output: (info.tokens ?? { output: 0 }).output,
    tokens_reasoning: (info.tokens ?? { reasoning: 0 }).reasoning,
    tokens_cache_read: (info.tokens ?? { cache: { read: 0 } }).cache.read,
    tokens_cache_write: (info.tokens ?? { cache: { write: 0 } }).cache.write,
    revert: info.revert ?? null,
    permission: info.permission ? [...info.permission] : undefined,
    time_created: info.time.created,
    time_updated: info.time.updated,
    time_compacting: info.time.compacting,
    time_archived: info.time.archived,
  }
}

function messageData(
  info: (typeof SessionLegacy.Event.MessageUpdated.Type)["data"]["info"],
): typeof MessageTable.$inferInsert.data {
  const { id: _, sessionID: __, ...rest } = info
  return rest as DeepMutable<typeof rest>
}

function partData(
  part: (typeof SessionLegacy.Event.PartUpdated.Type)["data"]["part"],
): typeof PartTable.$inferInsert.data {
  const { id: _, messageID: __, sessionID: ___, ...rest } = part
  return rest as DeepMutable<typeof rest>
}

function applyUsage(
  db: DatabaseService,
  sessionID: (typeof SessionLegacy.Event.MessageUpdated.Type)["data"]["sessionID"],
  value: Usage,
  sign = 1,
) {
  return db
    .update(SessionTable)
    .set({
      cost: sql`${SessionTable.cost} + ${value.cost * sign}`,
      tokens_input: sql`${SessionTable.tokens_input} + ${value.tokens.input * sign}`,
      tokens_output: sql`${SessionTable.tokens_output} + ${value.tokens.output * sign}`,
      tokens_reasoning: sql`${SessionTable.tokens_reasoning} + ${value.tokens.reasoning * sign}`,
      tokens_cache_read: sql`${SessionTable.tokens_cache_read} + ${value.tokens.cache.read * sign}`,
      tokens_cache_write: sql`${SessionTable.tokens_cache_write} + ${value.tokens.cache.write * sign}`,
      time_updated: sql`${SessionTable.time_updated}`,
    })
    .where(eq(SessionTable.id, sessionID))
    .run()
    .pipe(Effect.orDie)
}

function run(db: DatabaseService, event: SessionEvent.Event) {
  return Effect.gen(function* () {
    const adapter: SessionMessageUpdater.Adapter = {
      getCurrentAssistant() {
        return Effect.gen(function* () {
          const rows = yield* db
            .select()
            .from(SessionMessageTable)
            .where(
              and(eq(SessionMessageTable.session_id, event.data.sessionID), eq(SessionMessageTable.type, "assistant")),
            )
            .all()
            .pipe(Effect.orDie)
          return rows
            .map((row) => decodeMessage({ ...row.data, id: row.id, type: row.type }))
            .find(
              (message): message is SessionMessage.Assistant => message.type === "assistant" && !message.time.completed,
            )
        })
      },
      getCurrentCompaction() {
        return Effect.gen(function* () {
          const rows = yield* db
            .select()
            .from(SessionMessageTable)
            .where(
              and(eq(SessionMessageTable.session_id, event.data.sessionID), eq(SessionMessageTable.type, "compaction")),
            )
            .all()
            .pipe(Effect.orDie)
          return rows
            .map((row) => decodeMessage({ ...row.data, id: row.id, type: row.type }))
            .find((message): message is SessionMessage.Compaction => message.type === "compaction")
        })
      },
      getCurrentShell(callID) {
        return Effect.gen(function* () {
          const rows = yield* db
            .select()
            .from(SessionMessageTable)
            .where(and(eq(SessionMessageTable.session_id, event.data.sessionID), eq(SessionMessageTable.type, "shell")))
            .all()
            .pipe(Effect.orDie)
          return rows
            .map((row) => decodeMessage({ ...row.data, id: row.id, type: row.type }))
            .find((message): message is SessionMessage.Shell => message.type === "shell" && message.callID === callID)
        })
      },
      updateAssistant(message) {
        return Effect.gen(function* () {
          const encoded = encodeMessage(message)
          const { id, type, ...data } = encoded
          yield* db
            .insert(SessionMessageTable)
            .values([
              {
                id: SessionMessage.ID.make(id),
                session_id: event.data.sessionID,
                type,
                time_created: DateTime.toEpochMillis(message.time.created),
                data,
              },
            ])
            .onConflictDoUpdate({
              target: SessionMessageTable.id,
              set: {
                type,
                time_created: DateTime.toEpochMillis(message.time.created),
                data,
              },
            })
            .run()
            .pipe(Effect.orDie)
        })
      },
      updateCompaction(message) {
        return Effect.gen(function* () {
          const encoded = encodeMessage(message)
          const { id, type, ...data } = encoded
          yield* db
            .insert(SessionMessageTable)
            .values([
              {
                id: SessionMessage.ID.make(id),
                session_id: event.data.sessionID,
                type,
                time_created: DateTime.toEpochMillis(message.time.created),
                data,
              },
            ])
            .onConflictDoUpdate({
              target: SessionMessageTable.id,
              set: {
                type,
                time_created: DateTime.toEpochMillis(message.time.created),
                data,
              },
            })
            .run()
            .pipe(Effect.orDie)
        })
      },
      updateShell(message) {
        return Effect.gen(function* () {
          const encoded = encodeMessage(message)
          const { id, type, ...data } = encoded
          yield* db
            .insert(SessionMessageTable)
            .values([
              {
                id: SessionMessage.ID.make(id),
                session_id: event.data.sessionID,
                type,
                time_created: DateTime.toEpochMillis(message.time.created),
                data,
              },
            ])
            .onConflictDoUpdate({
              target: SessionMessageTable.id,
              set: {
                type,
                time_created: DateTime.toEpochMillis(message.time.created),
                data,
              },
            })
            .run()
            .pipe(Effect.orDie)
        })
      },
      appendMessage(message) {
        return Effect.gen(function* () {
          const encoded = encodeMessage(message)
          const { id, type, ...data } = encoded
          yield* db
            .insert(SessionMessageTable)
            .values([
              {
                id: SessionMessage.ID.make(id),
                session_id: event.data.sessionID,
                type,
                time_created: DateTime.toEpochMillis(message.time.created),
                data,
              },
            ])
            .onConflictDoUpdate({
              target: SessionMessageTable.id,
              set: {
                type,
                time_created: DateTime.toEpochMillis(message.time.created),
                data,
              },
            })
            .run()
            .pipe(Effect.orDie)
        })
      },
    }
    yield* SessionMessageUpdater.update(adapter, event)
  })
}

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const { db } = yield* Database.Service
    yield* events.project(SessionLegacy.Event.Created, (event) =>
      Effect.gen(function* () {
        yield* db.insert(SessionTable).values(sessionRow(event.data.info)).run().pipe(Effect.orDie)
        if (event.data.info.workspaceID) {
          yield* db
            .update(WorkspaceTable)
            .set({ time_used: Date.now() })
            .where(eq(WorkspaceTable.id, event.data.info.workspaceID))
            .run()
            .pipe(Effect.orDie)
        }
      }),
    )
    yield* events.project(SessionLegacy.Event.Updated, (event) =>
      db
        .update(SessionTable)
        .set(sessionRow(event.data.info))
        .where(eq(SessionTable.id, event.data.sessionID))
        .run()
        .pipe(Effect.orDie),
    )
    yield* events.project(SessionLegacy.Event.Deleted, (event) =>
      db.delete(SessionTable).where(eq(SessionTable.id, event.data.sessionID)).run().pipe(Effect.orDie),
    )
    yield* events.project(SessionLegacy.Event.MessageUpdated, (event) =>
      Effect.gen(function* () {
        const time_created = event.data.info.time.created
        const id = event.data.info.id
        const sessionID = event.data.info.sessionID
        const data = messageData(event.data.info)
        yield* db
          .insert(MessageTable)
          .values({ id, session_id: sessionID, time_created, data })
          .onConflictDoUpdate({ target: MessageTable.id, set: { data } })
          .run()
          .pipe(Effect.orDie)
      }),
    )
    yield* events.project(SessionLegacy.Event.MessageRemoved, (event) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select()
          .from(PartTable)
          .where(and(eq(PartTable.message_id, event.data.messageID), eq(PartTable.session_id, event.data.sessionID)))
          .all()
          .pipe(Effect.orDie)
        for (const row of rows) {
          const previous = usage(row.data)
          if (previous) yield* applyUsage(db, event.data.sessionID, previous, -1)
        }
        yield* db
          .delete(MessageTable)
          .where(and(eq(MessageTable.id, event.data.messageID), eq(MessageTable.session_id, event.data.sessionID)))
          .run()
          .pipe(Effect.orDie)
      }),
    )
    yield* events.project(SessionLegacy.Event.PartRemoved, (event) =>
      Effect.gen(function* () {
        const row = yield* db
          .select()
          .from(PartTable)
          .where(and(eq(PartTable.id, event.data.partID), eq(PartTable.session_id, event.data.sessionID)))
          .get()
          .pipe(Effect.orDie)
        const previous = row && usage(row.data)
        if (previous) yield* applyUsage(db, event.data.sessionID, previous, -1)
        yield* db
          .delete(PartTable)
          .where(and(eq(PartTable.id, event.data.partID), eq(PartTable.session_id, event.data.sessionID)))
          .run()
          .pipe(Effect.orDie)
      }),
    )
    yield* events.project(SessionLegacy.Event.PartUpdated, (event) =>
      Effect.gen(function* () {
        const id = event.data.part.id
        const messageID = event.data.part.messageID
        const sessionID = event.data.part.sessionID
        const data = partData(event.data.part)
        const row = yield* db.select().from(PartTable).where(eq(PartTable.id, id)).get().pipe(Effect.orDie)
        yield* db
          .insert(PartTable)
          .values({ id, message_id: messageID, session_id: sessionID, time_created: event.data.time, data })
          .onConflictDoUpdate({ target: PartTable.id, set: { data } })
          .run()
          .pipe(Effect.orDie)
        const previous = row && usage(row.data)
        const next = usage(event.data.part)
        if (previous) yield* applyUsage(db, row.session_id, previous, -1)
        if (next) yield* applyUsage(db, sessionID, next)
      }),
    )
    // session.next.* projectors are disabled while the v2 message projection is stabilized.
    // The events still publish through EventV2 and fan out through the opencode bridge.
    // yield* events.project(SessionEvent.AgentSwitched, (event) =>
    //   Effect.gen(function* () {
    //     const message = Schema.encodeSync(SessionMessage.AgentSwitched)(
    //       new SessionMessage.AgentSwitched({
    //         id: event.id,
    //         type: "agent-switched",
    //         metadata: event.metadata,
    //         agent: event.data.agent,
    //         time: { created: event.data.timestamp },
    //       }),
    //     )
    //     const data = { metadata: message.metadata, agent: message.agent, time: message.time }
    //     yield* db
    //       .update(SessionTable)
    //       .set({ agent: event.data.agent, time_updated: DateTime.toEpochMillis(event.data.timestamp) })
    //       .where(eq(SessionTable.id, event.data.sessionID))
    //       .run()
    //       .pipe(Effect.orDie)
    //     yield* db
    //       .insert(SessionMessageTable)
    //       .values([
    //         {
    //           id: SessionMessage.ID.make(event.id),
    //           session_id: event.data.sessionID,
    //           type: "agent-switched",
    //           time_created: DateTime.toEpochMillis(event.data.timestamp),
    //           data,
    //         },
    //       ])
    //       .run()
    //       .pipe(Effect.orDie)
    //   }),
    // )
    // yield* events.project(SessionEvent.ModelSwitched, (event) =>
    //   Effect.gen(function* () {
    //     const message = Schema.encodeSync(SessionMessage.ModelSwitched)(
    //       new SessionMessage.ModelSwitched({
    //         id: event.id,
    //         type: "model-switched",
    //         metadata: event.metadata,
    //         model: event.data.model,
    //         time: { created: event.data.timestamp },
    //       }),
    //     )
    //     const data = { metadata: message.metadata, model: message.model, time: message.time }
    //     yield* db
    //       .update(SessionTable)
    //       .set({ model: event.data.model, time_updated: DateTime.toEpochMillis(event.data.timestamp) })
    //       .where(eq(SessionTable.id, event.data.sessionID))
    //       .run()
    //       .pipe(Effect.orDie)
    //     yield* db
    //       .insert(SessionMessageTable)
    //       .values([
    //         {
    //           id: SessionMessage.ID.make(event.id),
    //           session_id: event.data.sessionID,
    //           type: "model-switched",
    //           time_created: DateTime.toEpochMillis(event.data.timestamp),
    //           data,
    //         },
    //       ])
    //       .run()
    //       .pipe(Effect.orDie)
    //   }),
    // )
    // yield* events.project(SessionEvent.Prompted, (event) => run(db, event))
    // yield* events.project(SessionEvent.Synthetic, (event) => run(db, event))
    // yield* events.project(SessionEvent.Shell.Started, (event) => run(db, event))
    // yield* events.project(SessionEvent.Shell.Ended, (event) => run(db, event))
    // yield* events.project(SessionEvent.Step.Started, (event) => run(db, event))
    // yield* events.project(SessionEvent.Step.Ended, (event) => run(db, event))
    // yield* events.project(SessionEvent.Step.Failed, (event) => run(db, event))
    // yield* events.project(SessionEvent.Text.Started, (event) => run(db, event))
    // yield* events.project(SessionEvent.Text.Ended, (event) => run(db, event))
    // yield* events.project(SessionEvent.Tool.Input.Started, (event) => run(db, event))
    // yield* events.project(SessionEvent.Tool.Input.Ended, (event) => run(db, event))
    // yield* events.project(SessionEvent.Tool.Called, (event) => run(db, event))
    // yield* events.project(SessionEvent.Tool.Success, (event) => run(db, event))
    // yield* events.project(SessionEvent.Tool.Failed, (event) => run(db, event))
    // yield* events.project(SessionEvent.Reasoning.Started, (event) => run(db, event))
    // yield* events.project(SessionEvent.Reasoning.Ended, (event) => run(db, event))
    // yield* events.project(SessionEvent.Retried, (event) => run(db, event))
    // yield* events.project(SessionEvent.Compaction.Started, (event) => run(db, event))
    // yield* events.project(SessionEvent.Compaction.Ended, (event) => run(db, event))
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(EventV2.defaultLayer), Layer.provide(Database.defaultLayer))
