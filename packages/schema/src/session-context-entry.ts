export * as SessionContextEntry from "./session-context-entry.js"

import { Schema } from "effect"

/**
 * Slash-free client-facing key for one API-managed context entry. The server
 * derives the namespaced SystemContext key as `api/<key>`, keeping the
 * `api/*` namespace enforced by construction.
 */
export const Key = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9._-]*$/)).annotate({
  identifier: "SessionContextEntry.Key",
  description: "Context entry key (lowercase alphanumerics plus . _ -)",
})
export type Key = typeof Key.Type

export const Info = Schema.Struct({
  key: Key,
  value: Schema.Json.annotate({ description: "JSON value attached to the session's system context" }),
}).annotate({ identifier: "SessionContextEntry.Info" })
export interface Info extends Schema.Schema.Type<typeof Info> {}
