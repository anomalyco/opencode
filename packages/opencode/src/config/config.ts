import { Log } from "../util/log"
import path from "path"
import { Filesystem } from "../util/filesystem"
import { mergeDeep, unique } from "remeda"
import { Global } from "../global"
import { Flag } from "../flag/flag"
import { Auth } from "../auth"
import { Instance } from "../project/instance"
import { existsSync } from "fs"
import { GlobalBus } from "@/bus/global"
import { Event } from "../server/event"
import { iife } from "@/util/iife"

// --- Import sub-modules ---
import * as Schema from "./schema"
import * as Loader from "./loader"
import * as Plugin from "./plugin"
import { applyMigrations } from "./migration"

export namespace Config {
  const log = Log.create({ service: "config" })

  // Managed settings directory for enterprise deployments (highest priority, admin-controlled)
  // These settings override all user and project settings
  function getManagedConfigDir(): string {
    switch (process.platform) {
      case "darwin":
        return "/Library/Application Support/opencode"
      case "win32":
        return path.join(process.env.ProgramData || "C:\\ProgramData", "opencode")
      default:
        return "/etc/opencode"
    }
  }

  const managedConfigDir = process.env.OPENCODE_TEST_MANAGED_CONFIG_DIR || getManagedConfigDir()

  // Custom merge function that concatenates array fields instead of replacing them
  function mergeConfigConcatArrays(target: Info, source: Info): Info {
    const merged = mergeDeep(target, source) as Info
    if (target.plugin && source.plugin) {
      merged.plugin = Array.from(new Set([...target.plugin, ...source.plugin]))
    }
    if (target.instructions && source.instructions) {
      merged.instructions = Array.from(new Set([...target.instructions, ...source.instructions]))
    }
    return merged
  }

  // --- Re-export schemas ---
  export const McpLocal = Schema.McpLocal
  export const McpOAuth = Schema.McpOAuth
  export type McpOAuth = Schema.McpOAuth
  export const McpRemote = Schema.McpRemote
  export const Mcp = Schema.Mcp
  export type Mcp = Schema.Mcp
  export const PermissionAction = Schema.PermissionAction
  export type PermissionAction = Schema.PermissionAction
  export const PermissionObject = Schema.PermissionObject
  export type PermissionObject = Schema.PermissionObject
  export const PermissionRule = Schema.PermissionRule
  export type PermissionRule = Schema.PermissionRule
  export const Permission = Schema.Permission
  export type Permission = Schema.Permission
  export const Command = Schema.Command
  export type Command = Schema.Command
  export const Skills = Schema.Skills
  export type Skills = Schema.Skills
  export const Agent = Schema.Agent
  export type Agent = Schema.Agent
  export const Keybinds = Schema.Keybinds
  export const TUI = Schema.TUI
  export const Server = Schema.Server
  export const Layout = Schema.Layout
  export type Layout = Schema.Layout
  export const Provider = Schema.Provider
  export type Provider = Schema.Provider
  export const Info = Schema.Info
  export type Info = Schema.Info

  // --- Re-export loader ---
  export const JsonError = Loader.JsonError
  export const ConfigDirectoryTypoError = Loader.ConfigDirectoryTypoError
  export const InvalidError = Loader.InvalidError
  export const global = Loader.global

  // --- Re-export plugin ---
  export const getPluginName = Plugin.getPluginName
  export const deduplicatePlugins = Plugin.deduplicatePlugins
  export const installDependencies = Plugin.installDependencies

  // --- State (config loading orchestration) ---

