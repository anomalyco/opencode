import { Effect } from "effect"
import { Skill } from "."

export interface SkillMeta {
  name: string
  type: "core" | "non-core"
  description: string | undefined
  path: string
  loaded: boolean
}

export const scanAvailableSkills = Effect.fn("SkillScanner.scanAvailable")(function* () {
  const skill = yield* Skill.Service
  const items = yield* skill.all()
  const metas: SkillMeta[] = []

  for (const item of items) {
    metas.push({
      name: item.name,
      type: item.type ?? "non-core",
      description: item.description,
      path: item.location,
      loaded: yield* skill.isLoaded(item.name),
    })
  }

  return metas
})
