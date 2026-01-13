import type { Hooks, PluginInput, Plugin as PluginInstance } from "@opencode-ai/plugin"
import { Config } from "../config/config"
import { Bus } from "../bus"
import { Log } from "../util/log"
import { createOpencodeClient } from "@opencode-ai/sdk"
import { Server } from "../server/server"
import { BunProc } from "../bun"
import { Instance } from "../project/instance"
import { Flag } from "../flag/flag"
import { CodexAuthPlugin } from "./codex"
import { Session } from "../session"
import { NamedError } from "@opencode-ai/util/error"

export namespace Plugin {
  const log = Log.create({ service: "plugin" })

  const BUILTIN = [
    "opencode-copilot-auth@0.0.12",
    "opencode-anthropic-auth@0.0.8",
    "@gitlab/opencode-gitlab-auth@1.3.0",
  ]

  /**
   * Maps plugin package names to human-readable descriptions of what
   * authentication methods they provide. Used for user-facing error messages.
   */
  const PLUGIN_AUTH_DESCRIPTIONS: Record<string, string> = {
    "opencode-copilot-auth": "GitHub Copilot OAuth",
    "opencode-anthropic-auth": "Anthropic OAuth (Claude Max/Pro)",
    "@gitlab/opencode-gitlab-auth": "GitLab Duo OAuth",
  }

  /**
   * Tracks plugins that failed to install, including the package name,
   * version, error message, and the affected authentication method.
   */
  export interface FailedPlugin {
    pkg: string
    version: string
    error: string
    authMethod: string
  }

  const failedPlugins: FailedPlugin[] = []

  /**
   * Returns the list of plugins that failed to install.
   * Useful for diagnostic purposes and showing users which
   * authentication methods are unavailable.
   */
  export function getFailedPlugins(): readonly FailedPlugin[] {
    return [...failedPlugins]
  }

  /**
   * Returns the human-readable auth method description for a plugin package.
   * Falls back to the package name if no description is defined.
   */
  export function getAuthDescription(pkg: string): string {
    return PLUGIN_AUTH_DESCRIPTIONS[pkg] ?? pkg
  }

  /** @internal For testing purposes only */
  export const _test = {
    trackFailure(failure: FailedPlugin) {
      failedPlugins.push(failure)
    },
    clearFailures() {
      failedPlugins.length = 0
    },
  }

  // Built-in plugins that are directly imported (not installed from npm)
  const INTERNAL_PLUGINS: PluginInstance[] = [CodexAuthPlugin]

  const state = Instance.state(async () => {
    const client = createOpencodeClient({
      baseUrl: "http://localhost:4096",
      // @ts-ignore - fetch type incompatibility
      fetch: async (...args) => Server.App().fetch(...args),
    })
    const config = await Config.get()
    const hooks: Hooks[] = []
    const input: PluginInput = {
      client,
      project: Instance.project,
      worktree: Instance.worktree,
      directory: Instance.directory,
      serverUrl: Server.url(),
      $: Bun.$,
    }

    for (const plugin of INTERNAL_PLUGINS) {
      log.info("loading internal plugin", { name: plugin.name })
      const init = await plugin(input)
      hooks.push(init)
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
        const version = lastAtIndex > 0 ? plugin.substring(lastAtIndex + 1) : "latest"
        const builtin = BUILTIN.some((x) => x.startsWith(pkg + "@"))
        plugin = await BunProc.install(pkg, version).catch((err) => {
          if (!builtin) throw err

          const message = err instanceof Error ? err.message : String(err)
          const authMethod = PLUGIN_AUTH_DESCRIPTIONS[pkg] ?? pkg

          // Track the failed plugin for diagnostic access
          failedPlugins.push({
            pkg,
            version,
            error: message,
            authMethod,
          })

          log.error("failed to install builtin plugin", {
            pkg,
            version,
            authMethod,
            error: message,
          })

          // Build a user-friendly error message with troubleshooting steps
          const troubleshootingSteps = [
            `The "${authMethod}" authentication option will not be available.`,
            "",
            "Troubleshooting steps:",
            "  1. Check your network connection",
            "  2. If using a corporate npm proxy (JFrog, Artifactory, Nexus), verify your .npmrc configuration",
            "  3. Try running: npm config list",
            "  4. Check if the registry is accessible: npm ping",
            "  5. Review proxy settings: HTTP_PROXY, HTTPS_PROXY environment variables",
          ].join("\n")

          const detailedMessage = [
            `Failed to install authentication plugin: ${pkg}@${version}`,
            "",
            troubleshootingSteps,
            "",
            `Error details: ${message}`,
          ].join("\n")

          Bus.publish(Session.Event.Error, {
            error: new NamedError.Unknown({
              message: detailedMessage,
            }).toObject(),
          })

          return ""
        })
        if (!plugin) continue
      }
      const mod = await import(plugin)
      // Prevent duplicate initialization when plugins export the same function
      // as both a named export and default export (e.g., `export const X` and `export default X`).
      // Object.entries(mod) would return both entries pointing to the same function reference.
      const seen = new Set<PluginInstance>()
      for (const [_name, fn] of Object.entries<PluginInstance>(mod)) {
        if (seen.has(fn)) continue
        seen.add(fn)
        const init = await fn(input)
        hooks.push(init)
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