  export const state = Instance.state(async () => {
    const auth = await Auth.all()

    // Config loading order (low -> high precedence): https://opencode.ai/docs/config#precedence-order
    // 1) Remote .well-known/opencode (org defaults)
    // 2) Global config (~/.config/opencode/opencode.json{,c})
    // 3) Custom config (OPENCODE_CONFIG)
    // 4) Project config (opencode.json{,c})
    // 5) .opencode directories (.opencode/agents/, .opencode/commands/, .opencode/plugins/, .opencode/opencode.json{,c})
    // 6) Inline config (OPENCODE_CONFIG_CONTENT)
    // Managed config directory is enterprise-only and always overrides everything above.
    let result: Info = {}
    for (const [key, value] of Object.entries(auth)) {
      if (value.type === "wellknown") {
        process.env[value.key] = value.token
        log.debug("fetching remote config", { url: `${key}/.well-known/opencode` })
        const response = await fetch(`${key}/.well-known/opencode`)
        if (!response.ok) {
          throw new Error(`failed to fetch remote config from ${key}: ${response.status}`)
        }
        const wellknown = (await response.json()) as { config?: Info }
        const remoteConfig = wellknown.config ?? {}
        // Add $schema to prevent load() from trying to write back to a non-existent file
        if (!remoteConfig.$schema) remoteConfig.$schema = "https://opencode.ai/config.json"
        result = mergeConfigConcatArrays(
          result,
          await Loader.load(JSON.stringify(remoteConfig), `${key}/.well-known/opencode`),
        )
        log.debug("loaded remote config from well-known", { url: key })
      }
    }

    // Global user config overrides remote config.
    result = mergeConfigConcatArrays(result, await Loader.global())

    // Custom config path overrides global config.
    if (Flag.OPENCODE_CONFIG) {
      result = mergeConfigConcatArrays(result, await Loader.loadFile(Flag.OPENCODE_CONFIG))
      log.debug("loaded custom config", { path: Flag.OPENCODE_CONFIG })
    }

    // Project config overrides global and remote config.
    if (!Flag.OPENCODE_DISABLE_PROJECT_CONFIG) {
      for (const file of ["opencode.jsonc", "opencode.json"]) {
        const found = await Filesystem.findUp(file, Instance.directory, Instance.worktree)
        for (const resolved of found.toReversed()) {
          result = mergeConfigConcatArrays(result, await Loader.loadFile(resolved))
        }
      }
    }

    result.agent = result.agent || {}
    result.mode = result.mode || {}
    result.plugin = result.plugin || []

    const directories = [
      Global.Path.config,
      // Only scan project .opencode/ directories when project discovery is enabled
      ...(!Flag.OPENCODE_DISABLE_PROJECT_CONFIG
        ? await Array.fromAsync(
            Filesystem.up({
              targets: [".opencode"],
              start: Instance.directory,
              stop: Instance.worktree,
            }),
          )
        : []),
      // Always scan ~/.opencode/ (user home directory)
      ...(await Array.fromAsync(
        Filesystem.up({
          targets: [".opencode"],
          start: Global.Path.home,
          stop: Global.Path.home,
        }),
      )),
    ]

    // .opencode directory config overrides (project and global) config sources.
    if (Flag.OPENCODE_CONFIG_DIR) {
      directories.push(Flag.OPENCODE_CONFIG_DIR)
      log.debug("loading config from OPENCODE_CONFIG_DIR", { path: Flag.OPENCODE_CONFIG_DIR })
    }

    const deps = []

    for (const dir of unique(directories)) {
      if (dir.endsWith(".opencode") || dir === Flag.OPENCODE_CONFIG_DIR) {
        for (const file of ["opencode.jsonc", "opencode.json"]) {
          log.debug(`loading config from ${path.join(dir, file)}`)
          result = mergeConfigConcatArrays(result, await Loader.loadFile(path.join(dir, file)))
          // to satisfy the type checker
          result.agent ??= {}
          result.mode ??= {}
          result.plugin ??= []
        }
      }

      deps.push(
        iife(async () => {
          const shouldInstall = await Plugin.needsInstall(dir)
          if (shouldInstall) await Plugin.installDependencies(dir)
        }),
      )

      result.command = mergeDeep(result.command ?? {}, await Loader.loadCommand(dir))
      result.agent = mergeDeep(result.agent, await Loader.loadAgent(dir))
      result.agent = mergeDeep(result.agent, await Loader.loadMode(dir))
      result.plugin.push(...(await Plugin.loadPlugin(dir)))
    }

    // Inline config content overrides all non-managed config sources.
    if (Flag.OPENCODE_CONFIG_CONTENT) {
      try {
        result = mergeConfigConcatArrays(result, JSON.parse(Flag.OPENCODE_CONFIG_CONTENT))
        log.debug("loaded custom config from OPENCODE_CONFIG_CONTENT")
      } catch (e) {
        log.error("failed to parse OPENCODE_CONFIG_CONTENT", { error: e })
      }
    }

    // Load managed config files last (highest priority) - enterprise admin-controlled
    // Kept separate from directories array to avoid write operations when installing plugins
    // which would fail on system directories requiring elevated permissions
    // This way it only loads config file and not skills/plugins/commands
    if (existsSync(managedConfigDir)) {
      for (const file of ["opencode.jsonc", "opencode.json"]) {
        result = mergeConfigConcatArrays(result, await Loader.loadFile(path.join(managedConfigDir, file)))
      }
    }

    // Apply all migrations and flag overrides
    applyMigrations(result)

    if (!result.keybinds) result.keybinds = Info.shape.keybinds.parse({})

    result.plugin = Plugin.deduplicatePlugins(result.plugin ?? [])

    return {
      config: result,
      directories,
      deps,
    }
  })

  export async function waitForDependencies() {
    const deps = await state().then((x) => x.deps)
    await Promise.all(deps)
  }

  export async function get() {
    return state().then((x) => x.config)
  }

  export async function getGlobal() {
    return Loader.global()
  }

  export async function update(config: Info) {
    const filepath = path.join(Instance.directory, "config.json")
    const existing = await Loader.loadFile(filepath)
    await Bun.write(filepath, JSON.stringify(mergeDeep(existing, config), null, 2))
    await Instance.dispose()
  }

  export async function updateGlobal(config: Info) {
    const filepath = Loader.globalConfigFile()
    const before = await Bun.file(filepath)
      .text()
      .catch((err: any) => {
        if (err.code === "ENOENT") return "{}"
        throw new Loader.JsonError({ path: filepath }, { cause: err })
      })

    const next = await (async () => {
      if (!filepath.endsWith(".jsonc")) {
        const existing = Loader.parseConfig(before, filepath)
        const merged = mergeDeep(existing, config)
        await Bun.write(filepath, JSON.stringify(merged, null, 2))
        return merged
      }

      const updated = Loader.patchJsonc(before, config)
      const merged = Loader.parseConfig(updated, filepath)
      await Bun.write(filepath, updated)
      return merged
    })()

    Loader.global.reset()

    void Instance.disposeAll()
      .catch(() => undefined)
      .finally(() => {
        GlobalBus.emit("event", {
          directory: "global",
          payload: {
            type: Event.Disposed.type,
            properties: {},
          },
        })
      })

    return next
  }

  export async function directories() {
    return state().then((x) => x.directories)
  }
}
