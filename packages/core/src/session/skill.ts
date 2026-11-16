export * as SessionSkill from "./skill.js"

import type { Session } from "@opencode/schema/session"
import { Effect } from "effect"
import { Instance } from "../instance/service.js"
import { Plugin } from "../plugin/service.js"
import { Skill } from "../skill.js"
import { SkillNotFoundError } from "./error.js"

export const get = Effect.fn("SessionSkill.get")(function* (input: { session: Session.Info; skill: Skill.ID }) {
  const instances = yield* Instance.Service
  const skills = yield* Plugin.awaitActivation.pipe(Effect.andThen(Skill.Service), instances.provide(input.session))
  const skill = yield* skills.get(input.skill).pipe(Effect.catchTag("Skill.LoadError", unloadable))
  if (!skill) return yield* new SkillNotFoundError({ skill: input.skill })
  return skill
})

// The public API has no error for a skill whose content failed to load, so it is reported as missing.
export const unloadable = (error: Skill.LoadError) =>
  Effect.logWarning("failed to load skill", { skill: error.skill, error: error.message }).pipe(
    Effect.andThen(Effect.fail(new SkillNotFoundError({ skill: error.skill }))),
  )
