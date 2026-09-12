import { intro, log, outro, spinner } from "@clack/prompts"
import { Effect } from "effect"
import path from "path"
import { applyEdits, modify, parse as parseJsonc, printParseErrorCode } from "jsonc-parser"
import type { ParseError as JsoncParseError } from "jsonc-parser"

import { ConfigPaths } from "@/config/paths"
import { Global } from "@opencode-ai/core/global"
import { installPlugin, patchPluginConfig, readPluginManifest } from "../../plugin/install"
import { resolvePluginTarget } from "../../plugin/shared"
import * as ConfigPlugin from "@/config/plugin"
import { parsePluginSpecifier } from "../../plugin/shared"
import { errorMessage } from "../../util/error"
import { Filesystem } from "@/util/filesystem"
import { Flock } from "@opencode-ai/core/util/flock"
import { Process } from "@/util/process"
import { UI } from "../ui"
import { cmd } from "./cmd"
import { effectCmd } from "../effect-cmd"
import { InstanceRef } from "@/effect/instance-ref"
import { Config } from "@/config/config"

type Spin = {
  start: (msg: string) => void
  stop: (msg: string, code?: number) => void
}

export type PlugDeps = {
  spinner: () => Spin
  log: {
    error: (msg: string) => void
    info: (msg: string) => void
    success: (msg: string) => void
  }
  resolve: (spec: string) => Promise<string>
  readText: (file: string) => Promise<string>
  write: (file: string, text: string) => Promise<void>
  exists: (file: string) => Promise<boolean>
  files: (dir: string, name: "opencode" | "tui") => string[]
  global: string
}

export type PlugInput = {
  mod: string
  global?: boolean
  force?: boolean
}

export type PlugCtx = {
  vcs?: string
  worktree: string
  directory: string
}

const defaultPlugDeps: PlugDeps = {
  spinner: () => spinner(),
  log: {
    error: (msg) => log.error(msg),
    info: (msg) => log.info(msg),
    success: (msg) => log.success(msg),
  },
  resolve: (spec) => resolvePluginTarget(spec),
  readText: (file) => Filesystem.readText(file),
  write: async (file, text) => {
    await Filesystem.write(file, text)
  },
  exists: (file) => Filesystem.exists(file),
  files: (dir, name) => ConfigPaths.fileInDirectory(dir, name),
  global: Global.Path.config,
}

function cause(err: unknown) {
  if (!err || typeof err !== "object") return
  if (!("cause" in err)) return
  return (err as { cause?: unknown }).cause
}

export function createPlugTask(input: PlugInput, dep: PlugDeps = defaultPlugDeps) {
  const mod = input.mod
  const force = Boolean(input.force)
  const global = Boolean(input.global)

  return async (ctx: PlugCtx) => {
    const install = dep.spinner()
    install.start("Installing plugin package...")
    const target = await installPlugin(mod, dep)
    if (!target.ok) {
      install.stop("Install failed", 1)
      dep.log.error(`Could not install "${mod}"`)
      const hit = cause(target.error) ?? target.error
      if (hit instanceof Process.RunFailedError) {
        const lines = hit.stderr
          .toString()
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
        const errs = lines.filter((line) => line.startsWith("error:")).map((line) => line.replace(/^error:\s*/, ""))
        const detail = errs[0] ?? lines.at(-1)
        if (detail) dep.log.error(detail)
        if (lines.some((line) => line.includes("No version matching"))) {
          dep.log.info("This package depends on a version that is not available in your npm registry.")
          dep.log.info("Check npm registry/auth settings and try again.")
        }
      }
      if (!(hit instanceof Process.RunFailedError)) {
        dep.log.error(errorMessage(hit))
      }
      return false
    }
    install.stop("Plugin package ready")

    const inspect = dep.spinner()
    inspect.start("Reading plugin manifest...")
    const manifest = await readPluginManifest(target.target)
    if (!manifest.ok) {
      if (manifest.code === "manifest_read_failed") {
        inspect.stop("Manifest read failed", 1)
        dep.log.error(`Installed "${mod}" but failed to read ${manifest.file}`)
        dep.log.error(errorMessage(cause(manifest.error) ?? manifest.error))
        return false
      }

      if (manifest.code === "manifest_no_targets") {
        inspect.stop("No plugin targets found", 1)
        dep.log.error(`"${mod}" does not expose plugin entrypoints in package.json`)
        dep.log.info(
          'Expected one of: exports["./tui"], exports["./server"], package.json main for server, or package.json["oc-themes"] for tui themes.',
        )
        return false
      }

      inspect.stop("Manifest read failed", 1)
      return false
    }

    inspect.stop(
      `Detected ${manifest.targets.map((item) => item.kind).join(" + ")} target${manifest.targets.length === 1 ? "" : "s"}`,
    )

    const patch = dep.spinner()
    patch.start("Updating plugin config...")
    const out = await patchPluginConfig(
      {
        spec: mod,
        targets: manifest.targets,
        force,
        global,
        vcs: ctx.vcs,
        worktree: ctx.worktree,
        directory: ctx.directory,
        config: dep.global,
      },
      dep,
    )
    if (!out.ok) {
      if (out.code === "invalid_json") {
        patch.stop(`Failed updating ${out.kind} config`, 1)
        dep.log.error(`Invalid JSON in ${out.file} (${out.parse} at line ${out.line}, column ${out.col})`)
        dep.log.info("Fix the config file and run the command again.")
        return false
      }

      patch.stop("Failed updating plugin config", 1)
      dep.log.error(errorMessage(out.error))
      return false
    }
    patch.stop("Plugin config updated")
    for (const item of out.items) {
      if (item.mode === "noop") {
        dep.log.info(`Already configured in ${item.file}`)
        continue
      }
      if (item.mode === "replace") {
        dep.log.info(`Replaced in ${item.file}`)
        continue
      }
      dep.log.info(`Added to ${item.file}`)
    }

    dep.log.success(`Installed ${mod}`)
    dep.log.info(global ? `Scope: global (${out.dir})` : `Scope: local (${out.dir})`)
    return true
  }
}

