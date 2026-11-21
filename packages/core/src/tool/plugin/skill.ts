export * as SkillTool from "./skill.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import { ToolFailure } from "@opencode/ai/effect"
import { Effect, Schema } from "effect"
import { FSUtil } from "@opencode/util/fs-util"
import { Skill } from "../../skill.js"
import { Permission } from "../../permission.js"

export const name = "skill"

export const Input = Schema.Struct({
  id: Skill.ID.annotate({
    description: "The ID or name of an available skill or of a skill explicitly referenced by the user",
  }),
})

export const Output = Schema.Struct({
  directory: Schema.String,
  content: Schema.String,
})
export const description = [
  "Load a specialized skill's instructions and resources into the current conversation when the task at hand matches its description.",
  "",
  "The skill ID or name must match an available skill or a skill explicitly referenced by the user.",
].join("\n")

export const toModelOutput = Skill.toModelOutput

const unableToLoad = (name: string, error?: unknown) =>
  new ToolFailure({ message: `Unable to load skill ${name}`, error })

// A skill also answers to the name it advertises, so a display name
// (`acme:my-skill`) loads wherever the skill is nested. A name is not a key:
// ambiguity resolves to nothing rather than to a guess.
const byName = (skills: ReadonlyArray<Skill.Info>, id: string) => {
  const matches = skills.filter((skill) => String(skill.name) === String(id))
  return matches.length === 1 ? matches[0] : undefined
}

export const Plugin = {
  id: "opencode.tool.skill",
  effect: Effect.fn("SkillTool.Plugin")(function* (ctx: Context) {
    const fs = yield* FSUtil.Service
    const skills = yield* Skill.Service
    const permission = yield* Permission.Service
    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          description,
          input: Input,
          output: Output,
          execute: (input, context) =>
            Effect.gen(function* () {
              const skill = (yield* skills.get(input.id)) ?? byName(yield* skills.list(), input.id)
              if (!skill) return yield* unableToLoad(input.id)
              return yield* Effect.gen(function* () {
                yield* permission.assert({
                  action: name,
                  resources: [skill.id],
                  save: [skill.id],
                  ...Permission.invocation(context),
                })
                const files = yield* skills.files(skill.id)
                const { directory, output: content } = yield* Skill.prepare(fs, skill, files)
                return {
                  output: { directory, content },
                  content,
                  metadata: { name: skill.name, directory },
                }
              }).pipe(Effect.mapError((error) => unableToLoad(input.id, error)))
            }),
        }),
      )
      .pipe(Effect.orDie)
  }),
}
