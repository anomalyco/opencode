export * as SessionProjector from "./projector.js"

import { and, asc, desc, eq, gt, gte, inArray, lt, lte, sql } from "drizzle-orm"
import { DateTime, Effect, Layer, Schema, Stream } from "effect"
import path from "path"
import { Database } from "../database/database.js"
import { KVTable } from "../kv/sql.js"
import { Bus } from "../bus.js"
import { makeGlobalNode } from "@opencode-ai/util/effect/app-node"
import { Agent } from "../agent.js"
import { Model } from "../model.js"
import { SessionEvent } from "./event.js"
import { SessionMessage } from "./message.js"
import { SessionMessageUpdater } from "./message-updater.js"
import { SessionInbox } from "./inbox.js"
import type { SessionStore } from "./store.js"
import { Workspace } from "../workspace.js"
import { InstructionState } from "./instruction-state.js"
import { SessionInboxTable, SessionMessageTable, SessionTable } from "./sql.js"
import { InstructionEntry } from "./instruction-entry.js"
import { Slug } from "../util/slug.js"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { Money } from "@opencode-ai/schema/money"
import { Worktree } from "@opencode-ai/schema/worktree"
import { Project } from "@opencode-ai/schema/project"
import { AbsolutePath, RelativePath } from "../schema.js"
import { SessionSchema } from "./schema.js"

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

const forkTitle = (value?: string) => {
  if (value === undefined) return
  const match = value.match(/^(.+) \(fork #(\d+)\)$/)
  if (match) return `${match[1]} (fork #${Number.parseInt(match[2], 10) + 1})`
  return `${value} (fork #1)`
}

function applyUsage(db: DatabaseService, sessionID: SessionSchema.ID, value: Usage, sign = 1) {
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
  bus: Bus.Interface,
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
  yield* bus.publish(SessionEvent.UsageUpdated, {
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
  const boundary = yield* db
    .select({ seq: SessionMessageTable.seq })
    .from(SessionMessageTable)
    .where(
      and(
        eq(SessionMessageTable.session_id, event.data.parentID),
        eq(SessionMessageTable.id, event.data.boundary.messageID),
      ),
    )
    .get()
    .pipe(Effect.orDie)
  if (!boundary)
    return yield* Effect.die(new Error(`Fork boundary message not found: ${event.data.boundary.messageID}`))
  const copied = yield* db
    .select({ seq: SessionMessageTable.seq })
    .from(SessionMessageTable)
    .where(
      and(
        eq(SessionMessageTable.session_id, event.data.parentID),
        event.data.boundary.type === "before"
          ? lt(SessionMessageTable.seq, boundary.seq)
          : lte(SessionMessageTable.seq, boundary.seq),
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
      fork_boundary: event.data.boundary,
      project_id: parent.project_id,
      workspace_id: parent.workspace_id,
      slug: Slug.create(),
      directory: parent.directory,
      path: parent.path,
      title: forkTitle(parent.title ?? undefined),
      agent: parent.agent,
      model: parent.model,
      version: parent.version,
      cost: 0,
      tokens_input: 0,
      tokens_output: 0,
      tokens_reasoning: 0,
      tokens_cache_read: 0,
      tokens_cache_write: 0,
      time_created: event.created,
      time_updated: event.created,
    })
    .onConflictDoNothing()
    .returning({ sessionID: SessionTable.id })
    .get()
    .pipe(Effect.orDie)
  if (!stored) return yield* Effect.die(new SessionAlreadyProjected())

  if (event.data.instructionEntries)
    yield* InstructionEntry.initialize(db, event.data.sessionID, event.data.instructionEntries, event.created)

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
          // Terminal events for active projections stay on the parent, so forks copy only settled history.
          sql`${SessionMessageTable.type} != 'assistant' or json_extract(${SessionMessageTable.data}, '$.time.completed') is not null`,
          sql`${SessionMessageTable.type} != 'shell' or json_extract(${SessionMessageTable.data}, '$.status') != 'running'`,
          sql`${SessionMessageTable.type} != 'compaction' or json_extract(${SessionMessageTable.data}, '$.status') != 'running'`,
        ),
      )
      .orderBy(asc(SessionMessageTable.seq))
      .limit(ForkBatchSize)
      .all()
      .pipe(Effect.orDie)
    if (rows.length === 0) break

    yield* db
      .insert(SessionMessageTable)
      .values(
        rows.map((row) => ({
          id: SessionMessage.ID.make(`${SessionMessage.ID.fromEvent(event.id)}_${row.seq}`),
          session_id: event.data.sessionID,
          type: row.type,
          seq: row.seq,
          time_created: row.time_created,
          time_updated: row.time_updated,
          data: row.data,
        })),
      )
      .run()
      .pipe(Effect.orDie)

    cursor = rows.at(-1)!.seq
  }
  if (copiedSeq !== undefined) yield* Bus.reserveSequence(db, event.data.sessionID, copiedSeq)
  if (event.data.instructions)
    yield* InstructionState.initialize(db, event.data.sessionID, event.durable.seq, event.data.instructions)
})

