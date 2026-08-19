export * as SessionRevert from "./revert"

import { and, asc, count, eq, gt, gte, or, sql } from "drizzle-orm"
import { DateTime, Effect, Schema } from "effect"
import { Database } from "../database/database"
import { EventV2 } from "../event"
import { RelativePath } from "../schema"
import { Snapshot } from "../snapshot"
import { SessionEvent } from "./event"
import { SessionMessage } from "./message"
import { SessionSchema } from "./schema"
import { SessionMessageTable } from "./sql"
import { Revert } from "@opencode-ai/schema/revert"

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

const PreviewItemLimit = 100
const EcmaScriptWhitespace =
  "\u0009\u000A\u000B\u000C\u000D\u0020\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF"

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

export const preview = Effect.fn("SessionRevert.preview")(function* (session: SessionSchema.Info) {
  if (!session.revert) return
  const db = (yield* Database.Service).db
  const boundary = yield* db
    .select({ seq: SessionMessageTable.seq })
    .from(SessionMessageTable)
    .where(and(eq(SessionMessageTable.session_id, session.id), eq(SessionMessageTable.id, session.revert.messageID)))
    .get()
    .pipe(Effect.orDie)
  if (!boundary) return yield* new MessageNotFoundError({ sessionID: session.id, messageID: session.revert.messageID })
  const visibleSynthetic = sql<boolean>`trim(coalesce(json_extract(${SessionMessageTable.data}, '$.text'), ''), ${EcmaScriptWhitespace}) <> ''`
  const root = or(
    eq(SessionMessageTable.type, "user"),
    eq(SessionMessageTable.type, "shell"),
    and(eq(SessionMessageTable.type, "synthetic"), visibleSynthetic),
  )!
  const where = and(eq(SessionMessageTable.session_id, session.id), root, gte(SessionMessageTable.seq, boundary.seq))
  const userCount =
    (yield* db.select({ value: count() }).from(SessionMessageTable).where(where).get().pipe(Effect.orDie))?.value ?? 0
  const rows = yield* db
    .select()
    .from(SessionMessageTable)
    .where(where)
    .orderBy(asc(SessionMessageTable.seq))
    .limit(PreviewItemLimit + 1)
    .all()
    .pipe(Effect.orDie)
  const decode = Schema.decodeUnknownEffect(SessionMessage.Message)
  const messages = yield* Effect.forEach(rows, (row) =>
    decode({ ...row.data, id: row.id, type: row.type }).pipe(Effect.orDie),
  )
  const preview = messages.flatMap((message): Revert.PreviewItem[] => {
    if (message.type === "synthetic") return [{ id: message.id, text: message.text.trim() }]
    if (message.type === "shell") return [{ id: message.id, text: message.command.trim() }]
    if (message.type !== "user") return []
    const text = message.text.trim()
    return [
      {
        id: message.id,
        text:
          text || (message.files ?? []).flatMap((file) => (file.name ? [`[attachment:${file.name}]`] : [])).join(" "),
      },
    ]
  })
  const items = preview.slice(0, PreviewItemLimit)
  const boundaryIndex = preview.findIndex((item) => item.id === session.revert?.messageID)
  return Revert.Preview.make({
    messageID: session.revert.messageID,
    userCount,
    hasMore: userCount > items.length,
    nextMessageID: preview[boundaryIndex === -1 ? 0 : boundaryIndex + 1]?.id,
    continuationMessageID: preview[PreviewItemLimit]?.id,
    items,
  })
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
    : yield* snapshot.capture()
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
    diff: files
      .map((file) => file.patch)
      .join("")
      .trim(),
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
