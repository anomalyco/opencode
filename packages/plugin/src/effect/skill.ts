import type { SkillApi } from "@opencode-ai/client/effect/api"
import { Skill } from "@opencode-ai/schema/skill"
import type { Effect, Types } from "effect"
import type { Transform } from "./registration.js"

export interface SkillDraft {
  list(): readonly Types.DeepMutable<Skill.Info>[]
  add(skill: Skill.Info): void
  update(id: string, update: (skill: Types.DeepMutable<Skill.Info>) => void): void
  remove(id: string): void
}

export interface SkillDomain extends SkillApi<unknown> {
  readonly transform: Transform<SkillDraft>
  readonly reload: () => Effect.Effect<void>
}
