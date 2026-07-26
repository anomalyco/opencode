// Session-to-Session — Task 3 (S2SCapsule schema + serde).
//
// A capsule is the on-the-wire payload one opencode session sends to another
// over the s2s_inbox table. Version 1 is a flat object with a small set of
// required fields and a couple of optional ones (token for capability grants,
// in_reply_to for threading, context for diff/file hints used by the merge
// step later).
//
// The poller reads capsules from a foreign process; it must never throw on
// malformed input — `decodeCapsuleOption` is the only safe entry point for
// poll loops. `decodeCapsule` is a strict variant for unit tests and trusted
// code paths (e.g. our own writer's output, where any throw indicates a bug).

import { Option, Schema } from "effect"

export const S2SCapsule = Schema.Struct({
  version: Schema.Literal(1),
  id: Schema.String,
  sender_slug: Schema.String,
  // Human-readable sender session name (title) — shown in the recipient's
  // <external-context> frame + ✉ marker. Optional for forward/backward compat
  // with capsules minted before this field existed (decode falls back to id).
  sender_name: Schema.optional(Schema.String),
  sender_session_id: Schema.String,
  timestamp: Schema.Number,
  token: Schema.optional(Schema.String),
  in_reply_to: Schema.optional(Schema.String),
  context: Schema.optional(Schema.Struct({ diff: Schema.String, file: Schema.String })),
  body: Schema.String,
})
export type S2SCapsule = Schema.Schema.Type<typeof S2SCapsule>

export const encodeCapsule = (c: S2SCapsule): string => JSON.stringify(c)

const decodeSync = Schema.decodeUnknownSync(S2SCapsule, { onExcessProperty: "ignore" })
const decodeOption = Schema.decodeUnknownOption(S2SCapsule, { onExcessProperty: "ignore" })

export const decodeCapsule = (s: string): S2SCapsule => decodeSync(JSON.parse(s))

export const decodeCapsuleOption = (s: string): Option.Option<S2SCapsule> => {
  let parsed: unknown
  try {
    parsed = JSON.parse(s)
  } catch {
    return Option.none()
  }
  return decodeOption(parsed)
}
