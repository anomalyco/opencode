import type { SkillV2Source } from "@opencode-ai/sdk/v2/types"
import type { Hooks } from "./registration.js"

export interface SkillDraft {
  source(source: SkillV2Source): void
  list(): readonly SkillV2Source[]
}

export type SkillHooks = Hooks<{
  transform: SkillDraft
}>
