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
import { CopilotAuthPlugin } from "./copilot"
import { gitlabAuthPlugin as GitlabAuthPlugin } from "@gitlab/opencode-gitlab-auth"
import { Filesystem } from "../util/filesystem"
import path from "path"

export namespace Plugin {
  const log = Log.create({ service: "plugin" })

  const BUILTIN = ["opencode-anthropic-auth@0.0.13"]

  // Built-in plugins that are directly imported (not installed from npm)
  const INTERNAL_PLUGINS: PluginInstance[] = [CodexAuthPlugin, CopilotAuthPlugin, GitlabAuthPlugin]

  const state = Instance.state(async () => {
    const client = createOpencodeClient({
      baseUrl: "http://localhost:4096",
      directory: Instance.directory,
      fetch: async (...args) => Server.Default().fetch(...args),
    })
    const config = await Config.get()
    const hooks: Hooks[] = []
    const input: PluginInput = {
      client,
      project: Instance.project,
      worktree: Instance.worktree,
      directory: Instance.directory,
      get serverUrl(): URL {
        return Server.url ?? new URL("http://localhost:4096")
      },
      $: Bun.$,
    }

    for (const plugin of INTERNAL_PLUGINS) {
      log.info("loading internal plugin", { name: plugin.name })
      const init = await plugin(input).catch((err) => {
        log.error("failed to load internal plugin", { name: plugin.name, error: err })
      })
      if (init) hooks.push(init)
    }

    let plugins = config.plugin ?? []
    if (plugins.length) await Config.waitForDependencies()
    if (!Flag.OPENCODE_DISABLE_DEFAULT_PLUGINS) {
      plugins = [...BUILTIN, ...plugins]
    }

    for (let plugin of plugins) {
      // ignore old codex plugin since it is supported first party now
      if (plugin.includes("opencode-openai-codex-auth") || plugin.includes("opencode-copilot-auth")) continue
      log.info("loading plugin", { path: plugin })
      if (!plugin.startsWith("file://")) {
        const { name: pkg, subpath, version } = parsePluginSpecifier(plugin)
        let installed = await BunProc.install(pkg, version).catch((err) => {
          const cause = err instanceof Error ? err.cause : err
          const detail = cause instanceof Error ? cause.message : String(cause ?? err)
          log.error("failed to install plugin", { pkg, version, error: detail })
          Bus.publish(Session.Event.Error, {
            error: new NamedError.Unknown({
              message: `Failed to install plugin ${pkg}@${version}: ${detail}`,
            }).toObject(),
          })
          return ""
        })
        if (!installed) continue
        plugin = subpath ? await resolveSubpath(installed, subpath) : installed
      }
      // Prevent duplicate initialization when plugins export the same function
      // as both a named export and default export (e.g., `export const X` and `export default X`).
      // Object.entries(mod) would return both entries pointing to the same function reference.
      await import(plugin)
        .then(async (mod) => {
          const seen = new Set<PluginInstance>()
          for (const [_name, fn] of Object.entries<PluginInstance>(mod)) {
            if (seen.has(fn)) continue
            seen.add(fn)
            hooks.push(await fn(input))
          }
        })
        .catch((err) => {
          const message = err instanceof Error ? err.message : String(err)
          log.error("failed to load plugin", { path: plugin, error: message })
          Bus.publish(Session.Event.Error, {
            error: new NamedError.Unknown({
              message: `Failed to load plugin ${plugin}: ${message}`,
            }).toObject(),
          })
        })
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

  /**
   * Parse a plugin specifier into package name, optional subpath, and version.
   *
   * Examples:
   *   "websxa"                  → { name: "websxa",      subpath: null,      version: "latest" }
   *   "websxa/opencode"         → { name: "websxa",      subpath: "opencode", version: "latest" }
   *   "websxa@1.0.0"            → { name: "websxa",      subpath: null,      version: "1.0.0"  }
   *   "websxa/opencode@1.0.0"   → { name: "websxa",      subpath: "opencode", version: "1.0.0"  }
   *   "@scope/pkg"              → { name: "@scope/pkg",  subpath: null,      version: "latest" }
   *   "@scope/pkg/sub"          → { name: "@scope/pkg",  subpath: "sub",     version: "latest" }
   *   "@scope/pkg/sub@2.0.0"    → { name: "@scope/pkg",  subpath: "sub",     version: "2.0.0"  }
   */
  function parsePluginSpecifier(specifier: string): { name: string; subpath: string | null; version: string } {
    let version = "latest"
    const lastAtIndex = specifier.lastIndexOf("@")
    // For scoped packages, @ at position 0 is the scope prefix, not a version separator
    if (lastAtIndex > 0) {
      version = specifier.substring(lastAtIndex + 1)
      specifier = specifier.substring(0, lastAtIndex)
    }

    if (specifier.startsWith("@")) {
      // Scoped: @scope/name or @scope/name/subpath
      const parts = specifier.split("/")
      const name = parts.slice(0, 2).join("/")
      const subpath = parts.length > 2 ? parts.slice(2).join("/") : null
      return { name, subpath, version }
    }

    // Unscoped: name or name/subpath
    const slashIndex = specifier.indexOf("/")
    if (slashIndex > 0) {
      return { name: specifier.substring(0, slashIndex), subpath: specifier.substring(slashIndex + 1), version }
    }
    return { name: specifier, subpath: null, version }
  }

  /**
   * Resolve a subpath export from an installed package.
   * Reads the package's exports map and resolves the file path.
   * Falls back to direct path concatenation if no exports map is found.
   */
  async function resolveSubpath(installed: string, subpath: string): Promise<string> {
    const pkgJson = await Filesystem.readJson<{ exports?: Record<string, unknown> }>(
      path.join(installed, "package.json"),
    ).catch(() => null)

    const entry = pkgJson?.exports?.[`./${subpath}`]
    const resolved = resolveExportEntry(entry)
    if (resolved) return path.join(installed, resolved)

    // Fallback: direct path (works for packages without an exports map)
    return path.join(installed, subpath)
  }

  /** Extract an import path from a package.json exports entry. */
  function resolveExportEntry(entry: unknown): string | null {
    if (typeof entry === "string") return entry
    if (entry && typeof entry === "object") {
      const obj = entry as Record<string, unknown>
      if (typeof obj.import === "string") return obj.import
      if (typeof obj.default === "string") return obj.default
    }
    return null
  }
}