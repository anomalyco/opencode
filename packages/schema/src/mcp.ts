export * as Mcp from "./mcp"

import { Schema } from "effect"
import { optional } from "./schema"
import { IntegrationID } from "./integration-id"

const Connected = Schema.Struct({ status: Schema.Literal("connected") }).annotate({
  identifier: "Mcp.Status.Connected",
})
const Disconnected = Schema.Struct({ status: Schema.Literal("disconnected") }).annotate({
  identifier: "Mcp.Status.Disconnected",
})
const Disabled = Schema.Struct({ status: Schema.Literal("disabled") }).annotate({
  identifier: "Mcp.Status.Disabled",
})
const Failed = Schema.Struct({ status: Schema.Literal("failed"), error: Schema.String }).annotate({
  identifier: "Mcp.Status.Failed",
})
const NeedsAuth = Schema.Struct({ status: Schema.Literal("needs_auth") }).annotate({
  identifier: "Mcp.Status.NeedsAuth",
})
const NeedsClientRegistration = Schema.Struct({
  status: Schema.Literal("needs_client_registration"),
  error: Schema.String,
}).annotate({ identifier: "Mcp.Status.NeedsClientRegistration" })

export type Status = typeof Status.Type
export const Status = Schema.Union([
  Connected,
  Disconnected,
  Disabled,
  Failed,
  NeedsAuth,
  NeedsClientRegistration,
]).pipe(Schema.toTaggedUnion("status"))

export interface Server extends Schema.Schema.Type<typeof Server> {}
export const Server = Schema.Struct({
  name: Schema.String,
  status: Status,
  // Set for remote servers registered as OAuth integrations; lets clients act on the right integration
  // without matching by name, which could collide with provider or plugin integrations.
  integrationID: optional(IntegrationID),
}).annotate({ identifier: "Mcp.Server" })
