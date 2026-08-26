import { Plugin } from "@opencode-ai/core/plugin"
import { PluginSupervisor } from "@opencode-ai/core/plugin/supervisor"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../location"

export const PluginHandler = HttpApiBuilder.group(Api, "server.plugin", (handlers) =>
  handlers
    .handle("plugin.list", () => response(Plugin.Service.use((plugin) => plugin.list())))
    .handle("plugin.check", () => response(PluginSupervisor.Service.use((plugins) => plugins.check())))
    .handle("plugin.update", (ctx) =>
      response(PluginSupervisor.Service.use((plugins) => plugins.update(ctx.payload.name))),
    )
    .handle("plugin.updateAll", () => response(PluginSupervisor.Service.use((plugins) => plugins.updateAll()))),
)
