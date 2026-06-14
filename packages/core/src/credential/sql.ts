import { sql } from "drizzle-orm"
import { table, integer, text, uniqueIndex, Timestamps } from "../database/dialect"
import type { ConnectorSchema } from "../connector/schema"
import type { Credential } from "../credential"

export const CredentialTable = table(
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
