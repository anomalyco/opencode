export * as SessionRevert from "./revert.js"

import { and, asc, eq, gt, isNull, sql } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { Event } from "@opencode/schema/event"
import { Database } from "../database/database.js"
import { EventTable } from "../event/sql.js"
import { Bus } from "../bus.js"
import { Instance } from "../instance/service.js"
import { RelativePath } from "../schema.js"
import { Snapshot } from "../snapshot.js"
import { SessionEvent } from "./event.js"
import { MessageNotFoundError } from "./error.js"
import { SessionMessage } from "./message.js"
import { SessionSchema } from "./schema.js"
import { SessionHistory } from "./history.js"
import { SessionMessageTable, SessionTable } from "./sql.js"

interface StageInput {
  readonly files?: boolean
  readonly session: SessionSchema.Info
  readonly messageID: SessionMessage.ID
}

export const stage = Effect.fn("SessionRevert.stage")(function* (input: StageInput) {
  const instances = yield* Instance.Service
  const database = yield* Database.Service
  const bus = yield* Bus.Service

  return yield* Effect.gen(function* () {
    const snapshot = yield* Snapshot.Service
    const original = input.session.revert?.snapshot ?? (yield* snapshot.capture())
    const next = yield* plan(database.db, input, original)
    const restore = new Map<RelativePath, Snapshot.ID>()
    if (original) {
      for (const file of input.session.revert?.files ?? []) restore.set(RelativePath.make(file.file), original)
    }
    for (const [file, tree] of next) restore.set(file, tree)
    if (restore.size) yield* snapshot.restore({ files: restore })
    const paths = Array.from(next.keys())
    const files = original
      ? yield* snapshot.diff({ from: original, to: (yield* snapshot.capture()) ?? original, paths })
      : []
    const revert = {
      messageID: input.messageID,
      snapshot: original,
      files,
    } satisfies SessionSchema.Info["revert"]
    yield* bus.publish(SessionEvent.RevertEvent.Staged, {
      sessionID: input.session.id,
      revert,
    })
    return revert
  }).pipe(instances.provide(input.session))
})

export const clear = Effect.fn("SessionRevert.clear")(function* (session: SessionSchema.Info) {
  const instances = yield* Instance.Service
  const bus = yield* Bus.Service
  yield* Effect.gen(function* () {
    const snapshot = yield* Snapshot.Service
    if (!session.revert) return
    const original = session.revert.snapshot
    if (original)
      yield* snapshot.restore({
        files: new Map((session.revert.files ?? []).map((file) => [RelativePath.make(file.file), original])),
      })
    yield* bus.publish(SessionEvent.RevertEvent.Cleared, {
      sessionID: session.id,
    })
  }).pipe(instances.provide(session))
})

export const commit = Effect.fn("SessionRevert.commit")(function* (bus: Bus.Interface, session: SessionSchema.Info) {
  if (!session.revert) return
  yield* bus.publish(SessionEvent.RevertEvent.Committed, {
    sessionID: session.id,
    to: session.revert.messageID,
  })
})

const plan = Effect.fn("SessionRevert.plan")(function* (
  db: Database.Interface["db"],
  input: StageInput,
  original: Snapshot.ID | undefined,
) {
  const boundary = yield* db
    .select({ seq: SessionMessageTable.seq })
    .from(SessionMessageTable)
    .where(and(eq(SessionMessageTable.session_id, input.session.id), eq(SessionMessageTable.id, input.messageID)))
    .get()
    .pipe(Effect.orDie)
  if (!boundary) return yield* new MessageNotFoundError({ sessionID: input.session.id, messageID: input.messageID })
  if (input.files === false) return new Map<RelativePath, Snapshot.ID>()
  const steps: Step[] = []
  const pending = new Map<SessionSchema.ID, SessionMessage.AssistantTool[]>([[input.session.id, []]])
  for (const [sessionID, calls] of pending) {
    const child = sessionID !== input.session.id
    const ranges = child ? yield* delegatedRanges(db, sessionID, calls) : [{ after: boundary.seq, before: Infinity }]
    if (!ranges.length) continue
    const rows = yield* db
      .select()
      .from(SessionMessageTable)
      .where(
        and(
          eq(SessionMessageTable.session_id, sessionID),
          eq(SessionMessageTable.type, "assistant"),
          gt(SessionMessageTable.seq, ranges[0]!.after),
        ),
      )
      .orderBy(asc(SessionMessageTable.seq))
      .all()
      .pipe(Effect.orDie)
    const included = child ? rows.filter((row) => ranges.some((r) => row.seq > r.after && row.seq < r.before)) : rows
    const children = yield* db
      .select({ id: SessionTable.id })
      .from(SessionTable)
      .where(
        and(
          eq(SessionTable.parent_id, sessionID),
          eq(SessionTable.project_id, input.session.projectID),
          eq(SessionTable.directory, input.session.location.directory),
          input.session.location.workspaceID
            ? eq(SessionTable.workspace_id, input.session.location.workspaceID)
            : isNull(SessionTable.workspace_id),
        ),
      )
      .all()
      .pipe(Effect.orDie)
    const owned = new Set(children.map((item) => item.id))
    for (const row of owned.size ? yield* SessionHistory.withParts(db, included) : included) {
      const message = SessionHistory.decodeMessageRowSync(row)
      if (message.type !== "assistant") continue
      if (message.snapshot?.files?.length) steps.push({ message, child })
      if (!owned.size) continue
      for (const part of message.content) {
        if (part.type !== "tool" || part.name !== "subagent" || part.state.status === "streaming") continue
        const id = part.state.metadata?.sessionID
        if (!Schema.is(SessionSchema.ID)(id) || !owned.has(id)) continue
        const refs = pending.get(id)
        if (refs) refs.push(part)
        else pending.set(id, [part])
      }
    }
  }

  return yield* restoreFiles(steps, original)
})

