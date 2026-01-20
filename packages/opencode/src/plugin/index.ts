import type { Hooks, PluginInput, Plugin as PluginInstance } from "@opencode-ai/plugin"
import { Config } from "../config/config"
import { Bus } from "../bus"
import { Log } from "../util/log"
import { createOpencodeClient } from "@opencode-ai/sdk"
import { Server } from "../server/server"
import { BunProc } from "../bun"
import { Instance } from "../project/instance"
import { Flag } from "../flag/flag"

export namespace Plugin {
  const log = Log.create({ service: "plugin" })

  const BUILTIN = ["opencode-copilot-auth@0.0.9", "opencode-anthropic-auth@0.0.5"]

  const state = Instance.state(async () => {
    const start = performance.now()
    const client = createOpencodeClient({
      baseUrl: "http://localhost:4096",
      // @ts-ignore - fetch type incompatibility
      fetch: async (...args) => Server.App().fetch(...args),
    })
    const config = await Config.get()
    const hooks = []
    const input: PluginInput = {
      client,
      project: Instance.project,
      worktree: Instance.worktree,
      directory: Instance.directory,
      serverUrl: Server.url(),
      $: Bun.$,
    }
    const plugins = [...(config.plugin ?? [])]
    if (!Flag.OPENCODE_DISABLE_DEFAULT_PLUGINS) {
      plugins.push(...BUILTIN)
    }

    // Install all plugins (Lock in BunProc.install handles concurrency)
    const installed = await Promise.all(
      plugins.map(async (plugin) => {
        if (plugin.startsWith("file://")) return plugin
        const lastAtIndex = plugin.lastIndexOf("@")
        const pkg = lastAtIndex > 0 ? plugin.substring(0, lastAtIndex) : plugin
        const version = lastAtIndex > 0 ? plugin.substring(lastAtIndex + 1) : "latest"
        const builtin = BUILTIN.some((x) => x.startsWith(pkg + "@"))
        const installStart = performance.now()
        const result = await BunProc.install(pkg, version).catch((err) => {
          if (builtin) return ""
          throw err
        })
        log.info("plugin install", { pkg, duration: `${(performance.now() - installStart).toFixed(0)}ms` })
        return result
      }),
    )

    // Load all installed plugins
    for (const plugin of installed) {
      if (!plugin) continue
      log.info("loading plugin", { path: plugin })
      const mod = await import(plugin)
      for (const [_name, fn] of Object.entries<PluginInstance>(mod)) {
        const init = await fn(input)
        hooks.push(init)
      }
    }

    log.info("plugins loaded", { count: hooks.length, duration: `${(performance.now() - start).toFixed(0)}ms` })
    return {
      hooks,
      input,
    }
  })

  export async function trigger<
    Name extends Exclude<keyof Required<Hooks>, "auth" | "event" | "tool" | "command">,
    Input = Parameters<Required<Hooks>[Name]>[0],
    Output = Parameters<Required<Hooks>[Name]>[1],
  >(name: Name, input: Input, output: Output): Promise<Output> {
    if (!name) return output
    for (const hook of await state().then((x) => x.hooks)) {
      const fn = hook[name]
      if (!fn) continue
      // @ts-expect-error if you feel adventurous, please fix the typing, make sure to bump the try-counter if you
      // give up.
      // try-counter: 2
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
      // @ts-expect-error this is because we haven't moved plugin to sdk v2
      await hook.config?.(config)
    }
    Bus.subscribeAll(async (input) => {
      const hooks = await state().then((x) => x.hooks)
      for (const hook of hooks) {
        await hook["event"]?.({
          event: input,
        })
      }
    })
  }
}
