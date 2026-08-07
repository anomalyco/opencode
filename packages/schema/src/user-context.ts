export * as UserContext from "./user-context"

import { Context, Schema } from "effect"

export const Role = Schema.Literal("global_admin", "dept_admin", "user")
export type Role = typeof Role.Type

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  userID: Schema.String,
  username: Schema.String,
  departmentCode: Schema.String.pipe(Schema.optional),
  role: Role,
  permissions: Schema.Array(Schema.String),
}).annotate({ identifier: "UserContext.Info" })

export class Service extends Context.Service<Service, Info>()("@opencode/UserContext") {}