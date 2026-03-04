import { and, Database, desc, eq, gte, inArray, isNull, like, lt, type SQL } from "@/storage/db"
import { MessageTable, PartTable, PermissionTable, SessionTable, TodoTable } from "./session.sql"
import type { SessionStore, SessionStoreTx } from "./store"

function tx(db: Database.TxOrDb): SessionStoreTx {
  return {
    session_insert(row) {
      db.insert(SessionTable).values(row).run()
    },
    session_get(id) {
      return db.select().from(SessionTable).where(eq(SessionTable.id, id)).get()
    },
    session_update(id, patch) {
      return db.update(SessionTable).set(patch).where(eq(SessionTable.id, id)).returning().get()
    },
    session_list(input) {
      const conditions: SQL[] = []
      if (input?.project_id) conditions.push(eq(SessionTable.project_id, input.project_id))
      if (input?.workspace_id) conditions.push(eq(SessionTable.workspace_id, input.workspace_id))
      if (input?.directory) conditions.push(eq(SessionTable.directory, input.directory))
      if (input?.roots) conditions.push(isNull(SessionTable.parent_id))
      if (input?.start) conditions.push(gte(SessionTable.time_updated, input.start))
      if (input?.cursor) conditions.push(lt(SessionTable.time_updated, input.cursor))
      if (input?.search) conditions.push(like(SessionTable.title, `%${input.search}%`))
      if (input?.archived === false) conditions.push(isNull(SessionTable.time_archived))

      const query =
        conditions.length > 0 ? db.select().from(SessionTable).where(and(...conditions)) : db.select().from(SessionTable)
      return query.orderBy(desc(SessionTable.time_updated), desc(SessionTable.id)).limit(input?.limit ?? 100).all()
    },
    session_children(project_id, parent_id) {
      return db
        .select()
        .from(SessionTable)
        .where(and(eq(SessionTable.project_id, project_id), eq(SessionTable.parent_id, parent_id)))
        .all()
    },
    session_delete(id) {
      db.delete(SessionTable).where(eq(SessionTable.id, id)).run()
    },
    message_upsert(row) {
      db.insert(MessageTable).values(row).onConflictDoUpdate({ target: MessageTable.id, set: { data: row.data } }).run()
    },
    message_get(id) {
      return db.select().from(MessageTable).where(eq(MessageTable.id, id)).get()
    },
    message_list(input) {
      const query = db.select().from(MessageTable).where(eq(MessageTable.session_id, input.session_id))
      return (input.desc ?? true)
        ? query.orderBy(desc(MessageTable.time_created)).limit(input.limit).offset(input.offset).all()
        : query.orderBy(MessageTable.time_created).limit(input.limit).offset(input.offset).all()
    },
    message_delete(session_id, id) {
      db.delete(MessageTable).where(and(eq(MessageTable.id, id), eq(MessageTable.session_id, session_id))).run()
    },
    part_upsert(row) {
      db.insert(PartTable).values(row).onConflictDoUpdate({ target: PartTable.id, set: { data: row.data } }).run()
    },
    part_list_by_message(message_id) {
      return db.select().from(PartTable).where(eq(PartTable.message_id, message_id)).orderBy(PartTable.id).all()
    },
    part_list_by_messages(message_ids) {
      if (message_ids.length === 0) return []
      return db.select().from(PartTable).where(inArray(PartTable.message_id, message_ids)).orderBy(PartTable.id).all()
    },
    part_delete(session_id, id) {
      db.delete(PartTable).where(and(eq(PartTable.id, id), eq(PartTable.session_id, session_id))).run()
    },
    todo_replace(session_id, rows) {
      db.delete(TodoTable).where(eq(TodoTable.session_id, session_id)).run()
      if (rows.length === 0) return
      db.insert(TodoTable).values(rows).run()
    },
    todo_list(session_id) {
      return db.select().from(TodoTable).where(eq(TodoTable.session_id, session_id)).all()
    },
    permission_get(project_id) {
      return db.select().from(PermissionTable).where(eq(PermissionTable.project_id, project_id)).get()
    },
    permission_upsert(row) {
      db.insert(PermissionTable)
        .values(row)
        .onConflictDoUpdate({ target: PermissionTable.project_id, set: { data: row.data } })
        .run()
    },
  }
}

export const SqliteSessionStore: SessionStore = {
  use(fn) {
    return Database.use((db) => fn(tx(db)))
  },
  transaction(fn) {
    return Database.transaction((db) => fn(tx(db)))
  },
  effect(fn) {
    return Database.effect(fn)
  },
}