// --- Install subcommand ---

const PluginInstallCommand = effectCmd({
  command: "install <module>",
  describe: "install plugin and update config",
  builder: (yargs) =>
    yargs
      .positional("module", {
        type: "string",
        describe: "npm module name",
      })
      .option("global", {
        alias: ["g"],
        type: "boolean",
        default: false,
        describe: "install in global config",
      })
      .option("force", {
        alias: ["f"],
        type: "boolean",
        default: false,
        describe: "replace existing plugin version",
      }),
  handler: Effect.fn("Cli.plug.install")(function* (args) {
    const mod = String(args.module ?? "").trim()
    if (!mod) {
      UI.error("module is required")
      process.exitCode = 1
      return
    }

    UI.empty()
    intro(`Install plugin ${mod}`)

    const run = createPlugTask({
      mod,
      global: Boolean(args.global),
      force: Boolean(args.force),
    })

    const ctx = yield* InstanceRef
    if (!ctx) return
    const ok = yield* Effect.promise(() =>
      run({
        vcs: ctx.project.vcs,
        worktree: ctx.worktree,
        directory: ctx.directory,
      }),
    )

    outro("Done")
    if (!ok) process.exitCode = 1
  }),
})

// --- List subcommand ---

const PluginListCommand = effectCmd({
  command: "list",
  aliases: ["ls"],
  describe: "list configured plugins and their status",
  handler: Effect.fn("Cli.plug.list")(function* () {
    const cfgSvc = yield* Config.Service
    const config = yield* cfgSvc.get()

    UI.empty()
    intro("Plugins")

    const plugins = config.plugin ?? []
    const disabledPlugins = new Set((config.disabled_plugins ?? []).map(pluginPackageName))

    if (plugins.length === 0) {
      log.warn("No plugins configured")
      outro("Install plugins with: opencode plugin install <module>")
      return
    }

    for (const spec of plugins) {
      const name = pluginPackageName(spec)
      const disabled = disabledPlugins.has(name)
      const icon = disabled ? "✗" : "✓"
      const status = disabled ? "disabled" : "enabled"
      log.info(`${icon} ${name} (${status})`)
    }

    outro(`${plugins.length} plugin(s) configured`)
  }),
})

// --- Disable subcommand ---

async function findConfigFile(global: boolean, directory: string): Promise<string> {
  const dir = global ? Global.Path.config : directory
  const files = ConfigPaths.fileInDirectory(dir, "opencode")
  for (const file of files) {
    if (await Filesystem.exists(file)) return file
  }
  // Default to first path if none exist
  return files[0]
}

async function readConfigText(file: string): Promise<string> {
  try {
    const text = await Filesystem.readText(file)
    return text.trim() ? text : "{}"
  } catch (err: any) {
    if (err?.code === "ENOENT") return "{}"
    throw err
  }
}

function pluginPackageName(spec: string | readonly [string, unknown]): string {
  const str = Array.isArray(spec) ? spec[0] : spec
  return parsePluginSpecifier(str).pkg
}

function parseFilePlugins(text: string): string[] {
  const errs: JsoncParseError[] = []
  const data = parseJsonc(text, errs, { allowTrailingComma: true })
  if (errs.length) return []
  const plugins = Array.isArray(data?.plugin) ? data.plugin : []
  return plugins.map((spec: unknown) => pluginPackageName(String(spec)))
}

function patchConfigDisabledPlugins(text: string, module: string, action: "add" | "remove"): { text: string; changed: boolean } {
  const errs: JsoncParseError[] = []
  const data = parseJsonc(text, errs, { allowTrailingComma: true })
  if (errs.length) {
    const err = errs[0]
    const lines = text.substring(0, err.offset).split("\n")
    throw new Error(`Invalid JSON at line ${lines.length}, column ${lines[lines.length - 1].length + 1}: ${printParseErrorCode(err.error)}`)
  }

  const current: string[] = Array.isArray(data?.disabled_plugins) ? data.disabled_plugins : []

  if (action === "add") {
    if (current.includes(module)) return { text, changed: false }
    const next = [...current, module]
    const updated = applyEdits(
      text,
      modify(text, ["disabled_plugins"], next, {
        formattingOptions: { tabSize: 2, insertSpaces: true },
      }),
    )
    return { text: updated, changed: true }
  }

  // remove
  if (!current.includes(module)) return { text, changed: false }
  const next = current.filter((item: string) => item !== module)
  const value = next.length > 0 ? next : undefined
  const updated = applyEdits(
    text,
    modify(text, ["disabled_plugins"], value, {
      formattingOptions: { tabSize: 2, insertSpaces: true },
    }),
  )
  return { text: updated, changed: true }
}

