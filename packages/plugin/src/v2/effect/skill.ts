import type { SkillSource } from "@opencode-ai/sdk/v2/types"
import type { SkillApi } from "@opencode-ai/client/effect/api"
import type { Effect } from "effect"
import type { TransformHook } from "./registration.js"

export interface SkillDraft {
  source(source: SkillSource): void
  list(): readonly SkillSource[]
}

export interface SkillHooks extends SkillApi<unknown> {
  readonly transform: TransformHook<SkillDraft>
  readonly reload: () => Effect.Effect<void>
}
