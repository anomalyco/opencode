export * as Connection from "./connection.js"

import { Schema } from "effect"
import { Credential } from "./credential.js"
import { optional } from "./schema.js"

/**
 * Runtime problem an integration reported for a connection. `needs_auth` asks the user to sign in again:
 * at `url` when set (the credential itself stays valid), otherwise by reconnecting the integration.
 * `restricted` means the server rejected the account or workspace itself, so signing in again cannot
 * help; `url` is where the user can check it.
 */
export interface Status extends Schema.Schema.Type<typeof Status> {}
export const Status = Schema.Struct({
  status: Schema.Literals(["needs_auth", "restricted"]),
  message: Schema.String,
  url: optional(Schema.String),
}).annotate({ identifier: "Connection.Status" })

export interface CredentialInfo extends Schema.Schema.Type<typeof CredentialInfo> {}
export const CredentialInfo = Schema.Struct({
  type: Schema.Literal("credential"),
  id: Credential.ID,
  label: Schema.String,
  /** Whether the connection stores a key, an OAuth grant, or an external credential-source reference. */
  method: Schema.Literals(["key", "oauth", "external"]),
  status: optional(Status),
}).annotate({ identifier: "Connection.CredentialInfo" })

export interface EnvInfo extends Schema.Schema.Type<typeof EnvInfo> {}
export const EnvInfo = Schema.Struct({
  type: Schema.Literal("env"),
  name: Schema.String,
  status: optional(Status),
}).annotate({ identifier: "Connection.EnvInfo" })

export const Info = Schema.Union([CredentialInfo, EnvInfo])
  .pipe(Schema.toTaggedUnion("type"))
  .annotate({ identifier: "Connection.Info" })
export type Info = typeof Info.Type
