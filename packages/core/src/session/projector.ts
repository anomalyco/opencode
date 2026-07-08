export * as SessionProjector from "./projector"

import { and, asc, desc, eq, gt, gte, inArray, lt, or, sql } from "drizzle-orm"
import { DateTime, Effect, Layer, Schema, Stream } from "effect"
import { Database } from "../database/database"
import { EventV2 } from "../event"
import { makeGlobalNode } from "../effect/app-node"
import { ModelV2 } from "../model"
import { SessionEvent } from "./event"
import { SessionV1 } from "../v1/session"
import { WorkspaceTable } from "../control-plane/workspace.sql"
import { SessionMessage } from "./message"
import { SessionMessageUpdater } from "./message-updater"
import { SessionInput } from "./input"
import { WorkspaceV2 } from "../workspace"
import { InstructionCheckpoint } from "./instruction-checkpoint"
import {
  MessageTable,
  PartTable,
  InstructionCheckpointTable,
  SessionInputTable,
  SessionMessageTable,
  SessionTable,
} from "./sql"
import type { DeepMutable } from "../schema"
import { Slug } from "../util/slug"
import { Money } from "@opencode-ai/schema/money"

type DatabaseService = Database.Interface["db"]
type CurrentDurableEvent = Extract<SessionEvent.Event, { readonly durable: object }>
type MessageEvent = Exclude<CurrentDurableEvent, typeof SessionEvent.Forked.Type | typeof SessionEvent.Deleted.Type>

const decodeMessage = Schema.decodeUnknownSync(SessionMessage.Info)
const encodeMessage = Schema.encodeSync(SessionMessage.Info)

export class SessionAlreadyProjected extends Error {}

type Usage = {
  cost: number
  tokens: {
    input: number
    output: number
    reasoning: number
    cache: { read: number; write: number }
  }
}

const ForkBatchSize = 500

