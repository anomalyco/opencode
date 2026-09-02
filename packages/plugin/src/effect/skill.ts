import type { SkillApi } from "@opencode-ai/client/effect/api"
import { Skill } from "@opencode-ai/schema/skill"
import type { Effect, Types } from "effect"
import type { Transform } from "./registration.js"

export interface SkillEditor {
  list(): readonly Types.DeepMutable<Skill.Info>[]
  add(skill: Skill.Info): void
  update(id: string, update: (skill: Types.DeepMutable<Skill.Info>) => void): void
  remove(id: string): void
}

export interface SkillDomain extends SkillApi<unknown> {
  readonly transform: Transform<SkillEditor>
  readonly reload: () => Effect.Effect<void>
}
