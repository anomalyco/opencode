import type { SkillApi } from "@opencode-ai/client/promise/api"
import type { SkillDraft } from "../effect/skill.js"
import type { Hooks, Transform } from "./registration.js"

export type { SkillDraft }

export interface SkillHooks {}

export interface SkillDomain extends SkillApi {
  readonly hook: Hooks<SkillHooks>
  readonly transform: Transform<SkillDraft>
  readonly reload: () => Promise<void>
}
