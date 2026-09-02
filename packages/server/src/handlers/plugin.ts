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
    .handle("plugin.check", (ctx) =>
      Effect.gen(function* () {
        const supervisor = yield* PluginSupervisor.Service
        yield* supervisor.awaitActivation
        const plugins = yield* Plugin.Service
        const inventory = yield* plugins.list()
        const targets = [
          ...new Set(
            inventory.flatMap((plugin) => (plugin.source.type === "package" ? [plugin.source.target] : [])),
          ),
        ].filter((target) => ctx.payload.target === undefined || target === ctx.payload.target)
        if (ctx.payload.target !== undefined && !targets.length)
          return yield* new InvalidRequestError({
            message: `Plugin package is not in the current server inventory: ${ctx.payload.target}`,
            field: "target",
          })
        const updates = yield* PluginUpdate.Service
        const outdated = new Map(
          yield* Effect.forEach(
            targets,
            (target) => updates.check(target, { refresh: true }).pipe(Effect.map((value) => [target, value] as const)),
            { concurrency: "unbounded" },
          ),
        )
        return yield* response(
          Effect.succeed(
            inventory.map((plugin) => {
              if (plugin.source.type !== "package" || !outdated.has(plugin.source.target)) return plugin
              return {
                ...plugin,
                source: {
                  type: "package" as const,
                  target: plugin.source.target,
                  ...(plugin.source.version ? { version: plugin.source.version } : {}),
                  ...(outdated.get(plugin.source.target) ? { outdated: true as const } : {}),
                },
              }
            }),
          ),
        )
      }),
    )
    .handle("plugin.update", (ctx) =>
      Effect.gen(function* () {
        const supervisor = yield* PluginSupervisor.Service
        yield* supervisor.awaitActivation
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
