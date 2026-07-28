import type { SkillApi } from "@opencode-ai/client/promise/api"
import type { Skill } from "@opencode-ai/schema/skill"
import type { Transform } from "./registration.js"

export interface SkillDraft {
  source(source: Skill.Source): void
  list(): readonly Skill.Source[]
}

export interface SkillDomain extends SkillApi {
  readonly transform: Transform<SkillDraft>
  readonly reload: () => Promise<void>
}
