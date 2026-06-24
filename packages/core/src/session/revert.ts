export * as SessionRevert from "./revert"

import { and, asc, eq, gt } from "drizzle-orm"
import { DateTime, Effect, Schema } from "effect"
import { Database } from "../database/database"
import { EventV2 } from "../event"
import { RelativePath } from "../schema"
import { Snapshot } from "../snapshot"
import { SessionEvent } from "./event"
import { SessionMessage } from "./message"
import { SessionSchema } from "./schema"
import { SessionMessageTable } from "./sql"

export class MessageNotFoundError extends Schema.TaggedErrorClass<MessageNotFoundError>()(
  "Session.MessageNotFoundError",
  {
    sessionID: SessionSchema.ID,
    messageID: SessionMessage.ID,
  },
) {}

interface BoundaryInput {
  readonly sessionID: SessionSchema.ID
  readonly messageID: SessionMessage.ID
}

const plan = Effect.fn("SessionRevert.plan")(function* (input: BoundaryInput) {
  const db = (yield* Database.Service).db
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
  const decode = Schema.decodeUnknownEffect(SessionMessage.Message)
  const files = new Map<RelativePath, Snapshot.ID>()
  for (const row of rows) {
    const message = yield* decode({ ...row.data, id: row.id, type: row.type }).pipe(Effect.orDie)
    if (message.type !== "assistant" || !message.snapshot?.start) continue
    for (const file of message.snapshot.files ?? [])
      if (!files.has(file)) files.set(file, Snapshot.ID.make(message.snapshot.start))
  }
  return files
})

export const stage = Effect.fn("SessionRevert.stage")(function* (input: {
  readonly session: SessionSchema.Info
  readonly messageID: SessionMessage.ID
  readonly files?: boolean
}) {
  const snapshot = yield* Snapshot.Service
  const events = yield* EventV2.Service
  const original = input.session.revert?.snapshot
    ? Snapshot.ID.make(input.session.revert.snapshot)
    : (yield* snapshot.capture())
  const next = yield* plan({ sessionID: input.session.id, messageID: input.messageID })
  const restore = new Map<RelativePath, Snapshot.ID>()
  if (original) {
    for (const file of input.session.revert?.files ?? []) restore.set(file.path, original)
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
    diff: files.map((file) => file.patch).join("").trim(),
    files,
  } satisfies SessionSchema.Info["revert"]
  yield* events.publish(SessionEvent.RevertEvent.Staged, {
    sessionID: input.session.id,
    timestamp: yield* DateTime.now,
    revert,
  })
  return revert
})

export const clear = Effect.fn("SessionRevert.clear")(function* (session: SessionSchema.Info) {
  if (!session.revert) return
  const snapshot = yield* Snapshot.Service
  const original = session.revert.snapshot ? Snapshot.ID.make(session.revert.snapshot) : undefined
  if (original)
    yield* snapshot.restore({
      files: new Map((session.revert.files ?? []).map((file) => [file.path, original])),
    })
  const events = yield* EventV2.Service
  yield* events.publish(SessionEvent.RevertEvent.Cleared, {
    sessionID: session.id,
    timestamp: yield* DateTime.now,
  })
})

export const commit = Effect.fn("SessionRevert.commit")(function* (session: SessionSchema.Info) {
  if (!session.revert) return
  const events = yield* EventV2.Service
  yield* events.publish(SessionEvent.RevertEvent.Committed, {
    sessionID: session.id,
    messageID: session.revert.messageID,
    timestamp: yield* DateTime.now,
  })
})
