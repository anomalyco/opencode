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

  const state = Instance.state(async () => {
    // Type cast needed due to incompatibility between Hono's fetch and standard fetch
    const appFetch = Server.App().fetch as any
    const client = createOpencodeClient({
      baseUrl: "http://localhost:4096",
      fetch: appFetch,
    })
    const config = await Config.get()
    const hooks = []
    const input: PluginInput = {
      client,
      project: Instance.project,
      worktree: Instance.worktree,
      directory: Instance.directory,
      $: Bun.$,
    }
    const plugins = [...(config.plugin ?? [])]
    if (!Flag.OPENCODE_DISABLE_DEFAULT_PLUGINS) {
      plugins.push("opencode-copilot-auth@0.0.4")
      plugins.push("opencode-anthropic-auth@0.0.2")
    }
    for (let plugin of plugins) {
      try {
        log.info("loading plugin", { path: plugin })
        if (!plugin.startsWith("file://")) {
          const [pkg, version] = plugin.split("@")
          if (!pkg || pkg.trim() === "") {
            log.error("invalid plugin format", { plugin })
            continue
          }
          plugin = await BunProc.install(pkg, version ?? "latest")
        }
        const mod = await import(plugin)
        if (!mod || typeof mod !== "object") {
          log.error("invalid plugin module", { plugin })
          continue
        }

        for (const [name, fn] of Object.entries<PluginInstance>(mod)) {
          if (typeof fn !== "function") {
            log.warn("skipping non-function export", { plugin, name })
            continue
          }
          const init = await fn(input)
          if (init && typeof init === "object") {
            hooks.push(init)
            log.info("plugin loaded successfully", { plugin, name })
          } else {
            log.warn("plugin returned invalid hooks", { plugin, name })
          }
        }
      } catch (error) {
        log.error("failed to load plugin", {
          plugin,
          error: error instanceof Error ? error.message : String(error),
        })
        // DEBUG: Also write to file
        try {
          const fs = await import("fs/promises")
          await fs.appendFile("/tmp/plugin-errors.log", `[${new Date().toISOString()}] Failed to load ${plugin}: ${error instanceof Error ? error.message : String(error)}\n`)
        } catch {}
      }
    }

    return {
      hooks,
      input,
      subscribed: false,
    }
  })

  export async function trigger<
    Name extends Exclude<keyof Required<Hooks>, "auth" | "event" | "tool">,
    Input = Parameters<Required<Hooks>[Name]>[0],
    Output = Parameters<Required<Hooks>[Name]>[1],
  >(name: Name, input: Input, output: Output): Promise<Output> {
    if (!name) return output
    const hooks = await state().then((x) => x.hooks)
    for (const hook of hooks) {
      const fn = hook[name]
      if (!fn) continue
      try {
        // Type assertion needed due to complex conditional hook typing
        await (fn as (input: Input, output: Output) => Promise<void>)(input, output)
      } catch (error) {
        log.error("hook trigger failed", {
          hook: name,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    return output
  }

  export async function list() {
    return state().then((x) => x.hooks)
  }

  export async function init() {
    const pluginState = await state()
    const config = await Config.get()
    for (const hook of pluginState.hooks) {
      await hook.config?.(config)
    }
    // Only subscribe once per plugin instance to prevent duplicate event firing
    if (!pluginState.subscribed) {
      pluginState.subscribed = true
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
}
