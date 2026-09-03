import { Skill } from "@opencode-ai/core/skill"
import { PluginCallback } from "@opencode-ai/core/plugin/callback"
import { PluginCallbackError } from "@opencode-ai/protocol/errors"
import { Plugin } from "@opencode-ai/schema/plugin"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../location"

export const SkillHandler = HttpApiBuilder.group(Api, "server.skill", (handlers) =>
  handlers.handle("skill.list", () =>
    response(Skill.Service.use((skill) => skill.list())).pipe(
      Effect.catchDefect((error) => {
        if (!(error instanceof PluginCallback.Error)) return Effect.die(error)
        return Effect.logError("Plugin callback failed", error).pipe(
          Effect.andThen(
            Effect.fail(
              new PluginCallbackError({
                pluginID: Plugin.ID.make(error.pluginID),
                operation: error.operation,
                message: `${error.message} Check server logs for details.`,
              }),
            ),
          ),
        )
      }),
    ),
  ),
)
