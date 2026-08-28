import { Schema } from "effect"

/**
 * Host-supplied session annotations, durable from creation and opaque to
 * core. Keys are arbitrary; values must be JSON-serializable. Children and
 * forks inherit the parent's metadata unless the creator supplies its own.
 */
export const SessionMetadata = Schema.Record(Schema.String, Schema.Json).annotate({
  identifier: "Session.Metadata",
})
export type SessionMetadata = typeof SessionMetadata.Type
