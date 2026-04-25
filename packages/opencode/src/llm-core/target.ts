import { Effect } from "effect"
import type { LLMError } from "./schema"

export interface TargetBuilder<Draft, Target> {
  readonly empty: Draft
  readonly concat: (left: Draft, right: Draft) => Effect.Effect<Draft, LLMError>
  readonly validate: (draft: Draft) => Effect.Effect<Target, LLMError>
}

export * as LLMCoreTarget from "./target"
