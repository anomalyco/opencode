import { eq, and } from "../storage/db"
import { SyncEvent } from "@/sync"
import { Session } from "./index"
import { MessageV2 } from "./message-v2"
import { SessionTable, MessageTable, PartTable, TodoTable } from "./session.sql"
import { SessionShareTable } from "../share/share.sql"
import { Log } from "../util/log"

const log = Log.create({ service: "session.projector" })

function foreign(err: unknown) {
  if (typeof err !== "object" || err === null) return false
  if ("code" in err && err.code === "SQLITE_CONSTRAINT_FOREIGNKEY") return true
  return "message" in err && typeof err.message === "string" && err.message.includes("FOREIGN KEY constraint failed")
}

export type DeepPartial<T> = T extends object ? { [K in keyof T]?: DeepPartial<T[K]> | null } : T

function grab<T extends object, K1 extends keyof T, X>(
  obj: T,
  field1: K1,
  cb?: (val: NonNullable<T[K1]>) => X,
): X | undefined {
  if (obj == undefined || !(field1 in obj)) return undefined

  const val = obj[field1]
  if (val && typeof val === "object" && cb) {
    return cb(val)
  }
  if (val === undefined) {
    throw new Error(
      "Session update failure: pass `null` to clear a field instead of `undefined`: " + JSON.stringify(obj),
    )
  }
  return val as X | undefined
}

export function toPartialRow(info: DeepPartial<Session.Info>) {
  const obj = {
    id: grab(info, "id"),
    project_id: grab(info, "projectID"),
    workspace_id: grab(info, "workspaceID"),
    parent_id: grab(info, "parentID"),
    slug: grab(info, "slug"),
    directory: grab(info, "directory"),
    title: grab(info, "title"),
    version: grab(info, "version"),
    share_url: grab(info, "share", (v) => grab(v, "url")),
    summary_additions: grab(info, "summary", (v) => grab(v, "additions")),
    summary_deletions: grab(info, "summary", (v) => grab(v, "deletions")),
    summary_files: grab(info, "summary", (v) => grab(v, "files")),
    summary_diffs: grab(info, "summary", (v) => grab(v, "diffs")),
    revert: grab(info, "revert"),
    permission: grab(info, "permission"),
    time_created: grab(info, "time", (v) => grab(v, "created")),
    time_updated: grab(info, "time", (v) => grab(v, "updated")),
    time_compacting: grab(info, "time", (v) => grab(v, "compacting")),
    time_archived: grab(info, "time", (v) => grab(v, "archived")),
  }

  return Object.fromEntries(Object.entries(obj).filter(([_, val]) => val !== undefined))
}

export default [
  SyncEvent.project(Session.Event.Created, (db, data) => {
    db.insert(SessionTable).values(Session.toRow(data.info)).run()
  }),

  SyncEvent.project(Session.Event.Updated, (db, data) => {
    const info = data.info
    // NOTE: previously this used .returning().get() to assert the row existed,
    // but that pattern is broken on async dialects (PG/MySQL) because the
    // projector callback is sync — the returned Promise is never awaited and
    // the existence check silently passes. We now just run the update; if the
    // row doesn't exist the update is a no-op, matching the dialect-agnostic
    // behavior we already had on PG.
    db.update(SessionTable)
      .set(toPartialRow(info))
      .where(eq(SessionTable.id, data.sessionID))
      .run()
  }),

  SyncEvent.project(Session.Event.Deleted, (db, data) => {
    // Explicit cascade. Some managed MySQL services forbid FOREIGN KEY
    // constraints (no online DDL support), so we cannot rely on the DB to
    // remove children. Order matters: delete grandchildren (parts) first,
    // then children (messages, todos, share), then the session row itself.
    // This is a no-op on dialects where FK CASCADE would have done it
    // already, since the children are gone by the time the parent delete
    // runs in the same statement-by-statement order.
    db.delete(PartTable).where(eq(PartTable.session_id, data.sessionID)).run()
    db.delete(MessageTable).where(eq(MessageTable.session_id, data.sessionID)).run()
    db.delete(TodoTable).where(eq(TodoTable.session_id, data.sessionID)).run()
    db.delete(SessionShareTable).where(eq(SessionShareTable.session_id, data.sessionID)).run()
    db.delete(SessionTable).where(eq(SessionTable.id, data.sessionID)).run()
  }),

  SyncEvent.project(MessageV2.Event.Updated, (db, data) => {
    const time_created = data.info.time.created
    const { id, sessionID, ...rest } = data.info

    try {
      db.insert(MessageTable)
        .values({
          id,
          session_id: sessionID,
          time_created,
          data: rest,
        })
        .onConflictDoUpdate({ target: MessageTable.id, set: { data: rest } })
        .run()
    } catch (err) {
      if (!foreign(err)) throw err
      log.warn("ignored late message update", { messageID: id, sessionID })
    }
  }),

  SyncEvent.project(MessageV2.Event.Removed, (db, data) => {
    // Explicit cascade — see Session.Event.Deleted projector for rationale.
    db.delete(PartTable).where(eq(PartTable.message_id, data.messageID)).run()
    db.delete(MessageTable)
      .where(and(eq(MessageTable.id, data.messageID), eq(MessageTable.session_id, data.sessionID)))
      .run()
  }),

  SyncEvent.project(MessageV2.Event.PartRemoved, (db, data) => {
    db.delete(PartTable)
      .where(and(eq(PartTable.id, data.partID), eq(PartTable.session_id, data.sessionID)))
      .run()
  }),

  SyncEvent.project(MessageV2.Event.PartUpdated, (db, data) => {
    const { id, messageID, sessionID, ...rest } = data.part

    try {
      db.insert(PartTable)
        .values({
          id,
          message_id: messageID,
          session_id: sessionID,
          time_created: data.time,
          data: rest,
        })
        .onConflictDoUpdate({ target: PartTable.id, set: { data: rest } })
        .run()
    } catch (err) {
      if (!foreign(err)) throw err
      log.warn("ignored late part update", { partID: id, messageID, sessionID })
    }
  }),
]
