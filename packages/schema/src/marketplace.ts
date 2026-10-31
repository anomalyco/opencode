export * as Marketplace from "./marketplace.js"

import { Schema } from "effect"
import { ConfigAgent } from "./config/agent.js"

export const Name = Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/)).annotate({
  identifier: "Marketplace.Name",
})
export type Name = typeof Name.Type

export interface AgentItem extends Schema.Schema.Type<typeof AgentItem> {}
export const AgentItem = Schema.Struct({
  id: Name,
  name: Schema.NonEmptyString,
  kind: Schema.Literal("agent"),
  version: Schema.NonEmptyString,
  install: Schema.Struct({
    agents: Schema.Record(Name, ConfigAgent.Info).check(Schema.isMinProperties(1)),
  }),
}).annotate({ identifier: "Marketplace.AgentItem" })

export interface Catalog extends Schema.Schema.Type<typeof Catalog> {}
export const Catalog = Schema.Struct({
  schema: Schema.Literal("opencode.marketplace/experimental"),
  id: Name,
  name: Schema.NonEmptyString,
  items: Schema.Array(AgentItem).check(Schema.isMaxLength(128)),
})
  .check(
    Schema.makeFilter((catalog) => new Set(catalog.items.map((item) => item.id)).size === catalog.items.length, {
      message: "Catalog item IDs must be unique",
    }),
  )
  .annotate({ identifier: "Marketplace.Catalog" })