function run(db: DatabaseService, event: MessageEvent) {
  return Effect.gen(function* () {
    const decodeRow = (row: typeof SessionMessageTable.$inferSelect) =>
      decodeMessage({ ...row.data, id: row.id, type: row.type })
    const updateMessage = (message: SessionMessage.Info) => {
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
      getAgent() {
        return db
          .select({ agent: SessionTable.agent })
          .from(SessionTable)
          .where(eq(SessionTable.id, event.data.sessionID))
          .get()
          .pipe(
            Effect.orDie,
            Effect.map((row) => (row?.agent ? Agent.ID.make(row.agent) : undefined)),
          )
      },
      getModel() {
        return db
          .select({ model: SessionTable.model })
          .from(SessionTable)
          .where(eq(SessionTable.id, event.data.sessionID))
          .get()
          .pipe(
            Effect.orDie,
            Effect.map((row) => (row?.model ? Schema.decodeUnknownSync(Model.Ref)(row.model) : undefined)),
          )
      },
      getLocation() {
        return db
          .select({
            directory: SessionTable.directory,
            workspaceID: SessionTable.workspace_id,
            projectID: SessionTable.project_id,
            subpath: SessionTable.path,
          })
          .from(SessionTable)
          .where(eq(SessionTable.id, event.data.sessionID))
          .get()
          .pipe(
            Effect.orDie,
            Effect.map((row) =>
              row
                ? {
                    location: {
                      directory: AbsolutePath.make(row.directory),
                      workspaceID: row.workspaceID ? Workspace.ID.make(row.workspaceID) : undefined,
                    },
                    projectID: row.projectID,
                    subpath: row.subpath === null ? undefined : RelativePath.make(row.subpath),
                  }
                : undefined,
            ),
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

function backgroundKey(sessionID: SessionSchema.ID, type: "shell" | "subagent", id: string) {
  return `session.background/${sessionID}/${type}/${id}`
}

function settleBackground(db: DatabaseService, sessionID: SessionSchema.ID, metadata?: Record<string, unknown>) {
  if (metadata?.state !== "completed" && metadata?.state !== "error" && metadata?.state !== "cancelled")
    return Effect.void
  if (metadata.source !== "shell" && metadata.source !== "subagent") return Effect.void
  const id = metadata.source === "shell" ? metadata.shellID : metadata.childID
  if (typeof id !== "string") return Effect.void
  return db
    .delete(KVTable)
    .where(eq(KVTable.key, backgroundKey(sessionID, metadata.source, id)))
    .run()
    .pipe(Effect.orDie, Effect.asVoid)
}

const projectBackground = Effect.fn("SessionProjector.projectBackground")(function* (
  db: DatabaseService,
  input: {
    readonly sessionID: SessionSchema.ID
    readonly assistantMessageID: SessionMessage.ID
    readonly id: string
    readonly sequence: number
    readonly created: number
  },
) {
  const row = yield* db
    .select()
    .from(SessionMessageTable)
    .where(
      and(eq(SessionMessageTable.id, input.assistantMessageID), eq(SessionMessageTable.session_id, input.sessionID)),
    )
    .get()
    .pipe(Effect.orDie)
  if (!row || row.type !== "assistant") return
  const message = decodeMessage({ ...row.data, id: row.id, type: row.type })
  if (message.type !== "assistant") return
  const part = message.content.find((item) => item.type === "tool" && item.id === input.id)
  if (!part || part.type !== "tool" || part.state.status !== "completed" || !part.state.metadata) return
  const background: (SessionStore.Background & { readonly sequence: number }) | undefined =
    part.name === "shell" &&
    typeof part.state.metadata.shellID === "string" &&
    typeof part.state.input.command === "string"
      ? {
          type: "shell" as const,
          sessionID: input.sessionID,
          id: input.id,
          shellID: part.state.metadata.shellID,
          description: part.state.input.command,
          sequence: input.sequence,
        }
      : part.name === "subagent" &&
          typeof part.state.metadata.sessionID === "string" &&
          typeof part.state.input.agent === "string" &&
          typeof part.state.input.description === "string"
        ? {
            type: "subagent" as const,
            sessionID: input.sessionID,
            id: SessionSchema.ID.make(part.state.metadata.sessionID),
            agent: part.state.input.agent,
            description: part.state.input.description,
            sequence: input.sequence,
          }
        : undefined
  if (!background) return
  if (background.type === "subagent") {
    const child = yield* db
      .select({ id: SessionTable.id })
      .from(SessionTable)
      .where(and(eq(SessionTable.id, background.id), eq(SessionTable.parent_id, background.sessionID)))
      .get()
      .pipe(Effect.orDie)
    if (!child) return
  }

  const identity = background.type === "shell" ? background.shellID : background.id
  const path = background.type === "shell" ? "$.metadata.shellID" : "$.metadata.childID"
  const terminal = yield* db
    .get<{ found: number }>(
      sql`
      SELECT 1 AS found
      FROM ${SessionMessageTable}
      WHERE ${SessionMessageTable.session_id} = ${background.sessionID}
        AND ${SessionMessageTable.type} = 'synthetic'
        AND ${SessionMessageTable.seq} > ${row.seq}
        AND json_extract(${SessionMessageTable.data}, '$.metadata.source') = ${background.type}
        AND json_extract(${SessionMessageTable.data}, '$.metadata.state') IN ('completed', 'error', 'cancelled')
        AND json_extract(${SessionMessageTable.data}, ${path}) = ${identity}
      LIMIT 1
    `,
    )
    .pipe(Effect.orDie)
  if (terminal) return
  yield* db
    .insert(KVTable)
    .values({ key: backgroundKey(background.sessionID, background.type, identity), value: background })
    .onConflictDoUpdate({
      target: KVTable.key,
      set: { value: background, time_updated: input.created },
    })
    .run()
    .pipe(Effect.orDie)
})

function projectIdle(
  db: DatabaseService,
  event:
    | typeof SessionEvent.Execution.Succeeded.Type
    | typeof SessionEvent.Execution.Failed.Type
    | typeof SessionEvent.Execution.Interrupted.Type,
) {
  return Effect.gen(function* () {
    yield* run(db, event)
    if (event.type === SessionEvent.Execution.Interrupted.type && event.data.reason === "shutdown") return
    const time = event.created
    const outcome =
      event.type === SessionEvent.Execution.Succeeded.type
        ? "succeeded"
        : event.type === SessionEvent.Execution.Failed.type
          ? "failed"
          : "interrupted"
    yield* db
      .update(SessionTable)
      .set({
        // Unread uses a strict timestamp comparison, so every terminal must advance even within one millisecond.
        time_idle: sql`max(${time}, coalesce(${SessionTable.time_idle} + 1, ${time}))`,
        idle_outcome: outcome,
        time_updated: sql`${SessionTable.time_updated}`,
      })
      .where(eq(SessionTable.id, event.data.sessionID))
      .run()
      .pipe(Effect.orDie)
  })
}

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const db = (yield* Database.Service).db
    yield* bus.project(SessionEvent.Created, (event) =>
      Effect.gen(function* () {
        const stored = yield* db
          .insert(SessionTable)
          .values({
            id: event.data.sessionID,
            project_id: event.data.projectID,
            workspace_id: event.data.location.workspaceID ? Workspace.ID.make(event.data.location.workspaceID) : null,
            parent_id: event.data.parentID,
            slug: event.data.slug,
            directory: event.data.location.directory,
            path: event.data.subpath,
            title: event.data.title,
            agent: event.data.agent,
            model: event.data.model,
            version: event.data.version,
            time_created: event.created,
            time_updated: event.created,
          })
          .onConflictDoNothing()
          .returning({ sessionID: SessionTable.id })
          .get()
          .pipe(Effect.orDie)
        if (!stored) return yield* Effect.die(new SessionAlreadyProjected())
      }),
    )
    yield* bus.project(SessionEvent.Moved, (event) =>
      Effect.gen(function* () {
        yield* run(db, event)
        yield* db
          .update(SessionTable)
          .set({
            directory: event.data.location.directory,
            path: event.data.subpath,
            ...(event.data.projectID ? { project_id: event.data.projectID } : {}),
            workspace_id: event.data.location.workspaceID ? Workspace.ID.make(event.data.location.workspaceID) : null,
            time_updated: event.created,
          })
          .where(eq(SessionTable.id, event.data.sessionID))
          .run()
          .pipe(Effect.orDie)
      }),
    )
    // Sessions whose ownership came from the directory's previous resolution
    // follow its new identity. Location, transcript, instructions, and recency
    // are untouched: the session did not move, its directory got identified.
    yield* bus.project(Worktree.Event.Resolved, (event) =>
      Effect.gen(function* () {
        const stale = [event.data.previous, Project.ID.global].filter((id) => id !== event.data.projectID)
        if (stale.length === 0) return
        const rows = yield* db
          .select({ id: SessionTable.id, directory: SessionTable.directory })
          .from(SessionTable)
          .where(
            and(
              inArray(SessionTable.project_id, stale),
              // Lexicographic range narrows the scan to prefix neighbors without
              // LIKE escaping; FSUtil.contains below decides containment exactly.
              gte(SessionTable.directory, event.data.directory),
              lte(SessionTable.directory, AbsolutePath.make(event.data.directory + "\uffff")),
            ),
          )
          .all()
          .pipe(Effect.orDie)
        yield* Effect.forEach(
          rows,
          (row) => {
            if (!FSUtil.contains(event.data.directory, row.directory)) return Effect.void
            return db
              .update(SessionTable)
              .set({
                project_id: event.data.projectID,
                path: RelativePath.make(path.relative(event.data.directory, row.directory).replaceAll("\\", "/")),
                // Self-assignment suppresses the column's $onUpdate: adoption is not activity.
                time_updated: sql`${SessionTable.time_updated}`,
              })
              .where(eq(SessionTable.id, row.id))
              .run()
              .pipe(Effect.orDie)
          },
          { discard: true },
        )
      }),
    )
    yield* bus.project(SessionEvent.Deleted, (event) =>
      Effect.gen(function* () {
        const deleted = yield* db
          .delete(SessionTable)
          .where(eq(SessionTable.id, event.data.sessionID))
          .returning({ parentID: SessionTable.parent_id })
          .get()
          .pipe(Effect.orDie)
        const prefix = `session.background/${event.data.sessionID}/`
        yield* db
          .delete(KVTable)
          .where(and(gte(KVTable.key, prefix), lt(KVTable.key, `${prefix}\uffff`)))
          .run()
          .pipe(Effect.orDie)
        if (deleted?.parentID)
          yield* db
            .delete(KVTable)
            .where(eq(KVTable.key, backgroundKey(deleted.parentID, "subagent", event.data.sessionID)))
            .run()
            .pipe(Effect.orDie)
      }),
    )
    yield* bus.project(SessionEvent.AgentSelected, (event) =>
      Effect.gen(function* () {
        yield* run(db, event)
        yield* db
          .update(SessionTable)
          .set({ agent: event.data.agent, time_updated: event.created })
          .where(eq(SessionTable.id, event.data.sessionID))
          .run()
          .pipe(Effect.orDie)
      }),
    )
    yield* bus.project(SessionEvent.ModelSelected, (event) =>
      Effect.gen(function* () {
        yield* run(db, event)
        yield* db
          .update(SessionTable)
          .set({ model: event.data.model, time_updated: event.created })
          .where(eq(SessionTable.id, event.data.sessionID))
          .run()
          .pipe(Effect.orDie)
      }),
    )
    yield* bus.project(SessionEvent.Renamed, (event) =>
      db
        .update(SessionTable)
        .set({ title: event.data.title, time_updated: event.created })
        .where(eq(SessionTable.id, event.data.sessionID))
        .run()
        .pipe(Effect.orDie),
    )
    yield* bus.project(SessionEvent.Viewed, (event) => {
      const idle = event.data.idle
      return db
        .update(SessionTable)
        .set({
          // Monotone watermark: a duplicate or stale view never regresses, and a terminal event
          // committing after the viewer's observation keeps the newer idle transition unread.
          time_viewed: sql`max(${idle}, coalesce(${SessionTable.time_viewed}, ${idle}))`,
          time_updated: sql`${SessionTable.time_updated}`,
        })
        .where(eq(SessionTable.id, event.data.sessionID))
        .run()
        .pipe(Effect.orDie)
    })
    yield* bus.project(SessionEvent.UsageRecorded, (event) => applyUsage(db, event.data.sessionID, event.data))
    yield* bus.project(SessionEvent.Forked, (event) => projectFork(db, event))
    yield* bus.project(SessionEvent.InboxDelivered, (event) =>
      Effect.gen(function* () {
        const input = yield* SessionInbox.projectDelivered(db, {
          id: event.data.inboxID,
          sessionID: event.data.sessionID,
        })
        if (input.type === "compaction" || input.type === "move") return
        if (input.type === "synthetic") yield* settleBackground(db, event.data.sessionID, input.payload.metadata)
        yield* insertMessage(
          db,
          event,
          input.type === "user"
            ? {
                id: input.id,
                type: "user",
                metadata: input.payload.metadata,
                text: input.payload.text,
                files: input.payload.files,
                agents: input.payload.agents,
                skills: input.payload.skills,
                time: { created: DateTime.makeUnsafe(event.created) },
              }
            : {
                id: input.id,
                type: "synthetic",
                text: input.payload.text,
                description: input.payload.description,
                metadata: input.payload.metadata,
                time: { created: DateTime.makeUnsafe(event.created) },
              },
        )
      }),
    )
    yield* bus.project(SessionEvent.InboxEnqueued, (event) =>
      Effect.gen(function* () {
        yield* SessionInbox.projectAdmitted(db, {
          enqueuedSeq: event.durable.seq,
          id: event.data.inboxID,
          sessionID: event.data.sessionID,
          item: event.data.item,
          timeCreated: event.created,
        })
        yield* db
          .update(SessionTable)
          .set({ time_updated: event.created })
          .where(eq(SessionTable.id, event.data.sessionID))
          .run()
          .pipe(Effect.orDie)
      }),
    )
    yield* bus.project(SessionEvent.InboxCancelled, (event) =>
      SessionInbox.projectCancelled(db, {
        id: event.data.inboxID,
        sessionID: event.data.sessionID,
      }),
    )
    yield* bus.project(SessionEvent.InboxDeliveryChanged, (event) =>
      SessionInbox.projectDeliveryChanged(db, {
        id: event.data.inboxID,
        sessionID: event.data.sessionID,
        delivery: event.data.delivery,
      }),
    )
    yield* bus.project(SessionEvent.Execution.Succeeded, (event) => projectIdle(db, event))
    yield* bus.project(SessionEvent.Execution.Failed, (event) => projectIdle(db, event))
    yield* bus.project(SessionEvent.Execution.Interrupted, (event) => projectIdle(db, event))
    yield* bus.project(SessionEvent.InstructionsUpdated, (event) =>
      Effect.gen(function* () {
        yield* run(db, event)
        yield* InstructionState.apply(db, event.data.sessionID, event.durable.seq, event.data.delta)
      }),
    )
    yield* bus.project(SessionEvent.Synthetic, (event) =>
      run(db, event).pipe(Effect.andThen(settleBackground(db, event.data.sessionID, event.data.metadata))),
    )
    yield* bus.project(SessionEvent.Skill.Activated, (event) => run(db, event))
    yield* bus.project(SessionEvent.Shell.Started, (event) => run(db, event))
    yield* bus.project(SessionEvent.Shell.Ended, (event) => run(db, event))
    yield* bus.project(SessionEvent.Step.Started, (event) => run(db, event))
    yield* bus.project(SessionEvent.Step.Ended, (event) =>
      Effect.gen(function* () {
        yield* run(db, event)
        yield* applyUsage(db, event.data.sessionID, event.data)
      }),
    )
    yield* bus.project(SessionEvent.Step.Failed, (event) =>
      Effect.gen(function* () {
        yield* run(db, event)
        if (event.data.cost !== undefined && event.data.tokens !== undefined)
          yield* applyUsage(db, event.data.sessionID, { cost: event.data.cost, tokens: event.data.tokens })
      }),
    )
    yield* bus.project(SessionEvent.Text.Started, (event) => run(db, event))
    yield* bus.project(SessionEvent.Text.Ended, (event) => run(db, event))
    yield* bus.project(SessionEvent.Tool.Input.Started, (event) => run(db, event))
    yield* bus.project(SessionEvent.Tool.Input.Ended, (event) => run(db, event))
    yield* bus.project(SessionEvent.Tool.Called, (event) => run(db, event))
    yield* bus.project(SessionEvent.Tool.Success, (event) =>
      run(db, event).pipe(
        Effect.andThen(
          event.data.metadata?.status !== "running"
            ? Effect.void
            : projectBackground(db, {
                sessionID: event.data.sessionID,
                assistantMessageID: event.data.assistantMessageID,
                id: event.data.id,
                sequence: event.durable.seq,
                created: event.created,
              }),
        ),
      ),
    )
    yield* bus.project(SessionEvent.Tool.Failed, (event) => run(db, event))
    yield* bus.project(SessionEvent.Reasoning.Started, (event) => run(db, event))
    yield* bus.project(SessionEvent.Reasoning.Ended, (event) => run(db, event))
    yield* bus.project(SessionEvent.RetryScheduled, (event) => run(db, event))
    yield* bus.project(SessionEvent.Compaction.Started, (event) => run(db, event))
    yield* bus.project(SessionEvent.Compaction.Ended, (event) =>
      Effect.gen(function* () {
        yield* run(db, event)
        yield* InstructionState.advanceEpoch(db, event.data.sessionID, event.durable.seq)
      }),
    )
    yield* bus.project(SessionEvent.Compaction.Failed, (event) => run(db, event))
    yield* bus.project(SessionEvent.RevertEvent.Staged, (event) =>
      Effect.gen(function* () {
        const revert = event.data.revert
        yield* db
          .update(SessionTable)
          .set({
            revert: { ...revert, files: revert.files ? [...revert.files] : undefined },
            time_updated: event.created,
          })
          .where(eq(SessionTable.id, event.data.sessionID))
          .run()
          .pipe(Effect.orDie)
      }),
    )
    yield* bus.project(SessionEvent.RevertEvent.Cleared, (event) =>
      db
        .update(SessionTable)
        .set({ revert: null, time_updated: event.created })
        .where(eq(SessionTable.id, event.data.sessionID))
        .run()
        .pipe(Effect.orDie, Effect.asVoid),
    )
    yield* bus.project(SessionEvent.RevertEvent.Committed, (event) =>
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
        const settled = yield* db
          .all<{ type: string; id: string }>(
            sql`
            SELECT
              json_extract(${SessionMessageTable.data}, '$.metadata.source') AS type,
              CASE json_extract(${SessionMessageTable.data}, '$.metadata.source')
                WHEN 'shell' THEN json_extract(${SessionMessageTable.data}, '$.metadata.shellID')
                WHEN 'subagent' THEN json_extract(${SessionMessageTable.data}, '$.metadata.childID')
              END AS id
            FROM ${SessionMessageTable}
            WHERE ${SessionMessageTable.session_id} = ${event.data.sessionID}
              AND ${SessionMessageTable.type} = 'synthetic'
              AND ${SessionMessageTable.seq} >= ${boundary.seq}
              AND json_extract(${SessionMessageTable.data}, '$.metadata.source') IN ('shell', 'subagent')
              AND json_extract(${SessionMessageTable.data}, '$.metadata.state')
                IN ('completed', 'error', 'cancelled')
          `,
          )
          .pipe(Effect.orDie)
        const prefix = `session.background/${event.data.sessionID}/`
        yield* db
          .delete(KVTable)
          .where(
            and(
              gte(KVTable.key, prefix),
              lt(KVTable.key, `${prefix}\uffff`),
              sql`json_extract(${KVTable.value}, '$.sequence') >= ${boundary.seq}`,
            ),
          )
          .run()
          .pipe(Effect.orDie)
        yield* db
          .delete(SessionMessageTable)
          .where(
            and(eq(SessionMessageTable.session_id, event.data.sessionID), gte(SessionMessageTable.seq, boundary.seq)),
          )
          .run()
          .pipe(Effect.orDie)
        yield* db
          .delete(SessionInboxTable)
          .where(
            and(
              eq(SessionInboxTable.session_id, event.data.sessionID),
              gte(SessionInboxTable.enqueued_seq, boundary.seq),
            ),
          )
          .run()
          .pipe(Effect.orDie)
        yield* db
          .update(SessionTable)
          .set({ revert: null, time_updated: event.created })
          .where(eq(SessionTable.id, event.data.sessionID))
          .run()
          .pipe(Effect.orDie)
        yield* Effect.forEach(
          settled,
          (item) =>
            Effect.gen(function* () {
              if (typeof item.id !== "string") return
              const path = item.type === "shell" ? "$.state.metadata.shellID" : "$.state.metadata.sessionID"
              const launch = yield* db
                .get<{ assistantMessageID: string; id: string; sequence: number }>(
                  sql`
                  SELECT
                    message.id AS assistantMessageID,
                    message.seq AS sequence,
                    json_extract(part.value, '$.id') AS id
                  FROM ${SessionMessageTable} AS message,
                    json_each(message.data, '$.content') AS part
                  WHERE message.session_id = ${event.data.sessionID}
                    AND message.type = 'assistant'
                    AND json_extract(part.value, '$.type') = 'tool'
                    AND json_extract(part.value, '$.name') = ${item.type}
                    AND json_extract(part.value, '$.state.status') = 'completed'
                    AND json_extract(part.value, '$.state.metadata.status') = 'running'
                    AND json_extract(part.value, ${path}) = ${item.id}
                  ORDER BY message.seq DESC
                  LIMIT 1
                `,
                )
                .pipe(Effect.orDie)
              if (!launch) return
              yield* projectBackground(db, {
                sessionID: event.data.sessionID,
                assistantMessageID: SessionMessage.ID.make(launch.assistantMessageID),
                id: launch.id,
                sequence: launch.sequence,
                created: event.created,
              })
            }),
          { discard: true },
        )
        yield* InstructionState.reset(db, event.data.sessionID)
      }),
    )
    yield* bus.subscribe([SessionEvent.Step.Ended, SessionEvent.Step.Failed, SessionEvent.UsageRecorded]).pipe(
      Stream.runForEach((event) => {
        if (
          event.type === SessionEvent.Step.Failed.type &&
          (event.data.cost === undefined || event.data.tokens === undefined)
        )
          return Effect.void
        return publishSessionUsage(db, bus, event.data.sessionID)
      }),
      Effect.forkScoped({ startImmediately: true }),
    )
  }),
)

export const node = makeGlobalNode({ name: "session-projector", layer, deps: [Bus.node, Database.node] })
