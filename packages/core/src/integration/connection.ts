export * as IntegrationConnection from "./connection"

import { Schema } from "effect"
import { Credential } from "../credential"

export class CredentialInfo extends Schema.Class<CredentialInfo>("Connection.CredentialInfo")({
  type: Schema.Literal("credential"),
  id: Credential.ID,
  label: Schema.String,
}) {}

export class EnvInfo extends Schema.Class<EnvInfo>("Connection.EnvInfo")({
  type: Schema.Literal("env"),
  name: Schema.String,
}) {}

export const Info = Schema.Union([CredentialInfo, EnvInfo])
  .pipe(Schema.toTaggedUnion("type"))
  .annotate({ identifier: "Connection.Info" })
export type Info = typeof Info.Type
