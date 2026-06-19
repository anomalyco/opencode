import { Effect } from "effect"
import { Skill } from "."

export const loadSkillContent = Effect.fn("SkillLoader.loadContent")(function* (name: string) {
  const skill = yield* Skill.Service
  const info = yield* skill.require(name)
  return info.content
})
