import { PluginInvoke } from "@opencode-ai/core/plugin/invoke"
import { UnknownError } from "@opencode-ai/protocol/errors"
import { PluginInvokeNotFoundError, PluginNotFoundError } from "@opencode-ai/protocol/groups/plugin"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"

export const PluginHandler = HttpApiBuilder.group(Api, "server.plugin", (handlers) =>
  handlers
    .handle("plugin.list", () =>
      Effect.gen(function* () {
        const invoke = yield* PluginInvoke.Service
        return { data: invoke.list() }
      }),
    )
    .handle("plugin.invoke", (ctx) =>
      Effect.gen(function* () {
        const invoke = yield* PluginInvoke.Service
        const result = yield* invoke
          .invoke(ctx.params.pluginID, ctx.payload.name, ctx.payload.input)
          .pipe(Effect.mapError(toHttpError))
        return { result }
      }),
    ),
)

function toHttpError(error: unknown) {
  if (error instanceof PluginInvoke.UnknownPluginError)
    return new PluginNotFoundError({ message: `Plugin not found: ${error.pluginID}` })
  if (error instanceof PluginInvoke.UnknownInvokeError)
    return new PluginInvokeNotFoundError({
      pluginID: error.pluginID,
      name: error.name,
      message: `Invoke not found: ${error.pluginID}/${error.name}`,
    })
  return new UnknownError({ message: error instanceof Error ? error.message : String(error) })
}
