// L3/L4 error surface. Distinct from BackendError (L2) in ./errors.ts;
// Primitives maps BackendError → WorkspaceError. Kept in its own file
// so router.ts, index.ts, and the Primitives layer can all import it
// without cyclic-module issues during class construction.
import { Schema } from "effect"

export class WorkspaceError extends Schema.TaggedErrorClass<WorkspaceError>()("WorkspaceError", {
  method: Schema.String,
  path: Schema.optional(Schema.String),
  cause: Schema.optional(Schema.Defect),
}) {}
