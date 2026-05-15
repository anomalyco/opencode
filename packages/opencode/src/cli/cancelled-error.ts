import { Schema } from "effect"

// Lives in its own module so that `src/cli/ui.ts` (loaded eagerly on every
// CLI invocation) doesn't have to pull `effect/Schema` just to define the
// error class. Callers that throw or match on this class are themselves
// lazy-loaded (github/agent prompts, error formatter).
export class CancelledError extends Schema.TaggedErrorClass<CancelledError>()("UICancelledError", {}) {}
