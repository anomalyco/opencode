import type { Hooks, Plugin as PluginInstance } from "@opencode-ai/plugin"
import { App } from "../app/app"
import { Config } from "../config/config"
import { Bus } from "../bus"
import { Log } from "../util/log"
import { createOpencodeClient } from "@opencode-ai/sdk"
import { Server } from "../server/server"
import { BunProc } from "../bun"

export namespace Plugin {
  const log = Log.create({ service: "plugin" })

  const state = App.state("plugin", async (app) => {
    const client = createOpencodeClient({
      baseUrl: "http://localhost:4096",
      fetch: async (...args) => Server.app().fetch(...args),
    })
    const config = await Config.get()
    const hooks = []
    const loadPlugin = async (plugin: string) => {
      log.info("loading plugin", { path: plugin })
      if (!plugin.startsWith("file://")) {
        const [pkg, version] = plugin.split("@")
        plugin = await BunProc.install(pkg, version ?? "latest")
      }
      const mod = await import(plugin).catch((error) => {
        log.error("failed to import plugin", { plugin, error: error instanceof Error ? error.message : String(error) })
        return null
      })
      if (!mod) return []

      const pluginHooks = []
      for (const [name, fn] of Object.entries<PluginInstance>(mod)) {
        if (typeof fn !== "function") {
          log.warn("skipping non-function export", { plugin, export: name })
          continue
        }
        log.info("initializing plugin function", { plugin, export: name })
        const init = await fn({
          client,
          app,
          $: Bun.$,
        }).catch((error) => {
          log.error("failed to initialize plugin function", {
            plugin,
            export: name,
            error: error instanceof Error ? error.message : String(error),
          })
          return null
        })
        if (init) {
          pluginHooks.push(init)
          log.info("plugin function initialized successfully", { plugin, export: name })
        }
      }
      return pluginHooks
    }

    for (const plugin of config.plugin ?? []) {
      const pluginHooks = await loadPlugin(plugin)
      hooks.push(...pluginHooks)
    }

    return {
      hooks,
    }
  })

  export async function trigger<
    Name extends keyof Required<Hooks>,
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

  export function init() {
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
