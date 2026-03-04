import type { SessionTable, MessageTable, PartTable, TodoTable, PermissionTable } from "./session.sql"

export type SessionRow = typeof SessionTable.$inferSelect
export type MessageRow = typeof MessageTable.$inferSelect
export type PartRow = typeof PartTable.$inferSelect
export type TodoRow = typeof TodoTable.$inferSelect
export type PermissionRow = typeof PermissionTable.$inferSelect

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

export type SessionStoreEffect = () => void | Promise<void>
export type SessionStoreValue<T> = T | Promise<T>

export interface SessionStoreTx {
  session_insert(row: SessionRow): SessionStoreValue<void>
  session_get(id: string): SessionStoreValue<SessionRow | undefined>
  session_update(id: string, patch: SessionPatch): SessionStoreValue<SessionRow | undefined>
  session_list(input?: SessionListInput): SessionStoreValue<SessionRow[]>
  session_children(project_id: string, parent_id: string): SessionStoreValue<SessionRow[]>
  session_delete(id: string): SessionStoreValue<void>

  message_upsert(row: MessageRow): SessionStoreValue<void>
  message_get(id: string): SessionStoreValue<MessageRow | undefined>
  message_list(input: MessagePageInput): SessionStoreValue<MessageRow[]>
  message_delete(session_id: string, id: string): SessionStoreValue<void>

  part_upsert(row: PartRow): SessionStoreValue<void>
  part_list_by_message(message_id: string): SessionStoreValue<PartRow[]>
  part_list_by_messages(message_ids: string[]): SessionStoreValue<PartRow[]>
  part_delete(session_id: string, id: string): SessionStoreValue<void>

  todo_replace(session_id: string, rows: TodoRow[]): SessionStoreValue<void>
  todo_list(session_id: string): SessionStoreValue<TodoRow[]>

  permission_get(project_id: string): SessionStoreValue<PermissionRow | undefined>
  permission_upsert(row: PermissionRow): SessionStoreValue<void>
}

export interface SessionStore {
  use<T>(fn: (tx: SessionStoreTx) => SessionStoreValue<T>): SessionStoreValue<T>
  transaction<T>(fn: (tx: SessionStoreTx) => SessionStoreValue<T>): SessionStoreValue<T>
  effect(fn: SessionStoreEffect): SessionStoreValue<void>
}
