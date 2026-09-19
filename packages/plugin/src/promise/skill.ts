import type { SkillApi } from "@opencode/client/promise/api"
import type { Skill } from "@opencode/schema/skill"
import type { Transform } from "./registration.js"
import type { DeepMutable } from "./types.js"

export interface SkillEditor {
  list(): readonly DeepMutable<Skill.Info>[]
  get(id: string): DeepMutable<Skill.Info> | undefined
  add(skill: Skill.Info & { readonly content: string }): void
  /** `load` produces the skill body (SKILL.md without frontmatter) when the skill is used, so nothing is held until then. */
  add(skill: Skill.Info, load: () => Promise<string>): void
  update(id: string, update: (skill: DeepMutable<Skill.Info>) => void): void
  remove(id: string): void
}

export interface SkillDomain extends SkillApi {
  readonly transform: Transform<SkillEditor>
  readonly reload: () => Promise<void>
}
