import { sql } from "drizzle-orm"
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import { Timestamps } from "../database/schema.sql"
import type { ConnectorSchema } from "../connector/schema"
import type { Credential } from "../credential"

export const CredentialTable = sqliteTable(
  "credential",
  {
    id: text().$type<Credential.ID>().primaryKey(),
    connector_id: text().$type<ConnectorSchema.ID>().notNull(),
    method_id: text().$type<ConnectorSchema.MethodID>().notNull(),
    label: text().notNull(),
    value: text({ mode: "json" }).$type<Credential.Value>().notNull(),
    active: integer({ mode: "boolean" }).notNull().default(false),
    ...Timestamps,
  },
  (table) => [
    uniqueIndex("credential_connector_active_idx")
      .on(table.connector_id)
      .where(sql`${table.active} = 1`),
  ],
)
