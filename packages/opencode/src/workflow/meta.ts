import { Schema, SchemaGetter } from "effect"

// Workflow meta schemas live in their own leaf module (depending only on
// `Schema`) so both the engine (`workflow.ts`) and the static meta reader
// (`meta-reader.ts`) can import them without forming an import cycle: the engine
// re-exports them so its public `Workflow.Meta` / `Workflow.Argument` API is
// unchanged, while the reader can build its decoder at module scope.

export const Argument = Schema.Struct({
  type: Schema.optional(Schema.String),
  default: Schema.optional(Schema.Unknown),
  description: Schema.optional(Schema.String),
}).annotate({ identifier: "WorkflowArgument" })
export type Argument = Schema.Schema.Type<typeof Argument>

// A structured phase. `title` is the phase name (required); `detail` is optional
// human-readable copy; `model` is a per-phase DEFAULT model used by `ctx.agent`
// calls made while this phase is active when the call gave no explicit model.
export const Phase = Schema.Struct({
  title: Schema.String,
  detail: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
}).annotate({ identifier: "WorkflowPhase" })
export type Phase = Schema.Schema.Type<typeof Phase>

// A phase entry as AUTHORED / as carried on the public (SDK/HTTP) contract: either
// a plain string (the phase title) OR a structured `{ title, detail?, model? }`
// object. Keeping the union on the ENCODED side is what makes the change
// backward-compatible — existing string-phases workflows and the already-published
// SDK shape (`phases?: string[]`) still validate unchanged.
const PhaseEntry = Schema.Union([Schema.String, Phase])

// Phases are NORMALIZED to ALWAYS objects internally (`{ title, detail?, model? }[]`)
// the moment meta is decoded — both readers (the static `meta-reader.read` and the
// engine's `finishModule`) go through this same `Meta` decode, so normalization
// lives in exactly ONE place. A bare string `"plan"` becomes `{ title: "plan" }`;
// an object phase is kept verbatim. The transform's ENCODE direction re-emits a
// string for a title-only phase so the wire form stays the back-compatible union.
const Phases = Schema.Array(PhaseEntry).pipe(
  Schema.decodeTo(Schema.Array(Phase), {
    decode: SchemaGetter.transform((entries) =>
      entries.map((entry) => (typeof entry === "string" ? { title: entry } : entry)),
    ),
    encode: SchemaGetter.transform((phases) =>
      phases.map((phase) => (phase.detail === undefined && phase.model === undefined ? phase.title : phase)),
    ),
  }),
)

export const Meta = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  whenToUse: Schema.optional(Schema.String),
  phases: Schema.optional(Phases),
  arguments: Schema.optional(Schema.Record(Schema.String, Argument)),
}).annotate({ identifier: "WorkflowMeta" })
export type Meta = Schema.Schema.Type<typeof Meta>

// The same back-compat ENCODE rule the `Phases` schema applies, extracted as a
// plain function so the persistence layer (`workflow.ts`) can re-emit a stored
// definition's phases in the WIRE form (a title-only phase → the bare string,
// a phase carrying detail/model → the object) WITHOUT round-tripping the whole
// `Definition` through `Schema.encode` (which also touches `source`/`path` and
// is needless risk for a field-local transform). DECODE normalizes every entry
// to an object; ENCODE is the inverse for the back-compatible cross-version
// shape. Kept here, beside the schema, so the rule lives in exactly ONE place.
export function encodePhase(phase: Phase): string | Phase {
  return phase.detail === undefined && phase.model === undefined ? phase.title : phase
}
