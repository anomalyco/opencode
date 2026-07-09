export * as Agent from "./agent.js"

import { Schema } from "effect"
import { ephemeral, inventory } from "./event.js"
import { optional } from "./schema.js"
import { Model } from "./model.js"
import { Permission } from "./permission.js"
import { Provider } from "./provider.js"
import { PositiveInt, statics } from "./schema.js"

const Updated = ephemeral({ type: "agent.updated", schema: {} })

export const ID = Schema.String.pipe(Schema.brand("Agent.ID"))
export type ID = typeof ID.Type

export const Name = Schema.String.pipe(Schema.brand("Agent.Name"))
export type Name = typeof Name.Type

export const Color = Schema.Union([
  Schema.String.check(Schema.isPattern(/^#[0-9a-fA-F]{6}$/)),
  Schema.Literals(["primary", "secondary", "accent", "success", "warning", "error", "info"]),
]).annotate({ identifier: "Agent.Color" })
export type Color = typeof Color.Type

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  name: Name,
  model: Model.Ref.pipe(optional),
  request: Provider.Request,
  system: Schema.String.pipe(optional),
  description: Schema.String.pipe(optional),
  mode: Schema.Literals(["subagent", "primary", "all"]),
  hidden: Schema.Boolean,
  color: Color.pipe(optional),
  steps: PositiveInt.pipe(optional),
  permissions: Permission.Ruleset,
})
  .annotate({ identifier: "Agent.Info" })
  .pipe(
    statics((schema) => ({
      empty: (id: ID) =>
        schema.make({
          id,
          name: Name.make(id),
          request: { settings: {}, headers: {}, body: {} },
          mode: "all",
          hidden: false,
          permissions: [
            { action: "*", resource: "*", effect: "allow" },
            { action: "external_directory", resource: "*", effect: "ask" },
          ],
        }),
    })),
  )

export const Event = {
  Updated,
  Definitions: inventory(Updated),
}
