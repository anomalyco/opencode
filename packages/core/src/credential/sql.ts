import { sqliteTable, text } from "drizzle-orm/sqlite-core"
import { Timestamps } from "../database/schema.sql"
import type { IntegrationSchema } from "../integration/schema"
import type { Credential } from "../credential"

export const CredentialTable = sqliteTable("credential", {
  id: text().$type<Credential.ID>().primaryKey(),
  integration_id: text().$type<IntegrationSchema.ID>().notNull(),
  label: text().notNull(),
  value: text({ mode: "json" }).$type<Credential.Info>().notNull(),
  ...Timestamps,
})
