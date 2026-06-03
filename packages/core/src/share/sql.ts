import { sqliteTable, text } from "drizzle-orm/sqlite-core"
import { SessionTable } from "../session/sql"
import { Timestamps } from "../database/schema.sql"
import { DatabaseDialect } from "../database/dialect"
import { PgSessionShareTable } from "./sql.pg"

const _SqliteSessionShareTable = sqliteTable("session_share", {
  session_id: text()
    .primaryKey()
    .references(() => SessionTable.id, { onDelete: "cascade" }),
  id: text().notNull(),
  secret: text().notNull(),
  url: text().notNull(),
  ...Timestamps,
})

type SqliteSessionShareTable = typeof _SqliteSessionShareTable

export const SessionShareTable: SqliteSessionShareTable = DatabaseDialect.isPostgres() ? PgSessionShareTable as any : _SqliteSessionShareTable
