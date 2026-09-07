export * as SessionRevert from "./revert.js"

import { and, asc, eq, gt } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { Database } from "../database/database.js"
import { Bus } from "../bus.js"
import { Instance } from "../instance/service.js"
import { RelativePath } from "../schema.js"
import { Snapshot } from "../snapshot.js"
import { SessionEvent } from "./event.js"
import { MessageNotFoundError } from "./error.js"
import { SessionMessage } from "./message.js"
import { SessionSchema } from "./schema.js"
import { SessionMessageTable, SessionTable } from "./sql.js"
import type { SessionStore } from "./store.js"

export { MessageNotFoundError }

interface BoundaryInput {
  readonly sessionID: SessionSchema.ID
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
  const next = yield* plan(database.db, { sessionID: input.session.id, messageID: input.messageID })
  const pending = yield* loadPending(database.db, input.session.id)
  return yield* Effect.gen(function* () {
    const snapshot = yield* Snapshot.Service
    const recorded = pending?.snapshot ?? input.session.revert?.snapshot
    const original = recorded ?? (yield* snapshot.capture())
    const previous = new Set(
      pending?.paths ?? (input.session.revert?.files ?? []).map((file) => RelativePath.make(file.file)),
    )
    const restore = new Map<RelativePath, Snapshot.ID>()
    if (original) for (const file of previous) restore.set(file, original)
    if (input.files !== false) for (const [file, tree] of next) restore.set(file, tree)
    if (restore.size && !original)
      return yield* new Snapshot.Error({
        operation: "capture",
        message: "Cannot restore files without an original snapshot",
      })
    const added = Array.from(restore.keys()).filter((file) => !previous.has(file))
    if (restore.size && (!recorded || added.length))
      yield* bus.publish(SessionEvent.RevertEvent.Prepared, {
        sessionID: input.session.id,
        snapshot: recorded ? undefined : original,
        paths: added,
      })
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
  const database = yield* Database.Service
  const bus = yield* Bus.Service
  const pending = yield* loadPending(database.db, session.id)
  if (!session.revert && !pending) return
  yield* Effect.gen(function* () {
    const snapshot = yield* Snapshot.Service
    const original = pending?.snapshot ?? session.revert?.snapshot
    if (original)
      yield* snapshot.restore({
        files: new Map(
          (pending?.paths ?? (session.revert?.files ?? []).map((file) => RelativePath.make(file.file))).map(
            (file) => [file, original] as const,
          ),
        ),
      })
    yield* bus.publish(SessionEvent.RevertEvent.Cleared, {
      sessionID: session.id,
    })
  }).pipe(instances.provide(session))
})

export const commit = Effect.fn("SessionRevert.commit")(function* (
  bus: Bus.Interface,
  store: SessionStore.Interface,
  session: SessionSchema.Info,
) {
  if (session.revert) {
    yield* bus.publish(SessionEvent.RevertEvent.Committed, {
      sessionID: session.id,
      to: session.revert.messageID,
    })
    return
  }
  if (!(yield* store.hasPendingRevert(session.id))) return
  // Failed preparation has no boundary to commit. Accept the current files without
  // deleting history, and retire protection before new work can change those files.
  yield* bus.publish(SessionEvent.RevertEvent.Cleared, { sessionID: session.id })
})

function loadPending(db: Database.Interface["db"], sessionID: SessionSchema.ID) {
  return db
    .select({ pending: SessionTable.revert_pending })
    .from(SessionTable)
    .where(eq(SessionTable.id, sessionID))
    .get()
    .pipe(
      Effect.orDie,
      Effect.map((row) => row?.pending),
    )
}

const plan = Effect.fn("SessionRevert.plan")(function* (db: Database.Interface["db"], input: BoundaryInput) {
  const boundary = yield* db
    .select({ seq: SessionMessageTable.seq })
    .from(SessionMessageTable)
    .where(and(eq(SessionMessageTable.session_id, input.sessionID), eq(SessionMessageTable.id, input.messageID)))
    .get()
    .pipe(Effect.orDie)
  if (!boundary) return yield* new MessageNotFoundError(input)
  const rows = yield* db
    .select()
    .from(SessionMessageTable)
    .where(
      and(
        eq(SessionMessageTable.session_id, input.sessionID),
        eq(SessionMessageTable.type, "assistant"),
        gt(SessionMessageTable.seq, boundary.seq),
      ),
    )
    .orderBy(asc(SessionMessageTable.seq))
    .all()
    .pipe(Effect.orDie)
  const decode = Schema.decodeUnknownEffect(SessionMessage.Info)
  const files = new Map<RelativePath, Snapshot.ID>()
  for (const row of rows) {
    const message = yield* decode({ ...row.data, id: row.id, type: row.type }).pipe(Effect.orDie)
    if (message.type !== "assistant" || !message.snapshot?.start) continue
    for (const file of message.snapshot.files ?? [])
      if (!files.has(file)) files.set(file, Snapshot.ID.make(message.snapshot.start))
  }
  return files
})
