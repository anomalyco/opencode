import type { SkillV2Info } from "@opencode-ai/sdk/v2/types"
import type { Effect } from "effect"
import type { Transformable } from "./registration.js"

export type SkillSource =
  | { readonly type: "directory"; readonly path: string }
  | { readonly type: "url"; readonly url: string }
  | { readonly type: "embedded"; readonly skill: SkillV2Info }

export interface SkillDraft {
  source(source: SkillSource): void
  list(): readonly SkillSource[]
}

export interface Skill extends Transformable<SkillDraft> {
  sources(): Effect.Effect<SkillSource[]>
  list(): Effect.Effect<SkillV2Info[]>
}
