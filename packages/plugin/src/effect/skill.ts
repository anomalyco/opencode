import type { SkillApi } from "@opencode/client/effect/api"
import { Skill } from "@opencode/schema/skill"
import type { Effect, Types } from "effect"
import type { Transform } from "./registration.js"

export interface SkillEditor {
  list(): readonly Types.DeepMutable<Skill.Info>[]
  get(id: string): Types.DeepMutable<Skill.Info> | undefined
  /**
   * Adds or replaces a skill. `files` are extra files that ship with it, keyed by path relative to the skill, such as
   * `{ "reference/api.md": "..." }`. The read tool opens them at `skill://<id>/<path>`, and loading the skill lists
   * them.
   */
  add(skill: Skill.Info, files?: Readonly<Record<string, string>>): void
  update(id: string, update: (skill: Types.DeepMutable<Skill.Info>) => void): void
  remove(id: string): void
}

export interface SkillDomain extends SkillApi<unknown> {
  readonly transform: Transform<SkillEditor>
  readonly reload: () => Effect.Effect<void>
}
