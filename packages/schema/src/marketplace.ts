export * as Marketplace from "./marketplace.js"

import { Schema } from "effect"
import { ConfigAgent } from "./config/agent.js"
import { AbsolutePath, NonNegativeInt } from "./schema.js"

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
  schema: Schema.Literal("opencode.marketplace/v1"),
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

export const Key = Schema.String.check(Schema.isPattern(/^pkg_[a-f0-9]{64}$/)).pipe(
  Schema.brand("Marketplace.Key"),
  Schema.annotate({ identifier: "Marketplace.Key" }),
)
export type Key = typeof Key.Type

export interface Installed extends Schema.Schema.Type<typeof Installed> {}
export const Installed = Schema.Struct({
  file: AbsolutePath,
  catalog: Name,
  item: Name,
  name: Schema.NonEmptyString,
  version: Schema.NonEmptyString,
  digest: Schema.String.check(Schema.isPattern(/^sha256:[a-f0-9]{64}$/)),
  agents: AgentItem.fields.install.fields.agents,
}).annotate({ identifier: "Marketplace.Installed" })

export interface State extends Schema.Schema.Type<typeof State> {}
export const State = Schema.Struct({
  revision: NonNegativeInt,
  installed: Schema.Record(Key, Installed),
}).annotate({ identifier: "Marketplace.State" })

export interface Plan extends Schema.Schema.Type<typeof Plan> {}
export const Plan = Schema.Struct({
  id: Schema.String,
  revision: NonNegativeInt,
  expires: NonNegativeInt,
  key: Key,
  installed: Installed,
}).annotate({ identifier: "Marketplace.Plan" })
