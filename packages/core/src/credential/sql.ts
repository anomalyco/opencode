import { integer, table, text, Timestamps } from "../database/dialect"
import type { IntegrationSchema } from "../integration/schema"
import type { Credential } from "../credential"

export const CredentialTable = table("credential", {
  id: text().$type<Credential.ID>().primaryKey(),
  integration_id: text().$type<IntegrationSchema.ID>(),
  label: text().notNull(),
  value: text({ mode: "json" }).$type<Credential.Info>().notNull(),
  connector_id: text(),
  method_id: text(),
  active: integer({ mode: "boolean" }),
  ...Timestamps,
})
