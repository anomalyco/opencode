export * as IntegrationConnection from "./connection"

import { Schema } from "effect"
import { Credential } from "../credential"

export const CredentialInfo = Schema.Struct({
  type: Schema.Literal("credential"),
  id: Credential.ID,
  label: Schema.String,
}).annotate({ identifier: "Connection.CredentialInfo" })
export type CredentialInfo = typeof CredentialInfo.Type

export const EnvInfo = Schema.Struct({
  type: Schema.Literal("env"),
  name: Schema.String,
}).annotate({ identifier: "Connection.EnvInfo" })
export type EnvInfo = typeof EnvInfo.Type

export const Info = Schema.Union([CredentialInfo, EnvInfo])
  .pipe(Schema.toTaggedUnion("type"))
  .annotate({ identifier: "Connection.Info" })
export type Info = typeof Info.Type
