import type { SessionTable, MessageTable, PartTable, TodoTable, PermissionTable } from "./session.sql"

export type SessionRow = typeof SessionTable.$inferSelect
export type SessionInput = typeof SessionTable.$inferInsert
export type MessageRow = typeof MessageTable.$inferSelect
export type MessageInput = typeof MessageTable.$inferInsert
export type PartRow = typeof PartTable.$inferSelect
export type PartInput = typeof PartTable.$inferInsert
export type TodoRow = typeof TodoTable.$inferSelect
export type TodoInput = typeof TodoTable.$inferInsert
export type PermissionRow = typeof PermissionTable.$inferSelect
export type PermissionInput = typeof PermissionTable.$inferInsert
export type Asyncable<T> = T | Promise<T>

export type SessionPatch = Partial<
  Pick<
    SessionRow,
    | "title"
    | "share_url"
    | "summary_additions"
    | "summary_deletions"
    | "summary_files"
    | "summary_diffs"
    | "revert"
    | "permission"
    | "time_updated"
    | "time_archived"
    | "time_compacting"
  >
>

export type SessionListInput = {
  project_id?: string
  workspace_id?: string
  directory?: string
  roots?: boolean
  start?: number
  cursor?: number
  search?: string
  limit?: number
  archived?: boolean
}

export type MessagePageInput = {
  session_id: string
  limit: number
  offset: number
  desc?: boolean
}

export type SessionStoreEffect = () => Asyncable<unknown>

export interface SessionStoreTx {
  session_insert(row: SessionInput): Asyncable<void>
  session_get(id: string): Asyncable<SessionRow | undefined>
  session_update(id: string, patch: SessionPatch): Asyncable<SessionRow | undefined>
  session_list(input?: SessionListInput): Asyncable<SessionRow[]>
  session_children(project_id: string, parent_id: string): Asyncable<SessionRow[]>
  session_delete(id: string): Asyncable<void>

  message_upsert(row: MessageInput): Asyncable<void>
  message_get(id: string): Asyncable<MessageRow | undefined>
  message_list(input: MessagePageInput): Asyncable<MessageRow[]>
  message_delete(session_id: string, id: string): Asyncable<void>

  part_upsert(row: PartInput): Asyncable<void>
  part_list_by_message(message_id: string): Asyncable<PartRow[]>
  part_list_by_messages(message_ids: string[]): Asyncable<PartRow[]>
  part_delete(session_id: string, id: string): Asyncable<void>

  todo_replace(session_id: string, rows: TodoInput[]): Asyncable<void>
  todo_list(session_id: string): Asyncable<TodoRow[]>

  permission_get(project_id: string): Asyncable<PermissionRow | undefined>
  permission_upsert(row: PermissionInput): Asyncable<void>
}

export interface SessionStore {
  use<T>(fn: (tx: SessionStoreTx) => Asyncable<T>): Asyncable<T>
  transaction<T>(fn: (tx: SessionStoreTx) => Asyncable<T>): Asyncable<T>
  effect(fn: SessionStoreEffect): Asyncable<void>
}
