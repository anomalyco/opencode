export * as SessionRevert from "./revert.js"

import { and, asc, eq, gt, gte, isNull } from "drizzle-orm"
import { DateTime, Effect, Option, Schema } from "effect"
import { Database } from "../database/database.js"
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

interface BoundaryInput {
  readonly session: SessionSchema.Info
  readonly messageID: SessionMessage.ID
}

export const stage = Effect.fn("SessionRevert.stage")(function* (input: {
  session: SessionSchema.Info
  messageID: SessionMessage.ID
  files?: boolean
}) {
  const instances = yield* Instance.Service
  const database = yield* Database.Service
  const bus = yield* Bus.Service

  return yield* Effect.gen(function* () {
    const snapshot = yield* Snapshot.Service
    const original = input.session.revert?.snapshot ?? (yield* snapshot.capture())
    const next = yield* plan(database.db, { session: input.session, messageID: input.messageID })
    const restore = new Map<RelativePath, Snapshot.ID>()
    if (original) {
      for (const file of input.session.revert?.files ?? []) restore.set(RelativePath.make(file.file), original)
    }
    if (input.files !== false) for (const [file, tree] of next) restore.set(file, tree)
    if (restore.size) yield* snapshot.restore({ files: restore })
    const paths = input.files === false ? [] : Array.from(next.keys())
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

const plan = Effect.fn("SessionRevert.plan")(function* (db: Database.Interface["db"], input: BoundaryInput) {
  const boundary = yield* db
    .select({ seq: SessionMessageTable.seq })
    .from(SessionMessageTable)
    .where(and(eq(SessionMessageTable.session_id, input.session.id), eq(SessionMessageTable.id, input.messageID)))
    .get()
    .pipe(Effect.orDie)
  if (!boundary) return yield* new MessageNotFoundError({ sessionID: input.session.id, messageID: input.messageID })
  const parentRows = yield* db
    .select()
    .from(SessionMessageTable)
    .where(
      and(
        eq(SessionMessageTable.session_id, input.session.id),
        eq(SessionMessageTable.type, "assistant"),
        gt(SessionMessageTable.seq, boundary.seq),
      ),
    )
    .orderBy(asc(SessionMessageTable.seq))
    .all()
    .pipe(Effect.orDie)
  // Background steps can finish after the parent snapshot; follow the calls being reverted.
  const rows = [...(yield* SessionHistory.withParts(db, parentRows))]
  const seen = new Set<SessionSchema.ID>([input.session.id])
  for (const row of rows) {
    const message = SessionHistory.decodeMessageRowSync(row)
    if (message.type !== "assistant") continue
    for (const tool of message.content) {
      if (tool.type !== "tool" || tool.name !== "subagent" || tool.state.status === "streaming") continue
      const childID = Schema.decodeUnknownOption(SessionSchema.ID)(tool.state.metadata?.sessionID)
      if (Option.isNone(childID) || seen.has(childID.value)) continue
      // A continued child must keep the work it did before this prompt.
      const promptID = Schema.decodeUnknownOption(SessionMessage.ID)(tool.state.metadata?.promptID)
      const after = Option.isSome(promptID)
        ? yield* db
            .select({ seq: SessionMessageTable.seq })
            .from(SessionMessageTable)
            .where(and(eq(SessionMessageTable.session_id, childID.value), eq(SessionMessageTable.id, promptID.value)))
            .get()
            .pipe(Effect.orDie)
        : undefined
      if (Option.isSome(promptID) && !after) continue
      const children = yield* db
        .select({ message: SessionMessageTable })
        .from(SessionMessageTable)
        .innerJoin(SessionTable, eq(SessionTable.id, SessionMessageTable.session_id))
        .where(
          and(
            eq(SessionTable.id, childID.value),
            eq(SessionTable.parent_id, row.session_id),
            eq(SessionTable.directory, input.session.location.directory),
            input.session.location.workspaceID === undefined
              ? isNull(SessionTable.workspace_id)
              : eq(SessionTable.workspace_id, input.session.location.workspaceID),
            eq(SessionMessageTable.type, "assistant"),
            after
              ? gt(SessionMessageTable.seq, after.seq)
              : gte(SessionMessageTable.time_created, DateTime.toEpochMillis(tool.time.ran ?? tool.time.created)),
          ),
        )
        .orderBy(asc(SessionMessageTable.seq))
        .all()
        .pipe(Effect.orDie)
      if (children.length === 0) continue
      seen.add(childID.value)
      rows.push(
        ...(yield* SessionHistory.withParts(
          db,
          children.map((child) => child.message),
        )),
      )
    }
  }
  const files = new Map<RelativePath, Snapshot.ID>()
  // The earliest snapshot for each path must win across parent and child steps.
  for (const row of rows.toSorted((a, b) => a.time_created - b.time_created || a.id.localeCompare(b.id))) {
    const message = SessionHistory.decodeMessageRowSync(row)
    if (message.type !== "assistant" || !message.snapshot?.start) continue
    for (const file of message.snapshot.files ?? []) if (!files.has(file)) files.set(file, message.snapshot.start)
  }
  return files
})
