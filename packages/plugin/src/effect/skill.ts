import type { SkillApi } from "@opencode-ai/client/effect/api"
import { Skill } from "@opencode-ai/schema/skill"
import type { Effect } from "effect"
import type { Transform } from "./registration.js"

export interface SkillDraft {
  source(source: Skill.Source): void
  list(): readonly Skill.Source[]
}

export interface SkillDomain extends SkillApi<unknown> {
  readonly transform: Transform<SkillDraft>
  readonly reload: () => Effect.Effect<void>
}
