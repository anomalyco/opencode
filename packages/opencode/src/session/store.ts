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

export type SessionStoreEffect = () => unknown

export interface SessionStoreTx {
  session_insert(row: SessionInput): void
  session_get(id: string): SessionRow | undefined
  session_update(id: string, patch: SessionPatch): SessionRow | undefined
  session_list(input?: SessionListInput): SessionRow[]
  session_children(project_id: string, parent_id: string): SessionRow[]
  session_delete(id: string): void

  message_upsert(row: MessageInput): void
  message_get(id: string): MessageRow | undefined
  message_list(input: MessagePageInput): MessageRow[]
  message_delete(session_id: string, id: string): void

  part_upsert(row: PartInput): void
  part_list_by_message(message_id: string): PartRow[]
  part_list_by_messages(message_ids: string[]): PartRow[]
  part_delete(session_id: string, id: string): void

  todo_replace(session_id: string, rows: TodoInput[]): void
  todo_list(session_id: string): TodoRow[]

  permission_get(project_id: string): PermissionRow | undefined
  permission_upsert(row: PermissionInput): void
}

export interface SessionStore {
  use<T>(fn: (tx: SessionStoreTx) => T): T
  transaction<T>(fn: (tx: SessionStoreTx) => T): T
  effect(fn: SessionStoreEffect): void
}
