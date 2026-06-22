import type { SkillV2Info } from "@opencode-ai/sdk/v2/types"
import type { Hooks } from "./registration.js"

export type SkillSource =
  | { readonly type: "directory"; readonly path: string }
  | { readonly type: "url"; readonly url: string }
  | { readonly type: "embedded"; readonly skill: SkillV2Info }

export interface SkillDraft {
  source(source: SkillSource): void
  list(): readonly SkillSource[]
}

export type SkillHooks = Hooks<{
  transform: SkillDraft
}>
