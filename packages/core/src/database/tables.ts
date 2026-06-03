import { DatabaseDialect } from "./dialect"

import { SessionTable as SqliteSessionTable, MessageTable as SqliteMessageTable, PartTable as SqlitePartTable, TodoTable as SqliteTodoTable, SessionMessageTable as SqliteSessionMessageTable } from "../session/sql"
import { ProjectTable as SqliteProjectTable, ProjectDirectoryTable as SqliteProjectDirectoryTable } from "../project/sql"
import { AccountTable as SqliteAccountTable, AccountStateTable as SqliteAccountStateTable, ControlAccountTable as SqliteControlAccountTable } from "../account/sql"
import { SessionShareTable as SqliteSessionShareTable } from "../share/sql"
import { EventSequenceTable as SqliteEventSequenceTable, EventTable as SqliteEventTable } from "../event/sql"
import { WorkspaceTable as SqliteWorkspaceTable } from "../control-plane/workspace.sql"
import { DataMigrationTable as SqliteDataMigrationTable } from "../data-migration.sql"
import { PermissionTable as SqlitePermissionTable } from "../permission/sql"

import { PgSessionTable, PgMessageTable, PgPartTable, PgTodoTable, PgSessionMessageTable } from "../session/sql.pg"
import { PgProjectTable, PgProjectDirectoryTable } from "../project/sql.pg"
import { PgAccountTable, PgAccountStateTable, PgControlAccountTable } from "../account/sql.pg"
import { PgSessionShareTable } from "../share/sql.pg"
import { PgEventSequenceTable, PgEventTable } from "../event/sql.pg"
import { PgWorkspaceTable } from "../control-plane/workspace.sql.pg"
import { PgDataMigrationTable } from "../data-migration.sql.pg"
import { PgPermissionTable } from "../permission/sql.pg"

const sqlite = {
  SessionTable: SqliteSessionTable,
  MessageTable: SqliteMessageTable,
  PartTable: SqlitePartTable,
  TodoTable: SqliteTodoTable,
  SessionMessageTable: SqliteSessionMessageTable,
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

const pg = {
  SessionTable: PgSessionTable,
  MessageTable: PgMessageTable,
  PartTable: PgPartTable,
  TodoTable: PgTodoTable,
  SessionMessageTable: PgSessionMessageTable,
  ProjectTable: PgProjectTable,
  ProjectDirectoryTable: PgProjectDirectoryTable,
  AccountTable: PgAccountTable,
  AccountStateTable: PgAccountStateTable,
  ControlAccountTable: PgControlAccountTable,
  SessionShareTable: PgSessionShareTable,
  EventSequenceTable: PgEventSequenceTable,
  EventTable: PgEventTable,
  WorkspaceTable: PgWorkspaceTable,
  DataMigrationTable: PgDataMigrationTable,
  PermissionTable: PgPermissionTable,
} as const

export const Tables = DatabaseDialect.isPostgres() ? pg : sqlite

export type TableMap = typeof sqlite
