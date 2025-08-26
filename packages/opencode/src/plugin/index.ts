import type { Hooks, Plugin as PluginInstance } from "@opencode-ai/plugin"
import { Config } from "../config/config"
import { Bus } from "../bus"
import { Log } from "../util/log"
import { createOpencodeClient } from "@opencode-ai/sdk"
import { Server } from "../server/server"
import { BunProc } from "../bun"
import { Instance } from "../project/instance"
import { Flag } from "../flag/flag"
import { ToolRegistry } from "../tool/registry"

type HasExactlyTwoParams<T> = T extends (...args: infer P) => any
  ? P extends [any, any]
    ? P['length'] extends 2
      ? true
      : false
    : false
  : false

type HooksWithOutput = {
  [K in keyof Hooks]: NonNullable<Hooks[K]> extends (...args: any[]) => any
    ? HasExactlyTwoParams<NonNullable<Hooks[K]>> extends true
      ? K
      : never
    : never
}[keyof Hooks]

type HooksWithoutOutput = {
  [K in keyof Hooks]: NonNullable<Hooks[K]> extends (...args: any[]) => any
    ? HasExactlyTwoParams<NonNullable<Hooks[K]>> extends false
      ? K
      : never
    : never
}[keyof Hooks]

export namespace Plugin {
  const log = Log.create({ service: "plugin" })

  const state = Instance.state(async () => {
    const client = createOpencodeClient({
      baseUrl: "http://localhost:4096",
      fetch: async (...args) => Server.App.fetch(...args),
    })
    const config = await Config.get()
    const hooks = []
    const input = {
      client,
      project: Instance.project,
      worktree: Instance.worktree,
      directory: Instance.directory,
      $: Bun.$,
      Tool: await import("../tool/tool").then((m) => m.Tool),
      z: await import("zod").then((m) => m.z),
    }
    const plugins = [...(config.plugin ?? [])]
    if (!Flag.OPENCODE_DISABLE_DEFAULT_PLUGINS) {
      plugins.push("opencode-copilot-auth@0.0.2")
      plugins.push("opencode-anthropic-auth@0.0.2")
    }
    for (let plugin of plugins) {
      log.info("loading plugin", { path: plugin })
      if (!plugin.startsWith("file://")) {
        const [pkg, version] = plugin.split("@")
        plugin = await BunProc.install(pkg, version ?? "latest")
      }
      const mod = await import(plugin)
      for (const [_name, fn] of Object.entries<PluginInstance>(mod)) {
        const init = await fn(input)
        hooks.push(init)
      }
    }

    return {
      hooks,
      input,
    }
  })

  export async function trigger<Name extends HooksWithoutOutput>(
    name: Exclude<Name, "auth" | "event">,
    input: Name extends keyof Hooks ? Parameters<NonNullable<Hooks[Name]>>[0] : never
  ): Promise<void>

  export async function trigger<Name extends HooksWithOutput>(
    name: Exclude<Name, "auth" | "event">,
    input: Name extends keyof Hooks ? Parameters<NonNullable<Hooks[Name]>>[0] : never,
    output: Name extends keyof Hooks ? Parameters<NonNullable<Hooks[Name]>>[1] : never
  ): Promise<Name extends keyof Hooks ? Parameters<NonNullable<Hooks[Name]>>[1] : never>

  export async function trigger<
    Name extends Exclude<keyof Required<Hooks>, "auth" | "event">
  >(name: Name, input: any, output?: any): Promise<any> {
    if (!name) return output
    for (const hook of await state().then((x) => x.hooks)) {
      const fn = hook[name]
      if (!fn) continue
      await fn(input, output)
    }
    return output
  }

  export async function list() {
    return state().then((x) => x.hooks)
  }

  export async function init() {
    const hooks = await state().then((x) => x.hooks)
    const config = await Config.get()
    for (const hook of hooks) {
      await hook.config?.(config)
      // Let plugins register tools at startup
      await hook["tool.register"]?.(
        {},
        {
          registerHTTP: ToolRegistry.registerHTTP,
          register: ToolRegistry.register,
        },
      )
    }
    Bus.subscribeAll(async (input) => {
      const hooks = await state().then((x) => x.hooks)
      for (const hook of hooks) {
        hook["event"]?.({
          event: input,
        })
      }
    })
  }
}
