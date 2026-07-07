import type { SkillApi } from "@opencode-ai/client/promise/api"
import type { SkillDraft } from "../effect/skill.js"
import type { Transform } from "./registration.js"

export type { SkillDraft }

export interface SkillDomain extends SkillApi {
  readonly transform: Transform<SkillDraft>
  readonly reload: () => Promise<void>
}
