import { Effect } from "effect"
import { Skill } from "@Mackery6969/core/skill"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../api"
import { awaitPlugins, response } from "../location"

export const SkillHandler = HttpApiBuilder.group(Api, "server.skill", (handlers) =>
  handlers.handle("skill.list", () =>
    Effect.gen(function* () {
      yield* awaitPlugins
      return yield* response(Skill.Service.use((skill) => skill.list()))
    }),
  ),
)
