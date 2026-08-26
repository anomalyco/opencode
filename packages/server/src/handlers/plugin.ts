import { Plugin } from "@opencode-ai/core/plugin"
import { PluginSupervisor } from "@opencode-ai/core/plugin/supervisor"
import { Effect } from "effect"
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
    .handle("plugin.check", () =>
      Effect.gen(function* () {
        const plugins = yield* PluginSupervisor.Service
        return yield* response(plugins.check())
      }),
    )
    .handle("plugin.update", (ctx) =>
      Effect.gen(function* () {
        const plugins = yield* PluginSupervisor.Service
        return yield* response(plugins.update(ctx.payload.name))
      }),
    )
    .handle("plugin.updateAll", () =>
      Effect.gen(function* () {
        const plugins = yield* PluginSupervisor.Service
        return yield* response(plugins.updateAll())
      }),
    ),
)