const PluginDisableCommand = effectCmd({
  command: "disable <module>",
  describe: "disable a configured plugin without removing it",
  builder: (yargs) =>
    yargs
      .positional("module", {
        type: "string",
        describe: "plugin module name to disable",
      })
      .option("global", {
        alias: ["g"],
        type: "boolean",
        default: false,
        describe: "modify global config",
      }),
  handler: Effect.fn("Cli.plug.disable")(function* (args) {
    const mod = String(args.module ?? "").trim()
    if (!mod) {
      UI.error("module is required")
      process.exitCode = 1
      return
    }

    const ctx = yield* InstanceRef
    if (!ctx) return

    const global = Boolean(args.global)
    const dir = global ? Global.Path.config : ctx.directory
    const normalizedMod = parsePluginSpecifier(mod).pkg

    UI.empty()
    intro(`Disable plugin ${mod}`)

    yield* Effect.acquireUseRelease(
      Effect.promise(() => Flock.acquire(`plug-config:${Filesystem.resolve(path.join(dir, "opencode"))}`)),
      (lock) =>
        Effect.gen(function* () {
          const file = yield* Effect.promise(() => findConfigFile(global, dir))
          const text = yield* Effect.promise(() => readConfigText(file))

          // Validate against the target file, not merged config
          const filePluginNames = parseFilePlugins(text)
          if (!filePluginNames.includes(normalizedMod)) {
            log.error(`Plugin "${mod}" is not configured in ${file}`)
            log.info(`Available plugins: ${filePluginNames.join(", ") || "none"}`)
            process.exitCode = 1
            return
          }

          const result = patchConfigDisabledPlugins(text, normalizedMod, "add")
          if (!result.changed) {
            log.info(`Plugin "${mod}" is already disabled`)
            return
          }
          yield* Effect.promise(() => Filesystem.write(file, result.text))
          log.success(`Plugin "${mod}" disabled in ${file}`)
        }),
      (lock) => Effect.promise(() => lock.release()),
    )
    outro("Done")
  }),
})

// --- Enable subcommand ---

const PluginEnableCommand = effectCmd({
  command: "enable <module>",
  describe: "re-enable a previously disabled plugin",
  builder: (yargs) =>
    yargs
      .positional("module", {
        type: "string",
        describe: "plugin module name to enable",
      })
      .option("global", {
        alias: ["g"],
        type: "boolean",
        default: false,
        describe: "modify global config",
      }),
  handler: Effect.fn("Cli.plug.enable")(function* (args) {
    const mod = String(args.module ?? "").trim()
    if (!mod) {
      UI.error("module is required")
      process.exitCode = 1
      return
    }

    const ctx = yield* InstanceRef
    if (!ctx) return

    const global = Boolean(args.global)
    const dir = global ? Global.Path.config : ctx.directory
    const normalizedMod = parsePluginSpecifier(mod).pkg

    UI.empty()
    intro(`Enable plugin ${mod}`)

    yield* Effect.acquireUseRelease(
      Effect.promise(() => Flock.acquire(`plug-config:${Filesystem.resolve(path.join(dir, "opencode"))}`)),
      (lock) =>
        Effect.gen(function* () {
          const file = yield* Effect.promise(() => findConfigFile(global, dir))
          const text = yield* Effect.promise(() => readConfigText(file))
          const result = patchConfigDisabledPlugins(text, normalizedMod, "remove")
          if (!result.changed) {
            log.info(`Plugin "${mod}" is not disabled in ${file}`)
            return
          }
          yield* Effect.promise(() => Filesystem.write(file, result.text))
          log.success(`Plugin "${mod}" enabled in ${file}`)
        }),
      (lock) => Effect.promise(() => lock.release()),
    )
    outro("Done")
  }),
})

// --- Parent command ---

export const PluginCommand = cmd({
  command: "plugin [module]",
  aliases: ["plug"],
  describe: "manage plugins (install, list, disable, enable)",
  builder: (yargs) =>
    yargs
      .command(PluginInstallCommand)
      .command(PluginListCommand)
      .command(PluginDisableCommand)
      .command(PluginEnableCommand)
      .positional("module", {
        type: "string",
        describe: "npm module name (shorthand for install)",
      }),
  async handler(args) {
    const mod = String(args.module ?? "").trim()
    if (!mod) {
      // No subcommand and no module → show help
      return
    }
    // Backward compat: `opencode plugin <module>` → hint to use install
    log.info(`To install a plugin, use: opencode plugin install ${mod}`)
  },
})
