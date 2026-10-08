import { Skill } from "@opencode/core/skill"
import { Plugin } from "@opencode/core/plugin/service"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../location"

export const SkillHandler = HttpApiBuilder.group(Api, "server.skill", (handlers) =>
  handlers.handle("skill.list", () =>
    response(Plugin.awaitActivation.pipe(Effect.andThen(Skill.Service.use((skill) => skill.list())))),
  ),
)
