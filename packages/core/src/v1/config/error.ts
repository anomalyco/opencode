export * as ConfigErrorV1 from "./error"

import { Schema } from "effect"
import { NamedError } from "../../util/error"

const Issue = Schema.StructWithRest(
  Schema.Struct({
    message: Schema.String,
    path: Schema.Array(Schema.String),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
)

export const JsonError = NamedError.create("ConfigJsonError", {
  path: Schema.String,
  message: Schema.optional(Schema.String),
})

export const InvalidError = NamedError.create("ConfigInvalidError", {
  path: Schema.String,
  issues: Schema.optional(Schema.Array(Issue)),
  message: Schema.optional(Schema.String),
})

export const FrontmatterError = NamedError.create("ConfigFrontmatterError", {
  path: Schema.String,
  message: Schema.String,
})

export const DirectoryTypoError = NamedError.create("ConfigDirectoryTypoError", {
  path: Schema.String,
  dir: Schema.String,
  suggestion: Schema.String,
})

// Raised when a remote config endpoint answers with an HTML login page instead of JSON. This
// happens when an identity-aware proxy (e.g. Cloudflare Access) intercepts an unauthenticated or
// expired request and serves its login interstitial with HTTP 200. `url` is the login origin to
// re-authenticate against (`opencode auth login <url>`); `remote` is the config endpoint that failed.
export const RemoteAuthError = NamedError.create("ConfigRemoteAuthError", {
  url: Schema.String,
  remote: Schema.String,
})
