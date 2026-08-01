import { intro, log, outro, spinner } from "@clack/prompts"
import { Effect } from "effect"
import path from "path"

import { ConfigPaths } from "@/config/paths"
import { Global } from "@opencode-ai/core/global"
import { installPlugin, patchPluginConfig, readPluginManifest } from "../../plugin/install"
import { resolvePluginTarget } from "../../plugin/shared"
import { errorMessage } from "../../util/error"
import { Filesystem } from "@/util/filesystem"
import { Process } from "@/util/process"
import { UI } from "../ui"
import { cmd } from "./cmd"
import { effectCmd } from "../effect-cmd"
import { InstanceRef } from "@/effect/instance-ref"
import {
  createMarketplaceSource,
  upsertMarketplaceSource,
  type MarketplaceConfiguredTrust,
  type MarketplaceHostConfig,
  type MarketplaceMutationResult,
} from "@opencode-ai/core/marketplace"
import { exportMarketplaceProfile } from "@opencode-ai/core/marketplace-profile"
import { Config } from "@/config/config"
import * as MarketplaceRegistry from "@/marketplace/registry"
import { resolveMarketplaceSourceReference } from "@/marketplace/source"
import { MarketplaceService } from "@/marketplace/service"
import { parseMarketplaceLock } from "@opencode-ai/core/marketplace-lock"

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

