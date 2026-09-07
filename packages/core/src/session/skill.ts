export * as SessionSkill from "./skill.js"

import type { Session } from "@opencode-ai/schema/session"
import { Effect } from "effect"
import { Instance } from "../instance/service.js"
import { Plugin } from "../plugin/service.js"
import { Skill } from "../skill.js"
import { SkillNotFoundError } from "./error.js"

export const get = Effect.fn("SessionSkill.get")(function* (input: { session: Session.Info; skill: Skill.ID }) {
  const instances = yield* Instance.Service
  const skills = yield* Plugin.awaitActivation.pipe(Effect.andThen(Skill.Service), instances.provide(input.session))
  const skill = yield* skills.get(input.skill)
  if (!skill) return yield* new SkillNotFoundError({ skill: input.skill })
  return skill
})
