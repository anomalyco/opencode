import type { SkillApi } from "@opencode-ai/client/promise/api"
import type { Skill } from "@opencode-ai/schema/skill"
import type { Transform } from "./registration.js"
import type { DeepMutable } from "./types.js"

export interface SkillDraft {
  list(): readonly DeepMutable<Skill.Info>[]
  add(skill: Skill.Info): void
  update(id: string, update: (skill: DeepMutable<Skill.Info>) => void): void
  remove(id: string): void
}

export interface SkillDomain extends SkillApi {
  readonly transform: Transform<SkillDraft>
  readonly reload: () => Promise<void>
}
