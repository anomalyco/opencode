import { SkillV2 } from "@opencode-ai/core/skill"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../location"

export const SkillHandler = HttpApiBuilder.group(Api, "server.skill", (handlers) =>
  handlers.handle("skill.list", () => response(SkillV2.Service.use((skill) => skill.list()))),
)
