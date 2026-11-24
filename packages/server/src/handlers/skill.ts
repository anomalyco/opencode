import { Skill } from "@opencode/core/skill"
import { SkillLoadError, SkillNotFoundError } from "@opencode/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../api"
import { response } from "../location"

export const SkillHandler = HttpApiBuilder.group(Api, "server.skill", (handlers) =>
  handlers
    .handle("skill.list", () => response(Skill.Service.use((skill) => skill.list({ content: "eager" }))))
    .handle("skill.content", (ctx) =>
      response(
        Effect.gen(function* () {
          const skills = yield* Skill.Service
          const skill = yield* skills
            .get(ctx.params.skillID)
            .pipe(
              Effect.catchTag("Skill.LoadError", (error) =>
                Effect.fail(
                  new SkillLoadError({
                    skill: error.skill,
                    message: `Unable to load skill ${error.skill}: ${error.message}`,
                  }),
                ),
              ),
            )
          if (!skill)
            return yield* new SkillNotFoundError({
              skill: ctx.params.skillID,
              message: `Skill not found: ${ctx.params.skillID}`,
            })
          return { content: skill.content }
        }),
      ),
    ),
)