const forkTitle = (value: string) => {
  const match = value.match(/^(.+) \(fork #(\d+)\)$/)
  if (match) return `${match[1]} (fork #${Number.parseInt(match[2], 10) + 1})`
  return `${value} (fork #1)`
}

function usage(part: (typeof SessionV1.Event.PartUpdated.Type)["data"]["part"] | unknown): Usage | undefined {
  if (typeof part !== "object" || part === null) return undefined
  const value = part as Record<string, unknown>
  if (value.type !== "step-finish") return undefined
  if (!("cost" in value) || !("tokens" in value)) return undefined
  return { cost: value.cost as Usage["cost"], tokens: value.tokens as Usage["tokens"] }
}

function sessionRow(info: SessionV1.SessionInfo): typeof SessionTable.$inferInsert {
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
    revert: info.revert
      ? {
          messageID: SessionMessage.ID.make(info.revert.messageID),
          partID: info.revert.partID,
          snapshot: info.revert.snapshot,
          diff: info.revert.diff,
        }
      : null,
    permission: info.permission ? [...info.permission] : undefined,
    time_created: info.time.created,
    time_updated: info.time.updated,
    time_compacting: info.time.compacting,
    time_archived: info.time.archived,
  }
}

function messageData(
  info: (typeof SessionV1.Event.MessageUpdated.Type)["data"]["info"],
): typeof MessageTable.$inferInsert.data {
  const { id: _, sessionID: __, ...rest } = info
  return rest as DeepMutable<typeof rest>
}

function partData(part: (typeof SessionV1.Event.PartUpdated.Type)["data"]["part"]): typeof PartTable.$inferInsert.data {
  const { id: _, messageID: __, sessionID: ___, ...rest } = part
  return rest as DeepMutable<typeof rest>
}

function applyUsage(
  db: DatabaseService,
  sessionID: (typeof SessionV1.Event.MessageUpdated.Type)["data"]["sessionID"],
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

const publishSessionUsage = Effect.fn("SessionProjector.publishUsage")(function* (
  db: DatabaseService,
  events: EventV2.Interface,
  sessionID: (typeof SessionEvent.Step.Ended.Type)["data"]["sessionID"],
) {
  const row = yield* db
    .select({
      cost: SessionTable.cost,
      input: SessionTable.tokens_input,
      output: SessionTable.tokens_output,
      reasoning: SessionTable.tokens_reasoning,
      cacheRead: SessionTable.tokens_cache_read,
      cacheWrite: SessionTable.tokens_cache_write,
    })
    .from(SessionTable)
    .where(eq(SessionTable.id, sessionID))
    .get()
    .pipe(Effect.orDie)
  if (!row) return
  yield* events.publish(SessionEvent.UsageUpdated, {
    sessionID,
    cost: Money.USD.make(row.cost),
    tokens: {
      input: row.input,
      output: row.output,
      reasoning: row.reasoning,
      cache: { read: row.cacheRead, write: row.cacheWrite },
    },
  })
})

const projectFork = Effect.fn("SessionProjector.projectFork")(function* (
  db: DatabaseService,
  event: typeof SessionEvent.Forked.Type,
) {
  const parent = yield* db
    .select()
    .from(SessionTable)
    .where(eq(SessionTable.id, event.data.parentID))
    .get()
    .pipe(Effect.orDie)
  if (!parent) return yield* Effect.die(new Error(`Fork parent session not found: ${event.data.parentID}`))
  const boundary = event.data.from
    ? yield* db
        .select({ seq: SessionMessageTable.seq })
        .from(SessionMessageTable)
        .where(
          and(eq(SessionMessageTable.session_id, event.data.parentID), eq(SessionMessageTable.id, event.data.from)),
        )
        .get()
        .pipe(Effect.orDie)
    : undefined
  if (event.data.from && !boundary)
    return yield* Effect.die(new Error(`Fork boundary message not found: ${event.data.from}`))
  const copied = yield* db
    .select({ seq: SessionMessageTable.seq })
    .from(SessionMessageTable)
    .where(
      and(
        eq(SessionMessageTable.session_id, event.data.parentID),
        boundary === undefined ? undefined : lt(SessionMessageTable.seq, boundary.seq),
      ),
    )
    .orderBy(desc(SessionMessageTable.seq))
    .limit(1)
    .get()
    .pipe(Effect.orDie)
  const copiedSeq = copied?.seq

  const stored = yield* db
    .insert(SessionTable)
    .values({
      id: event.data.sessionID,
      parent_id: null,
      fork_session_id: event.data.parentID,
      fork_message_id: event.data.from,
      project_id: parent.project_id,
      workspace_id: parent.workspace_id,
      slug: Slug.create(),
      directory: parent.directory,
      path: parent.path,
      title: forkTitle(parent.title),
      agent: parent.agent,
      model: parent.model,
      version: parent.version,
      cost: 0,
      tokens_input: 0,
      tokens_output: 0,
      tokens_reasoning: 0,
      tokens_cache_read: 0,
      tokens_cache_write: 0,
      time_created: DateTime.toEpochMillis(event.created),
      time_updated: DateTime.toEpochMillis(event.created),
    })
    .onConflictDoNothing()
    .returning({ sessionID: SessionTable.id })
    .get()
    .pipe(Effect.orDie)
  if (!stored) return yield* Effect.die(new SessionAlreadyProjected())

  // The fork inherits the parent's transcript, so it inherits the context
  // checkpoint that transcript was built against: copied message seqs keep
  // folding at the same baseline horizon.
  const checkpoint = yield* db
    .select()
    .from(InstructionCheckpointTable)
    .where(eq(InstructionCheckpointTable.session_id, event.data.parentID))
    .get()
    .pipe(Effect.orDie)
  if (checkpoint) {
    yield* db
      .insert(InstructionCheckpointTable)
      .values({ ...checkpoint, session_id: event.data.sessionID })
      .run()
      .pipe(Effect.orDie)
  }

  let cursor = -1
  while (copiedSeq !== undefined) {
    const rows = yield* db
      .select()
      .from(SessionMessageTable)
      .where(
        and(
          eq(SessionMessageTable.session_id, event.data.parentID),
          gt(SessionMessageTable.seq, cursor),
          lt(SessionMessageTable.seq, copiedSeq + 1),
          sql`${SessionMessageTable.type} != 'compaction' or json_extract(${SessionMessageTable.data}, '$.status') != 'running'`,
        ),
      )
      .orderBy(asc(SessionMessageTable.seq))
      .limit(ForkBatchSize)
      .all()
      .pipe(Effect.orDie)
    if (rows.length === 0) break

    const idMap = new Map(rows.map((row) => [row.id, SessionMessage.ID.create()]))
    yield* db
      .insert(SessionMessageTable)
      .values(
        rows.map((row) => {
          const id = idMap.get(row.id)
          if (!id) throw new Error(`Fork message ID mapping missing: ${row.id}`)
          return {
            id,
            session_id: event.data.sessionID,
            type: row.type,
            seq: row.seq,
            time_created: row.time_created,
            time_updated: row.time_updated,
            data: row.data,
          }
        }),
      )
      .run()
      .pipe(Effect.orDie)

    const inputRows = yield* db
      .select()
      .from(SessionInputTable)
      .where(
        and(
          eq(SessionInputTable.session_id, event.data.parentID),
          inArray(
            SessionInputTable.id,
            rows.map((row) => row.id),
          ),
        ),
      )
      .all()
      .pipe(Effect.orDie)
    if (inputRows.length > 0) {
      yield* db
        .insert(SessionInputTable)
        .values(
          inputRows.flatMap((row) => {
            const id = idMap.get(row.id)
            return id && row.type === "prompt"
              ? [
                  {
                    id,
                    session_id: event.data.sessionID,
                    type: "prompt" as const,
                    prompt: row.prompt,
                    delivery: row.delivery,
                    admitted_seq: row.admitted_seq,
                    promoted_seq: row.promoted_seq,
                    time_created: row.time_created,
                  },
                ]
              : []
          }),
        )
        .run()
        .pipe(Effect.orDie)
    }

    cursor = rows.at(-1)!.seq
  }
  if (copiedSeq !== undefined) yield* EventV2.reserveSequence(db, event.data.sessionID, copiedSeq)
})

function run(db: DatabaseService, event: MessageEvent) {
  return Effect.gen(function* () {
    const decodeRow = (row: typeof SessionMessageTable.$inferSelect) =>
      decodeMessage({ ...row.data, id: row.id, type: row.type })
    const updateMessage = (message: SessionMessage.Info) => {
      if (event.durable === undefined)
        return Effect.die(new Error("Durable Session event is missing aggregate sequence"))
      const encoded = encodeMessage(message)
      const { id, type, ...data } = encoded
      return db
        .update(SessionMessageTable)
        .set({ type, time_created: DateTime.toEpochMillis(message.time.created), data })
        .where(
          and(
            eq(SessionMessageTable.id, SessionMessage.ID.make(id)),
            eq(SessionMessageTable.session_id, event.data.sessionID),
          ),
        )
        .run()
        .pipe(Effect.orDie)
    }
    const appendMessage = (message: SessionMessage.Info) => insertMessage(db, event, message)
    const adapter: SessionMessageUpdater.Adapter = {
      getModel() {
        return db
          .select({ model: SessionTable.model })
          .from(SessionTable)
          .where(eq(SessionTable.id, event.data.sessionID))
          .get()
          .pipe(
            Effect.orDie,
            Effect.map((row) => (row?.model ? Schema.decodeUnknownSync(ModelV2.Ref)(row.model) : undefined)),
          )
      },
      getCurrentAssistant() {
        return Effect.gen(function* () {
          // A newer step supersedes stale incomplete rows; never resume an older assistant projection.
          const row = yield* db
            .select()
            .from(SessionMessageTable)
            .where(
              and(eq(SessionMessageTable.session_id, event.data.sessionID), eq(SessionMessageTable.type, "assistant")),
            )
            .orderBy(desc(SessionMessageTable.seq))
            .limit(1)
            .get()
            .pipe(Effect.orDie)
          if (!row) return
          const message = decodeRow(row)
          return message.type === "assistant" && !message.time.completed ? message : undefined
        })
      },
      getAssistant(messageID) {
        return Effect.gen(function* () {
          const row = yield* db
            .select()
            .from(SessionMessageTable)
            .where(
              and(
                eq(SessionMessageTable.id, messageID),
                eq(SessionMessageTable.session_id, event.data.sessionID),
                eq(SessionMessageTable.type, "assistant"),
              ),
            )
            .get()
            .pipe(Effect.orDie)
          if (!row) return
          const message = decodeRow(row)
          return message.type === "assistant" ? message : undefined
        })
      },
      getShell(shellID) {
        return Effect.gen(function* () {
          const row = yield* db
            .select()
            .from(SessionMessageTable)
            .where(
              and(
                eq(SessionMessageTable.session_id, event.data.sessionID),
                eq(SessionMessageTable.type, "shell"),
                sql`json_extract(${SessionMessageTable.data}, '$.shellID') = ${shellID}`,
              ),
            )
            .orderBy(desc(SessionMessageTable.seq))
            .limit(1)
            .get()
            .pipe(Effect.orDie)
          if (!row) return
          const message = decodeRow(row)
          return message.type === "shell" ? message : undefined
        })
      },
      getCompaction() {
        return Effect.gen(function* () {
          const row = yield* db
            .select()
            .from(SessionMessageTable)
            .where(
              and(
                eq(SessionMessageTable.session_id, event.data.sessionID),
                eq(SessionMessageTable.type, "compaction"),
                sql`json_extract(${SessionMessageTable.data}, '$.status') = 'running'`,
              ),
            )
            .orderBy(desc(SessionMessageTable.seq))
            .limit(1)
            .get()
            .pipe(Effect.orDie)
          if (!row) return
          const message = decodeRow(row)
          return message.type === "compaction" ? message : undefined
        })
      },
      updateAssistant: updateMessage,
      updateShell: updateMessage,
      updateCompaction: updateMessage,
      appendMessage,
    }
    yield* SessionMessageUpdater.update(adapter, event)
  })
}

function insertMessage(db: DatabaseService, event: SessionEvent.DurableEvent, message: SessionMessage.Info) {
  if (event.durable === undefined) return Effect.die(new Error("Durable Session event is missing aggregate sequence"))
  const encoded = encodeMessage(message)
  const { id, type, ...data } = encoded
  return db
    .insert(SessionMessageTable)
    .values({
      id: SessionMessage.ID.make(id),
      session_id: event.data.sessionID,
      type,
      seq: event.durable.seq,
      time_created: DateTime.toEpochMillis(message.time.created),
      data,
    })
    .run()
    .pipe(Effect.orDie)
}

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const db = (yield* Database.Service).db
    yield* events.project(SessionV1.Event.Created, (event) =>
      Effect.gen(function* () {
        const stored = yield* db
          .insert(SessionTable)
          .values(sessionRow(event.data.info))
          .onConflictDoNothing()
          .returning({ sessionID: SessionTable.id })
          .get()
          .pipe(Effect.orDie)
        if (!stored) return yield* Effect.die(new SessionAlreadyProjected())
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
    yield* events.project(SessionV1.Event.Updated, (event) =>
      db
        .update(SessionTable)
        .set(sessionRow(event.data.info))
        .where(eq(SessionTable.id, event.data.sessionID))
        .run()
        .pipe(Effect.orDie),
    )
    yield* events.project(SessionEvent.Moved, (event) =>
      Effect.gen(function* () {
        yield* db
          .update(SessionTable)
          .set({
            directory: event.data.location.directory,
            path: event.data.subpath,
            workspace_id: event.data.location.workspaceID ? WorkspaceV2.ID.make(event.data.location.workspaceID) : null,
            time_updated: DateTime.toEpochMillis(event.created),
          })
          .where(eq(SessionTable.id, event.data.sessionID))
          .run()
          .pipe(Effect.orDie)
        yield* InstructionCheckpoint.reset(db, event.data.sessionID)
      }),
    )
    yield* events.project(SessionV1.Event.Deleted, (event) =>
      db.delete(SessionTable).where(eq(SessionTable.id, event.data.sessionID)).run().pipe(Effect.orDie),
    )
    yield* events.project(SessionEvent.Deleted, (event) =>
      db.delete(SessionTable).where(eq(SessionTable.id, event.data.sessionID)).run().pipe(Effect.orDie),
    )
    yield* events.project(SessionV1.Event.MessageUpdated, (event) =>
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
    yield* events.project(SessionV1.Event.MessageRemoved, (event) =>
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
    yield* events.project(SessionV1.Event.PartRemoved, (event) =>
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
    yield* events.project(SessionV1.Event.PartUpdated, (event) =>
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
    yield* events.project(SessionEvent.AgentSelected, (event) =>
      db
        .update(SessionTable)
        .set({ agent: event.data.agent, time_updated: DateTime.toEpochMillis(event.created) })
        .where(eq(SessionTable.id, event.data.sessionID))
        .run()
        .pipe(Effect.orDie, Effect.andThen(run(db, event))),
    )
    yield* events.project(SessionEvent.ModelSelected, (event) =>
      Effect.gen(function* () {
        yield* run(db, event)
        yield* db
          .update(SessionTable)
          .set({ model: event.data.model, time_updated: DateTime.toEpochMillis(event.created) })
          .where(eq(SessionTable.id, event.data.sessionID))
          .run()
          .pipe(Effect.orDie)
      }),
    )
    yield* events.project(SessionEvent.Renamed, (event) =>
      db
        .update(SessionTable)
        .set({ title: event.data.title, time_updated: DateTime.toEpochMillis(event.created) })
        .where(eq(SessionTable.id, event.data.sessionID))
        .run()
        .pipe(Effect.orDie),
    )
    yield* events.project(SessionEvent.Forked, (event) => projectFork(db, event))
    yield* events.project(SessionEvent.PromptPromoted, (event) =>
      Effect.gen(function* () {
        if (event.durable === undefined)
          return yield* Effect.die(new Error("Durable Session event is missing aggregate sequence"))
        const input = yield* SessionInput.projectPromptPromoted(db, {
          id: event.data.inputID,
          sessionID: event.data.sessionID,
          promotedSeq: event.durable.seq,
        })
        yield* insertMessage(db, event, {
          id: input.id,
          type: "user",
          metadata: event.metadata,
          text: input.prompt.text,
          files: input.prompt.files,
          agents: input.prompt.agents,
          time: { created: event.created },
        })
      }),
    )
    yield* events.project(SessionEvent.PromptAdmitted, (event) =>
      Effect.gen(function* () {
        if (event.durable === undefined)
          return yield* Effect.die(new Error("Durable Session event is missing aggregate sequence"))
        yield* SessionInput.projectAdmitted(db, {
          admittedSeq: event.durable.seq,
          id: event.data.inputID,
          sessionID: event.data.sessionID,
          prompt: event.data.prompt,
          delivery: event.data.delivery,
          timeCreated: event.created,
        })
      }),
    )
    yield* events.project(SessionEvent.Compaction.Admitted, (event) =>
      Effect.gen(function* () {
        if (event.durable === undefined)
          return yield* Effect.die(new Error("Durable Session event is missing aggregate sequence"))
        yield* SessionInput.projectCompactionAdmitted(db, {
          admittedSeq: event.durable.seq,
          id: event.data.inputID,
          sessionID: event.data.sessionID,
          timeCreated: event.created,
        })
      }),
    )
    yield* events.project(SessionEvent.Execution.Succeeded, (event) => run(db, event))
    yield* events.project(SessionEvent.Execution.Failed, (event) => run(db, event))
    yield* events.project(SessionEvent.Execution.Interrupted, (event) => run(db, event))
    yield* events.project(SessionEvent.InstructionsUpdated, (event) => run(db, event))
    yield* events.project(SessionEvent.Synthetic, (event) => run(db, event))
    yield* events.project(SessionEvent.Skill.Activated, (event) => run(db, event))
    yield* events.project(SessionEvent.Shell.Started, (event) => run(db, event))
    yield* events.project(SessionEvent.Shell.Ended, (event) => run(db, event))
    yield* events.project(SessionEvent.Step.Started, (event) => run(db, event))
    yield* events.project(SessionEvent.Step.Ended, (event) =>
      Effect.gen(function* () {
        yield* run(db, event)
        yield* applyUsage(db, event.data.sessionID, event.data)
      }),
    )
    yield* events.project(SessionEvent.Step.Failed, (event) =>
      Effect.gen(function* () {
        yield* run(db, event)
        if (event.data.cost !== undefined && event.data.tokens !== undefined)
          yield* applyUsage(db, event.data.sessionID, { cost: event.data.cost, tokens: event.data.tokens })
      }),
    )
    yield* events.project(SessionEvent.Text.Started, (event) => run(db, event))
    yield* events.project(SessionEvent.Text.Ended, (event) => run(db, event))
    yield* events.project(SessionEvent.Tool.Input.Started, (event) => run(db, event))
    yield* events.project(SessionEvent.Tool.Input.Ended, (event) => run(db, event))
    yield* events.project(SessionEvent.Tool.Called, (event) => run(db, event))
    yield* events.project(SessionEvent.Tool.Progress, (event) => run(db, event))
    yield* events.project(SessionEvent.Tool.Success, (event) => run(db, event))
    yield* events.project(SessionEvent.Tool.Failed, (event) => run(db, event))
    yield* events.project(SessionEvent.Reasoning.Started, (event) => run(db, event))
    yield* events.project(SessionEvent.Reasoning.Ended, (event) => run(db, event))
    yield* events.project(SessionEvent.RetryScheduled, (event) => run(db, event))
    yield* events.project(SessionEvent.Compaction.Started, (event) => run(db, event))
    yield* events.project(SessionEvent.Compaction.Ended, (event) =>
      Effect.gen(function* () {
        yield* run(db, event)
        if (event.durable === undefined)
          return yield* Effect.die(new Error("Durable Session event is missing aggregate sequence"))
        if (event.data.reason === "manual")
          yield* SessionInput.settleCompaction(db, {
            sessionID: event.data.sessionID,
            handledSeq: event.durable.seq,
          })
      }),
    )
    yield* events.project(SessionEvent.Compaction.Failed, (event) =>
      Effect.gen(function* () {
        yield* run(db, event)
        if (event.durable === undefined)
          return yield* Effect.die(new Error("Durable Session event is missing aggregate sequence"))
        if (event.data.reason === "manual")
          yield* SessionInput.settleCompaction(db, {
            sessionID: event.data.sessionID,
            handledSeq: event.durable.seq,
          })
      }),
    )
    yield* events.project(SessionEvent.RevertEvent.Staged, (event) =>
      Effect.gen(function* () {
        const revert = event.data.revert
        yield* db
          .update(SessionTable)
          .set({
            revert: { ...revert, files: revert.files ? [...revert.files] : undefined },
            time_updated: DateTime.toEpochMillis(event.created),
          })
          .where(eq(SessionTable.id, event.data.sessionID))
          .run()
          .pipe(Effect.orDie)
      }),
    )
    yield* events.project(SessionEvent.RevertEvent.Cleared, (event) =>
      db
        .update(SessionTable)
        .set({ revert: null, time_updated: DateTime.toEpochMillis(event.created) })
        .where(eq(SessionTable.id, event.data.sessionID))
        .run()
        .pipe(Effect.orDie, Effect.asVoid),
    )
    yield* events.project(SessionEvent.RevertEvent.Committed, (event) =>
      Effect.gen(function* () {
        const boundary = yield* db
          .select({ seq: SessionMessageTable.seq })
          .from(SessionMessageTable)
          .where(
            and(eq(SessionMessageTable.session_id, event.data.sessionID), eq(SessionMessageTable.id, event.data.to)),
          )
          .get()
          .pipe(Effect.orDie)
        if (!boundary) return yield* Effect.die(new Error(`Revert boundary message not found: ${event.data.to}`))
        yield* db
          .delete(SessionMessageTable)
          .where(
            and(eq(SessionMessageTable.session_id, event.data.sessionID), gte(SessionMessageTable.seq, boundary.seq)),
          )
          .run()
          .pipe(Effect.orDie)
        yield* db
          .delete(SessionInputTable)
          .where(
            and(
              eq(SessionInputTable.session_id, event.data.sessionID),
              or(gte(SessionInputTable.admitted_seq, boundary.seq), gte(SessionInputTable.promoted_seq, boundary.seq)),
            ),
          )
          .run()
          .pipe(Effect.orDie)
        yield* db
          .update(SessionTable)
          .set({ revert: null, time_updated: DateTime.toEpochMillis(event.created) })
          .where(eq(SessionTable.id, event.data.sessionID))
          .run()
          .pipe(Effect.orDie)
        yield* InstructionCheckpoint.reset(db, event.data.sessionID)
      }),
    )
    yield* events.subscribe([SessionEvent.Step.Ended, SessionEvent.Step.Failed]).pipe(
      Stream.runForEach((event) => {
        if (
          event.type === SessionEvent.Step.Failed.type &&
          (event.data.cost === undefined || event.data.tokens === undefined)
        )
          return Effect.void
        return publishSessionUsage(db, events, event.data.sessionID)
      }),
      Effect.forkScoped({ startImmediately: true }),
    )
  }),
)

export const node = makeGlobalNode({ name: "session-projector", layer, deps: [EventV2.node, Database.node] })
