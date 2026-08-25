export * as PromiseSdk from "./promise"

import { OpenCode, type OpenCodeClient } from "@opencode-ai/client"
import type { Plugin } from "@opencode-ai/plugin"
import { Effect } from "effect"
import { EmbeddedHost } from "./internal/host"

export interface CreateOptions extends Omit<EmbeddedHost.CreateOptions, "workspaceProviders"> {
  readonly plugins?: ReadonlyArray<Plugin.Plugin>
}

export type Interface = Omit<OpenCodeClient, "plugin"> & {
  readonly sessions: OpenCodeClient["session"]
  readonly events: OpenCodeClient["event"]
  readonly plugin: ((plugin: Plugin.Plugin) => Promise<void>) & OpenCodeClient["plugin"]
  readonly close: () => Promise<void>
  readonly [Symbol.asyncDispose]: () => Promise<void>
}

export async function create(options: CreateOptions = {}, embed: EmbeddedHost.EmbedOptions = {}): Promise<Interface> {
  const { plugins, ...hostOptions } = options
  const host = await Effect.runPromise(EmbeddedHost.create(hostOptions, embed))
  const client = OpenCode.make({ baseUrl: "http://opencode.local", fetch: host.fetch })
  const register = async (plugin: Plugin.Plugin) => {
    const { PluginPromise } = await import("@opencode-ai/core/plugin/promise")
    return host.runtime.runPromise(host.plugins.register(PluginPromise.fromPromise(plugin)))
  }
  for (const plugin of plugins ?? []) await register(plugin)

  return {
    ...client,
    sessions: client.session,
    events: client.event,
    plugin: Object.assign(register, client.plugin),
    close: host.close,
    [Symbol.asyncDispose]: host.close,
  }
}
