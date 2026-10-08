import { Plugin } from "@opencode/core/plugin"
import { Skill } from "@opencode/core/skill"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../location"

export const SkillHandler = HttpApiBuilder.group(Api, "server.skill", (handlers) =>
  handlers.handle(
    "skill.list",
    Effect.fn(function* () {
      yield* Plugin.awaitActivation
      const service = yield* Skill.Service
      return yield* response(service.list())
    }),
  ),
)