const delegatedRanges = Effect.fnUntraced(function* (
  db: Database.Interface["db"],
  sessionID: SessionSchema.ID,
  calls: readonly SessionMessage.AssistantTool[],
) {
  const prompts = yield* db
    .select({ id: SessionMessageTable.id, seq: SessionMessageTable.seq })
    .from(SessionMessageTable)
    .where(and(eq(SessionMessageTable.session_id, sessionID), eq(SessionMessageTable.type, "user")))
    .orderBy(asc(SessionMessageTable.seq))
    .all()
    .pipe(Effect.orDie)
  const selected = new Set<SessionMessage.ID>()
  for (const call of calls) {
    if (call.state.status === "streaming") continue
    const id = call.state.metadata?.promptMessageID
    if (Schema.is(SessionMessage.ID)(id)) {
      selected.add(id)
      continue
    }
    // Older calls stored only the child ID. A launch created its first prompt. For a
    // follow-up, require a unique matching admission during that specific tool call.
    if (!call.state.input.sessionID) {
      if (prompts[0]) selected.add(prompts[0].id)
      continue
    }
    const text = call.state.input.prompt
    const started = (call.time.ran ?? call.time.created).epochMilliseconds
    const completed = call.time.completed?.epochMilliseconds
    if (completed === undefined || typeof text !== "string") continue
    const event = SessionEvent.InboxEnqueued
    const lookup = sql`
      SELECT id FROM ${SessionMessageTable}
      WHERE session_id = ${sessionID} AND type = 'user' AND json_extract(data, '$.text') = ${text}
        AND (time_created BETWEEN ${started} AND ${completed} OR id IN (
          SELECT json_extract(data, '$.inboxID') FROM ${EventTable}
          WHERE aggregate_id = ${sessionID} AND type = ${Event.versionedType(event.type, event.durable.version)}
            AND created BETWEEN ${started} AND ${completed}
        ))
      LIMIT 2
    `
    const matches = yield* db.all<{ id: SessionMessage.ID }>(lookup).pipe(Effect.orDie)
    if (matches.length === 1) selected.add(matches[0]!.id)
  }
  return prompts.flatMap((prompt, i) =>
    selected.has(prompt.id) ? [{ after: prompt.seq, before: prompts[i + 1]?.seq ?? Infinity }] : [],
  )
})

type Step = { message: SessionMessage.Assistant; child: boolean }

const restoreFiles = Effect.fnUntraced(function* (steps: Step[], original: Snapshot.ID | undefined) {
  const files = new Map<RelativePath, Snapshot.ID>()
  const last = new Map<RelativePath, { time: number; tree: Snapshot.ID; child: boolean }>()
  const snapshots = yield* Snapshot.Service
  const comparisons = new Map<string, Set<RelativePath>>()
  const changed = Effect.fnUntraced(function* (from: Snapshot.ID, to: Snapshot.ID, file: RelativePath) {
    if (from === to) return false
    const key = from + ":" + to
    const cached = comparisons.get(key)
    if (cached) return cached.has(file)
    const paths = new Set(yield* snapshots.files({ from, to }))
    comparisons.set(key, paths)
    return paths.has(file)
  })

  if (steps.some((step) => step.child))
    steps.sort((a, b) => a.message.time.created.epochMilliseconds - b.message.time.created.epochMilliseconds)
  for (const { message, child } of steps) {
    const tree = message.snapshot
    if (!tree?.start) continue
    const start = message.time.created.epochMilliseconds
    const end = (message.time.completed ?? message.time.created).epochMilliseconds
    for (const file of tree.files ?? []) {
      const previous = last.get(file)
      // If someone edited the path between two delegated steps, only undo back to that edit.
      if (
        !files.has(file) ||
        (previous &&
          (previous.child || child) &&
          previous.time <= start &&
          (yield* changed(previous.tree, tree.start, file)))
      )
        files.set(file, tree.start)
      if (tree.end && (!previous || previous.time <= end)) last.set(file, { time: end, tree: tree.end, child })
    }
  }
  // The last child edit may itself have been superseded before revert was requested.
  if (original)
    for (const [file, end] of last) {
      if (end.child && (yield* changed(end.tree, original, file))) files.delete(file)
    }
  return files
})
