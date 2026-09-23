export * as SessionProviderContext from "./session-provider-context.js"

import { Schema } from "effect"
import { Provider } from "./provider.js"

/** Exact producing model/deployment and route identity, never credentials or a connection ID. */
export interface Provenance extends Schema.Schema.Type<typeof Provenance> {}
export const Provenance = Schema.Struct({
  providerID: Provider.ID,
  provider: Schema.String,
  modelID: Schema.String,
  route: Schema.String,
  protocol: Schema.String,
  /** Digest of the configured endpoint; raw URLs and query values are not persisted. */
  endpoint: Schema.String,
}).annotate({ identifier: "Session.ProviderContext.Provenance" })

/** Core validates the versioned canonical AI Message[] payload on installation and replay. */
export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  version: Schema.Literal(1),
  provenance: Provenance,
  messages: Schema.Json,
}).annotate({ identifier: "Session.ProviderContext" })
