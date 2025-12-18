import { type Hooks, type PluginInput, type Plugin as PluginFunction, type PluginDefinition, type PluginScope } from "@opencode-ai/plugin"
import { Config } from "../config/config"
import { Bus } from "../bus"
import { Log } from "../util/log"
import { createOpencodeClient } from "@opencode-ai/sdk"
import { Server } from "../server/server"
import { BunProc } from "../bun"
import { Instance } from "../project/instance"
import { Flag } from "../flag/flag"

// Built-in auth plugins that should always load (global scope)
// TODO: Remove once these plugins are updated to use definePlugin({ scope: "global" })
const BUILTIN_GLOBAL_PLUGINS = ["opencode-copilot-auth", "opencode-anthropic-auth"]
function isPluginDefinition(value: unknown): value is PluginDefinition {
  return (
    typeof value === "object" &&
    value !== null &&
    "plugin" in value &&
    typeof value.plugin === "function"
  )
}
export namespace Plugin {
  const log = Log.create({ service: "plugin" })

  const state = Instance.state(async () => {
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
      $: Bun.$,
    }
    const plugins = [...(config.plugin ?? [])]
    if (!Flag.OPENCODE_DISABLE_DEFAULT_PLUGINS) {
      plugins.push("opencode-copilot-auth@0.0.9")
      plugins.push("opencode-anthropic-auth@0.0.5")
    }

    const isNonProjectContext = Instance.worktree === "/"

    for (let plugin of plugins) {
      log.info("loading plugin", { path: plugin })
      if (!plugin.startsWith("file://")) {
        const lastAtIndex = plugin.lastIndexOf("@")
        const pkg = lastAtIndex > 0 ? plugin.substring(0, lastAtIndex) : plugin
        const version = lastAtIndex > 0 ? plugin.substring(lastAtIndex + 1) : "latest"
        plugin = await BunProc.install(pkg, version)
      }

      const isBuiltinGlobal = BUILTIN_GLOBAL_PLUGINS.some(name => plugin.includes(name))
      const mod = await import(plugin)

      for (const [_name, exported] of Object.entries(mod)) {
        if (isPluginDefinition(exported)) {
          const scope = exported.scope ?? "project"
          if (scope === "project" && isNonProjectContext) continue
          hooks.push(await exported.plugin(input))
          continue
        }
        if (typeof exported === "function") {
          // Built-in auth plugins are global, others default to project
          if (!isBuiltinGlobal && isNonProjectContext) continue
          hooks.push(await (exported as PluginFunction)(input))
        }
      }
    }
    return {
      hooks,
      input,
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
