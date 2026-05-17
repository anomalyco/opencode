import { Context, Schema } from "effect"

export * as Location from "./location"

export const Ref = Schema.Struct({
  directory: Schema.String,
  workspaceID: Schema.optional(Schema.String),
}).annotate({ identifier: "Location.Ref" })
export type Ref = typeof Ref.Type

export class Service extends Context.Service<Service, Ref>()("@opencode/Location") {}
