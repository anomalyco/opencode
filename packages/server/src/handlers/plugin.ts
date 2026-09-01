import { Plugin } from "@opencode-ai/core/plugin"
import { PluginSupervisor } from "@opencode-ai/core/plugin/supervisor"
import { PluginUpdate } from "@opencode-ai/core/plugin/update"
import { InvalidRequestError, ServiceUnavailableError } from "@opencode-ai/protocol/errors"
import { Cause, Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../location"

export const PluginHandler = HttpApiBuilder.group(Api, "server.plugin", (handlers) =>
  handlers
    .handle("plugin.list", () =>
      Effect.gen(function* () {
        return yield* response(Plugin.Service.use((plugin) => plugin.list()))
      }),
    )
    .handle("plugin.update", (ctx) =>
      Effect.gen(function* () {
        const supervisor = yield* PluginSupervisor.Service
        yield* supervisor.flush
        const plugins = yield* Plugin.Service
        if (
          !(yield* plugins.list()).some(
            (plugin) => plugin.source.type === "package" && plugin.source.target === ctx.payload.target,
          )
        )
          return yield* new InvalidRequestError({
            message: `Plugin package is not in the current server inventory: ${ctx.payload.target}`,
            field: "target",
          })
        const updates = yield* PluginUpdate.Service
        yield* updates.update(ctx.payload.target).pipe(
          Effect.catchCause((cause) =>
            Effect.fail(
              new ServiceUnavailableError({
                message: `Failed to update plugin package ${ctx.payload.target}: ${Cause.pretty(cause)}`,
                service: "plugin",
              }),
            ),
          ),
        )
      }),
    ),
)