const PluginInstallCommand = effectCmd({
  command: "$0 <module>",
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
  handler: Effect.fn("Cli.plug")(function* (args) {
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

const PluginMarketplaceAddCommand = effectCmd({
  command: "add <url>",
  describe: "add a plugin marketplace catalog",
  builder: (yargs) =>
    yargs
      .positional("url", {
        type: "string",
        describe: "catalog URL or Git repository URL",
        demandOption: true,
      })
      .option("name", {
        type: "string",
        describe: "catalog display name",
      })
      .option("trust", {
        type: "string",
        choices: ["community", "private"] as const,
        default: "community" as const,
        describe: "catalog trust level",
      }),
  handler: Effect.fn("Cli.plugin.marketplace.add")(function* (args) {
    const config = yield* Config.Service
    const registry = yield* MarketplaceRegistry.Service
    const resolved = yield* Effect.promise(() => resolveMarketplaceSourceReference(String(args.url)))
    const source = {
      ...createMarketplaceSource({
        url: resolved.url,
        name: args.name ? String(args.name) : resolved.name,
        trust: args.trust as MarketplaceConfiguredTrust,
      }),
      reference: resolved.reference,
    }
    const current = yield* registry.read()
    const next = upsertMarketplaceSource({ marketplace: current } as MarketplaceHostConfig, source).marketplace!
    const result = yield* registry.replace(next).pipe(Effect.orDie)
    if (result.changed) yield* config.invalidate()
    log.success(`${result.changed ? "Added" : "Already configured"} marketplace ${source.name}`)
    log.info(source.reference ?? source.url)
  }),
})

const PluginMarketplaceExportCommand = effectCmd({
  command: "export [file]",
  describe: "export the installed marketplace set as a portable profile",
  builder: (yargs) =>
    yargs
      .positional("file", {
        type: "string",
        describe: "output file; omit to print JSON to stdout",
      })
      .option("name", {
        type: "string",
        default: "default",
        describe: "profile name",
      }),
  handler: Effect.fn("Cli.plugin.marketplace.export")(function* (args) {
    const registry = yield* MarketplaceRegistry.Service
    const profile = exportMarketplaceProfile(yield* registry.read(), { name: String(args.name) })
    const output = `${JSON.stringify(profile, null, 2)}\n`
    if (args.file) {
      const file = path.resolve(String(args.file))
      yield* Effect.promise(() => Filesystem.write(file, output))
      log.success(`Exported marketplace profile to ${file}`)
      return
    }
    process.stdout.write(output)
  }),
})

function reportMarketplaceMutation(result: MarketplaceMutationResult, success: string) {
  if (!result.ok) {
    log.error(result.message)
    process.exitCode = 1
    return false
  }
  log.success(success)
  return true
}

const PluginMarketplaceListCommand = effectCmd({
  command: "list",
  describe: "list marketplace items and installation status",
  builder: (yargs) => yargs.option("refresh", { type: "boolean", default: false }),
  handler: Effect.fn("Cli.plugin.marketplace.list")(function* (args) {
    const marketplace = yield* MarketplaceService
    const view = yield* marketplace.get({ refresh: Boolean(args.refresh) })
    for (const listing of view.listings) {
      const installed = view.state.installed?.[listing.key]
      log.info(`${installed ? "installed" : "available"}\t${listing.key}\t${listing.item.name}@${listing.item.version}`)
    }
    for (const error of view.errors) log.warn(`${error.source.name}: ${error.message}`)
  }),
})

const PluginMarketplaceInstallCommand = effectCmd({
  command: "install <key>",
  describe: "plan and install a marketplace item",
  builder: (yargs) =>
    yargs
      .positional("key", { type: "string", demandOption: true })
      .option("force", { type: "boolean", default: false })
      .option("accept-untrusted", { type: "boolean", default: false }),
  handler: Effect.fn("Cli.plugin.marketplace.install")(function* (args) {
    const marketplace = yield* MarketplaceService
    const plan = yield* marketplace.plan(String(args.key))
    if (!plan.ok) {
      log.error(plan.message)
      process.exitCode = 1
      return
    }
    log.info(`${plan.summary}; plan ${plan.plan_digest}`)
    reportMarketplaceMutation(
      yield* marketplace.install({
        planId: plan.plan_id,
        expectedRevision: (yield* marketplace.get()).state.revision ?? 0,
        force: Boolean(args.force),
        acceptUntrusted: Boolean(args.acceptUntrusted),
      }),
      `${plan.action === "update" ? "Updated" : "Installed"} ${plan.key}`,
    )
  }),
})

const PluginMarketplaceUpdateCommand = effectCmd({
  command: "update",
  describe: "atomically update all installed marketplace items",
  builder: (yargs) =>
    yargs
      .option("force", { type: "boolean", default: false })
      .option("accept-untrusted", { type: "boolean", default: false }),
  handler: Effect.fn("Cli.plugin.marketplace.update")(function* (args) {
    const marketplace = yield* MarketplaceService
    reportMarketplaceMutation(
      yield* marketplace.updateAll({
        expectedRevision: (yield* marketplace.get()).state.revision ?? 0,
        force: Boolean(args.force),
        acceptUntrusted: Boolean(args.acceptUntrusted),
      }),
      "Marketplace packages updated",
    )
  }),
})

const PluginMarketplaceImportCommand = effectCmd({
  command: "import <file>",
  describe: "plan and apply a Marketplace profile",
  builder: (yargs) =>
    yargs
      .positional("file", { type: "string", demandOption: true })
      .option("mode", { type: "string", choices: ["merge", "replace"] as const, default: "merge" as const })
      .option("force", { type: "boolean", default: false })
      .option("accept-untrusted", { type: "boolean", default: false }),
  handler: Effect.fn("Cli.plugin.marketplace.import")(function* (args) {
    const marketplace = yield* MarketplaceService
    const profile = yield* Effect.promise(() => Bun.file(path.resolve(String(args.file))).json() as Promise<unknown>)
    const plan = yield* marketplace.profilePlan({ profile, mode: args.mode })
    if (!plan.ok) {
      log.error(plan.message)
      process.exitCode = 1
      return
    }
    log.info(`${plan.actions.length} package action${plan.actions.length === 1 ? "" : "s"} prepared`)
    reportMarketplaceMutation(
      yield* marketplace.profileApply({
        planId: plan.plan_id,
        expectedRevision: (yield* marketplace.get()).state.revision ?? 0,
        force: Boolean(args.force),
        acceptUntrusted: Boolean(args.acceptUntrusted),
      }),
      "Marketplace profile applied",
    )
  }),
})

const PluginMarketplaceLockCommand = effectCmd({
  command: "lock [file]",
  describe: "export an exact Marketplace artifact lock",
  builder: (yargs) => yargs.positional("file", { type: "string" }),
  handler: Effect.fn("Cli.plugin.marketplace.lock")(function* (args) {
    const lock = yield* (yield* MarketplaceService).lockExport()
    const output = `${JSON.stringify(lock, null, 2)}\n`
    if (!args.file) {
      process.stdout.write(output)
      return
    }
    const file = path.resolve(String(args.file))
    yield* Effect.promise(() => Filesystem.write(file, output))
    log.success(`Exported Marketplace lock to ${file}`)
  }),
})

const PluginMarketplaceVerifyCommand = effectCmd({
  command: "verify <file>",
  describe: "verify installed packages against a Marketplace lock",
  builder: (yargs) => yargs.positional("file", { type: "string", demandOption: true }),
  handler: Effect.fn("Cli.plugin.marketplace.verify")(function* (args) {
    const value = yield* Effect.promise(() => Bun.file(path.resolve(String(args.file))).json() as Promise<unknown>)
    const result = yield* (yield* MarketplaceService).lockVerify(parseMarketplaceLock(value))
    if (result.ok) {
      log.success("Marketplace lock verified")
      return
    }
    for (const error of result.errors) log.error(error)
    process.exitCode = 1
  }),
})

const PluginMarketplaceCommand = cmd({
  command: "marketplace",
  describe: "manage plugin marketplace catalogs",
  builder: (yargs) =>
    yargs
      .command(PluginMarketplaceAddCommand)
      .command(PluginMarketplaceListCommand)
      .command(PluginMarketplaceInstallCommand)
      .command(PluginMarketplaceUpdateCommand)
      .command(PluginMarketplaceExportCommand)
      .command(PluginMarketplaceImportCommand)
      .command(PluginMarketplaceLockCommand)
      .command(PluginMarketplaceVerifyCommand)
      .demandCommand(),
  async handler() {},
})

export const PluginCommand = cmd({
  command: "plugin",
  aliases: ["plug"],
  describe: "install plugins and manage plugin marketplaces",
  builder: (yargs) => yargs.command(PluginMarketplaceCommand).command(PluginInstallCommand).demandCommand(),
  async handler() {},
})
