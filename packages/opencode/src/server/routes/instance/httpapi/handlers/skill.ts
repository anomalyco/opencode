import { Skill } from "@/skill"
import { loadSkillContent } from "@/skill/loader"
import { scanAvailableSkills } from "@/skill/scanner"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { ApiNotFoundError } from "../errors"
import { SkillContentQuery, SkillLoadPayload } from "../groups/skill"

export const skillHandlers = HttpApiBuilder.group(InstanceHttpApi, "skill", (handlers) =>
  Effect.gen(function* () {
    const list = () =>
      Effect.gen(function* () {
        return yield* scanAvailableSkills()
      })

    const content = (ctx: { query: typeof SkillContentQuery.Type }) =>
      Effect.gen(function* () {
        const content = yield* loadSkillContent(ctx.query.name).pipe(
          Effect.catchTag("Skill.NotFoundError", (error) =>
            Effect.fail(new ApiNotFoundError({ name: "NotFoundError", data: { message: error.message } })),
          ),
        )
        return { name: ctx.query.name, content }
      })

    const load = (ctx: { payload: typeof SkillLoadPayload.Type }) =>
      Effect.gen(function* () {
        const skill = yield* Skill.Service
        const info = yield* skill.require(ctx.payload.name).pipe(
          Effect.catchTag("Skill.NotFoundError", (error) =>
            Effect.fail(new ApiNotFoundError({ name: "NotFoundError", data: { message: error.message } })),
          ),
        )
        yield* skill.loadIntoSession(ctx.payload.name).pipe(
          Effect.catchTag("Skill.NotFoundError", (error) =>
            Effect.fail(new ApiNotFoundError({ name: "NotFoundError", data: { message: error.message } })),
          ),
        )
        return { name: info.name, description: info.description, content: info.content, type: info.type, loaded: true as const }
      })

    return handlers.handle("list", list).handle("content", content).handle("load", load)
  }),
)
