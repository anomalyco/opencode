import { Schema, SchemaTransformation } from "effect"
import { FileDiff } from "./file-diff.js"
import { optional } from "./schema.js"
import { SessionMessage } from "./session-message.js"
import { Snapshot } from "./snapshot.js"

export interface Revert extends Schema.Schema.Type<typeof Revert> {}
export const Revert = Schema.Struct({
  messageID: SessionMessage.ID,
  /** Legacy V1 compatibility state. */
  partID: Schema.String.pipe(optional),
  snapshot: Snapshot.ID.pipe(optional),
  files: Schema.Array(FileDiff.Info).pipe(optional),
}).annotate({ identifier: "Session.Revert" })

const LegacyFileDiff = Schema.Struct({
  path: Schema.String,
  status: Schema.Literals(["added", "modified", "deleted"]),
  additions: Schema.Finite,
  deletions: Schema.Finite,
  patch: Schema.String,
})

export interface LegacyRevert extends Schema.Schema.Type<typeof LegacyRevert> {}
export const LegacyRevert = Schema.Struct({
  messageID: SessionMessage.ID,
  partID: Schema.String.pipe(optional),
  snapshot: Schema.String.pipe(optional),
  diff: Schema.String.pipe(optional),
  files: Schema.Array(LegacyFileDiff).pipe(optional),
}).annotate({ identifier: "Session.RevertV1" })

const PersistedCurrent = Revert.pipe(
  Schema.decodeTo(
    Schema.Struct({ source: Schema.tag("current"), revert: Schema.toType(Revert) }),
    SchemaTransformation.transform({
      decode: (revert): { readonly source: "current"; readonly revert: Revert } => ({
        source: "current",
        revert,
      }),
      encode: (value) => value.revert,
    }),
  ),
)
const PersistedLegacy = LegacyRevert.pipe(
  Schema.decodeTo(
    Schema.Struct({ source: Schema.tag("legacy"), revert: Schema.toType(LegacyRevert) }),
    SchemaTransformation.transform({
      decode: (revert): { readonly source: "legacy"; readonly revert: LegacyRevert } => ({
        source: "legacy",
        revert,
      }),
      encode: (value) => value.revert,
    }),
  ),
)

/** Storage decoder for revert state written before FileDiff became canonical. */
export const PersistedRevert = Schema.Union([PersistedCurrent, PersistedLegacy]).pipe(
  Schema.toTaggedUnion("source"),
  Schema.decodeTo(
    Schema.toType(Revert),
    SchemaTransformation.transform({
      decode: (persisted): Revert => {
        if (persisted.source === "current") return persisted.revert
        return Revert.make({
          messageID: persisted.revert.messageID,
          partID: persisted.revert.partID,
          snapshot: persisted.revert.snapshot ? Snapshot.ID.make(persisted.revert.snapshot) : undefined,
          files: persisted.revert.files?.map((file) => ({
            file: file.path,
            status: file.status,
            additions: file.additions,
            deletions: file.deletions,
            patch: file.patch,
          })),
        })
      },
      encode: (revert): { readonly source: "current"; readonly revert: Revert } => ({
        source: "current",
        revert,
      }),
    }),
  ),
  Schema.annotate({ identifier: "Session.Revert.Persisted" }),
)
