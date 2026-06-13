import { SessionTable as SqliteSessionTable, MessageTable as SqliteMessageTable, PartTable as SqlitePartTable, TodoTable as SqliteTodoTable, SessionMessageTable as SqliteSessionMessageTable, SessionInputTable, SessionContextEpochTable } from "../session/sql"
import { ProjectTable as SqliteProjectTable, ProjectDirectoryTable as SqliteProjectDirectoryTable } from "../project/sql"
import { AccountTable as SqliteAccountTable, AccountStateTable as SqliteAccountStateTable, ControlAccountTable as SqliteControlAccountTable } from "../account/sql"
import { SessionShareTable as SqliteSessionShareTable } from "../share/sql"
import { EventSequenceTable as SqliteEventSequenceTable, EventTable as SqliteEventTable } from "../event/sql"
import { WorkspaceTable as SqliteWorkspaceTable } from "../control-plane/workspace.sql"
import { DataMigrationTable as SqliteDataMigrationTable } from "../data-migration.sql"
import { PermissionTable as SqlitePermissionTable } from "../permission/sql"

export const Tables = {
  SessionTable: SqliteSessionTable,
  MessageTable: SqliteMessageTable,
  PartTable: SqlitePartTable,
  TodoTable: SqliteTodoTable,
  SessionMessageTable: SqliteSessionMessageTable,
  SessionInputTable,
  SessionContextEpochTable,
  ProjectTable: SqliteProjectTable,
  ProjectDirectoryTable: SqliteProjectDirectoryTable,
  AccountTable: SqliteAccountTable,
  AccountStateTable: SqliteAccountStateTable,
  ControlAccountTable: SqliteControlAccountTable,
  SessionShareTable: SqliteSessionShareTable,
  EventSequenceTable: SqliteEventSequenceTable,
  EventTable: SqliteEventTable,
  WorkspaceTable: SqliteWorkspaceTable,
  DataMigrationTable: SqliteDataMigrationTable,
  PermissionTable: SqlitePermissionTable,
} as const

export type TableMap = typeof Tables
