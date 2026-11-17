export * as CredentialLegacy from "./credential-legacy.js"

import { Schema, SchemaTransformation } from "effect"
import { Credential } from "./credential.js"
import { Form } from "./form.js"
import { optional } from "./schema.js"

/**
 * Storage and import compatibility for credentials written before v2.1 (not V1 contracts). Key credentials then kept
 * their setup-form answers in `configuration`; they now live in `metadata`. Only decoders for stored rows and
 * `auth export` files use these schemas, so the public credential contract never sees the old field.
 */
const Key = Schema.Struct({ ...Credential.Key.fields, configuration: optional(Form.Answer) }).pipe(
  Schema.decodeTo(
    Credential.Key,
    SchemaTransformation.transform({
      // Form answers overrode metadata when both reached provider settings, so they keep precedence.
      decode: ({ configuration, ...key }) =>
        configuration === undefined ? key : { ...key, metadata: { ...key.metadata, ...configuration } },
      encode: (key) => key,
    }),
  ),
)

/** Decodes a stored or exported credential value of either shape into the current `Credential.Value`. */
export const Value = Schema.Union([Credential.OAuth, Key, Credential.External])

/** Decodes an `auth export` entry of either shape into the current `Credential.Entry`. */
export const Entry = Schema.Struct({ ...Credential.Entry.fields, value: Value })
