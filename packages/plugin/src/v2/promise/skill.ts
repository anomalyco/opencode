import type { SkillDraft, SkillSource } from "../effect/skill.js"
import type { Hooks } from "./registration.js"

export type { SkillDraft, SkillSource }

export type SkillHooks = Hooks<{
  transform: SkillDraft
}>
