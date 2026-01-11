import type { Hooks as HooksV1, PluginInput as PluginInputV1, Plugin as PluginInstance } from "@opencode-ai/plugin"
import type { Hooks as HooksV2, PluginInput as PluginInputV2 } from "@opencode-ai/plugin/v2"
import { Config } from "../config/config"
import { Bus } from "../bus"
import { Log } from "../util/log"
import { createOpencodeClient as createOpencodeClientV1 } from "@opencode-ai/sdk"
import { createOpencodeClient as createOpencodeClientV2 } from "@opencode-ai/sdk/v2"
import { Server } from "../server/server"
import { BunProc } from "../bun"
import { Instance } from "../project/instance"
import { Flag } from "../flag/flag"
import { CodexAuthPlugin } from "./codex"

type Hooks = HooksV1 | HooksV2

export namespace Plugin {
  const log = Log.create({ service: "plugin" })

  const BUILTIN = ["opencode-copilot-auth@0.0.11", "opencode-anthropic-auth@0.0.8"]

  // Built-in plugins that are directly imported (not installed from npm)
  const INTERNAL_PLUGINS: PluginInstance[] = [CodexAuthPlugin]

  const state = Instance.state(async () => {
    // Create both v1 and v2 clients for backward compatibility
    const clientV1 = createOpencodeClientV1({
      baseUrl: "http://localhost:4096",
      // @ts-ignore - fetch type incompatibility
      fetch: async (...args) => Server.App().fetch(...args),
    })
    const clientV2 = createOpencodeClientV2({
      baseUrl: "http://localhost:4096",
      // @ts-ignore - fetch type incompatibility
      fetch: async (...args) => Server.App().fetch(...args),
    })

    const config = await Config.get()
    const hooks: Hooks[] = []

    // Base input shared between v1 and v2
    const baseInput = {
      project: Instance.project,
      worktree: Instance.worktree,
      directory: Instance.directory,
      serverUrl: Server.url(),
      $: Bun.$,
    }

    const inputV1: PluginInputV1 = { client: clientV1, ...baseInput }
    const inputV2: PluginInputV2 = { client: clientV2, ...baseInput }

    // Load internal plugins first (use v2 client)
    if (!Flag.OPENCODE_DISABLE_DEFAULT_PLUGINS) {
      for (const plugin of INTERNAL_PLUGINS) {
        log.info("loading internal plugin", { name: plugin.name })
        const init = await plugin(inputV1)
        hooks.push(init)
      }
    }

    const plugins = [...(config.plugin ?? [])]
    if (!Flag.OPENCODE_DISABLE_DEFAULT_PLUGINS) {
      plugins.push(...BUILTIN)
    }
    for (let plugin of plugins) {
      // ignore old codex plugin since it is supported first party now
      if (plugin.includes("opencode-openai-codex-auth")) continue
      log.info("loading plugin", { path: plugin })
      if (!plugin.startsWith("file://")) {
        const lastAtIndex = plugin.lastIndexOf("@")
        const pkg = lastAtIndex > 0 ? plugin.substring(0, lastAtIndex) : plugin
        const pkgVersion = lastAtIndex > 0 ? plugin.substring(lastAtIndex + 1) : "latest"
        const builtin = BUILTIN.some((x) => x.startsWith(pkg + "@"))
        plugin = await BunProc.install(pkg, pkgVersion).catch((err) => {
          if (builtin) return ""
          throw err
        })
        if (!plugin) continue
      }
      const mod = await import(plugin)

      // Check if plugin exports version = 2 for v2 SDK
      const isV2Plugin = mod.version === 2

      log.info("detected plugin version", { path: plugin, version: isV2Plugin ? 2 : 1 })

      // Prevent duplicate initialization when plugins export the same function
      // as both a named export and default export (e.g., `export const X` and `export default X`).
      // Object.entries(mod) would return both entries pointing to the same function reference.
      const seen = new Set<Function>()
      for (const [_name, fn] of Object.entries(mod)) {
        if (typeof fn !== "function") continue
        if (seen.has(fn)) continue
        seen.add(fn)
        // Call with appropriate input based on plugin version
        const init = isV2Plugin
          ? await (fn as (input: PluginInputV2) => Promise<HooksV2>)(inputV2)
          : await (fn as (input: PluginInputV1) => Promise<HooksV1>)(inputV1)
        hooks.push(init)
      }
    }

    return {
      hooks,
      inputV1,
      inputV2,
    }
  })

  export async function trigger<
    Name extends Exclude<keyof Required<Hooks>, "auth" | "event" | "tool">,
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
        hook["event"]?.({
          event: input,
        })
      }
    })
  }
}
