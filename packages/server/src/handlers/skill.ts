import { SkillV2 } from "@opencode-ai/core/skill"
import { UserContext } from "@opencode-ai/schema/user-context"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../location"

export const SkillHandler = HttpApiBuilder.group(Api, "server.skill", (handlers) =>
  handlers.handle("skill.list", () =>
    response(
      Effect.gen(function* () {
        const userContext = yield* UserContext.Service.pipe(Effect.option)
        return yield* SkillV2.Service.use((skill) => skill.list(userContext ?? undefined))
      }),
    ),
  ),
)
