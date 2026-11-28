export * as PromiseSdk from "./promise"

import { OpenCode } from "@opencode/client"
import type { Plugin } from "@opencode/plugin"
import type { Workspace } from "@opencode/core/workspace"
import { Session } from "@opencode/schema/session"
import { Effect, Schema } from "effect"
import type { CreateOptions, Interface } from "../opencode"
import { EmbeddedHost } from "./host"

/** `OpenCode.create` with the host hooks a runtime profile (such as workerd) needs, returning the host too. */
export async function createWithHost(
  options: CreateOptions = {},
  embed: EmbeddedHost.EmbedOptions = {},
): Promise<{ readonly sdk: Interface; readonly host: EmbeddedHost.Interface }> {
  const { plugins, instances, ...hostOptions } = options
  const host = await Effect.runPromise(
    EmbeddedHost.create(
      {
        ...hostOptions,
        plugins: await adaptPlugins(plugins),
        instances: instances
          ? {
              key: (session) => instances.key(Schema.encodeSync(Session.Info)(session)),
              configure: (key) =>
                Effect.gen(function* () {
                  const { PluginPromise } = yield* Effect.promise(() => import("@opencode/core/plugin/promise"))
                  const configuration = yield* Effect.tryPromise(async () => instances.configure(key))
                  return { plugins: configuration.plugins.map(PluginPromise.fromPromise) }
                }),
            }
          : undefined,
      },
      embed,
    ),
  )
  const client = OpenCode.make({ baseUrl: "http://opencode.local", fetch: host.fetch })
  const register = async (plugin: Plugin.Plugin) => {
    const { PluginPromise } = await import("@opencode/core/plugin/promise")
    return host.runtime.runPromise(host.plugins.register(PluginPromise.fromPromise(plugin)))
  }
  const workspace = host.workspace
  return {
    host,
    sdk: {
      ...client,
      sessions: client.session,
      events: client.event,
      workspace: {
        create: (input) => host.runtime.runPromise(workspace.create(input)),
        attach: (input) => host.runtime.runPromise(workspace.attach(input)),
        provision: (input: { readonly workspaceID: Workspace.ID }) =>
          host.runtime.runPromise(workspace.provision(input.workspaceID)),
        destroy: (input: { readonly workspaceID: Workspace.ID }) =>
          host.runtime.runPromise(workspace.destroy(input.workspaceID)),
        suspendIdle: () => host.runtime.runPromise(workspace.suspendIdle()),
      },
      plugin: Object.assign(register, client.plugin),
      close: host.close,
      [Symbol.asyncDispose]: host.close,
    },
  }
}

async function adaptPlugins(plugins: ReadonlyArray<Plugin.Plugin> | undefined) {
  if (!plugins?.length) return undefined
  const { PluginPromise } = await import("@opencode/core/plugin/promise")
  return plugins.map(PluginPromise.fromPromise)
}
