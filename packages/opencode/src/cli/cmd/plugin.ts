import { cmd } from "./cmd"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import { Config } from "../../config/config"
import { Global } from "../../global"
import { BunProc } from "../../bun"
import path from "path"
import fs from "fs/promises"

async function fetchLatestVersion(pkg: string): Promise<string | null> {
  try {
    const encodedPkg = encodeURIComponent(pkg).replace("%40", "@")
    const response = await fetch(`https://registry.npmjs.org/${encodedPkg}/latest`, {
      signal: AbortSignal.timeout(10000),
    })
    if (!response.ok) return null
    const data = (await response.json()) as { version?: string }
    return data.version ?? null
  } catch {
    return null
  }
}

async function getInstalledVersion(pkg: string): Promise<string | null> {
  try {
    const pkgJsonPath = path.join(Global.Path.cache, "node_modules", pkg, "package.json")
    const content = await fs.readFile(pkgJsonPath, "utf-8")
    const data = JSON.parse(content) as { version?: string }
    return data.version ?? null
  } catch {
    return null
  }
}

function extractVersionFromSpecifier(specifier: string): string | null {
  if (specifier.startsWith("file://")) return null
  const lastAt = specifier.lastIndexOf("@")
  if (lastAt > 0) {
    const version = specifier.substring(lastAt + 1)
    return version.length > 0 ? version : null
  }
  return null
}

function getPluginsArray(config: Config.Info): string[] {
  if (!config.plugin) return []
  if (!Array.isArray(config.plugin)) return []
  return config.plugin.filter((p): p is string => typeof p === "string")
}

async function readGlobalConfig(): Promise<{ filePath: string; data: Config.Info }> {
  const filePath = path.join(Global.Path.config, "opencode.json")
  try {
    const text = await fs.readFile(filePath, "utf-8")
    const data = JSON.parse(text) as Config.Info
    return { filePath, data }
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { filePath, data: {} }
    }
    throw err
  }
}

async function writeGlobalConfig(filePath: string, data: Config.Info): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.tmp.${process.pid}`
  await fs.writeFile(tempPath, JSON.stringify(data, null, 2))
  await fs.rename(tempPath, filePath)
}

export const PluginCommand = cmd({
  command: "plugin",
  describe: "manage opencode plugins",
  builder: (yargs) =>
    yargs
      .command(PluginListCommand)
      .command(PluginUpdateCommand)
      .command(PluginAddCommand)
      .command(PluginRemoveCommand)
      .demandCommand(),
  async handler() {},
})

export const PluginListCommand = cmd({
  command: "list",
  aliases: ["ls"],
  describe: "list installed plugins with version information",
  async handler() {
    UI.empty()
    prompts.intro("Installed Plugins")

    const { data: config } = await readGlobalConfig()
    const plugins = getPluginsArray(config)

    if (plugins.length === 0) {
      prompts.log.warn("No plugins configured")
      prompts.outro("Add plugins with: opencode plugin add <name>")
      return
    }

    const spinner = prompts.spinner()
    spinner.start("Checking versions...")

    const results: Array<{
      specifier: string
      name: string
      installed: string | null
      latest: string | null
      isLocal: boolean
    }> = []

    for (const specifier of plugins) {
      const name = Config.getPluginName(specifier)
      const isLocal = specifier.startsWith("file://")

      if (isLocal) {
        results.push({ specifier, name, installed: null, latest: null, isLocal: true })
      } else {
        const [installed, latest] = await Promise.all([getInstalledVersion(name), fetchLatestVersion(name)])
        results.push({ specifier, name, installed, latest, isLocal: false })
      }
    }

    spinner.stop("Version check complete")

    let updatesAvailable = 0
    let fetchFailed = 0
    for (const r of results) {
      let icon: string
      let info: string

      if (r.isLocal) {
        icon = "○"
        info = `${UI.Style.TEXT_DIM}local file`
      } else if (!r.installed) {
        icon = "?"
        info = `${UI.Style.TEXT_DIM}not installed`
      } else if (!r.latest) {
        icon = "!"
        info = `${r.installed} ${UI.Style.TEXT_DIM}(latest unknown)`
        fetchFailed++
      } else if (r.installed !== r.latest) {
        icon = "⬆"
        info = `${r.installed} → ${r.latest}`
        updatesAvailable++
      } else {
        icon = "✓"
        info = `${UI.Style.TEXT_DIM}${r.installed}`
      }

      prompts.log.info(`${icon} ${r.name} ${info}`)
    }

    let summary = `${plugins.length} plugin(s)`
    if (updatesAvailable > 0) {
      summary += `, ${updatesAvailable} update(s) available`
    }
    if (fetchFailed > 0) {
      summary += `, ${fetchFailed} check(s) failed`
    }
    if (updatesAvailable > 0) {
      summary += `. Run: opencode plugin update`
    }
    prompts.outro(summary)
  },
})

export const PluginUpdateCommand = cmd({
  command: "update [name]",
  describe: "update plugins to their latest versions",
  builder: (yargs) =>
    yargs.positional("name", {
      describe: "specific plugin to update (updates all if not specified)",
      type: "string",
    }),
  async handler(args) {
    UI.empty()
    prompts.intro("Update Plugins")

    const { filePath, data: config } = await readGlobalConfig()
    const plugins = getPluginsArray(config)

    if (plugins.length === 0) {
      prompts.log.warn("No plugins configured")
      prompts.outro("Add plugins with: opencode plugin add <name>")
      return
    }

    let targetIndices: number[]
    if (args.name) {
      const targetName = Config.getPluginName(args.name)
      const idx = plugins.findIndex((p) => Config.getPluginName(p) === targetName)
      if (idx === -1) {
        prompts.log.error(`Plugin not found: ${targetName}`)
        prompts.outro("Done")
        return
      }
      targetIndices = [idx]
    } else {
      targetIndices = plugins.map((_, i) => i)
    }

    const spinner = prompts.spinner()
    let updatedCount = 0
    let skippedCount = 0
    const updatedPlugins = [...plugins]

    for (const idx of targetIndices) {
      const specifier = plugins[idx]
      const name = Config.getPluginName(specifier)

      if (specifier.startsWith("file://")) {
        prompts.log.info(`○ ${name} ${UI.Style.TEXT_DIM}skipped (local file)`)
        continue
      }

      spinner.start(`Checking ${name}...`)

      const [installed, latest] = await Promise.all([getInstalledVersion(name), fetchLatestVersion(name)])

      if (!latest) {
        spinner.stop(`! ${name} ${UI.Style.TEXT_DIM}failed to fetch latest version`)
        skippedCount++
        continue
      }

      if (installed === latest) {
        spinner.stop(`✓ ${name} ${UI.Style.TEXT_DIM}already at ${latest}`)
        continue
      }

      spinner.stop(`  ${name} ${installed ?? "?"} → ${latest}`)
      spinner.start(`Installing ${name}@${latest}...`)

      try {
        await BunProc.install(name, latest)
        updatedPlugins[idx] = `${name}@${latest}`
        spinner.stop(`✓ ${name} updated to ${latest}`)
        updatedCount++
      } catch (error) {
        spinner.stop(`✗ ${name} ${UI.Style.TEXT_DIM}update failed`)
        prompts.log.error(error instanceof Error ? error.message : String(error))
      }
    }

    if (updatedCount > 0) {
      config.plugin = updatedPlugins
      await writeGlobalConfig(filePath, config)
    }

    let summary = `${updatedCount} plugin(s) updated`
    if (skippedCount > 0) {
      summary += `, ${skippedCount} skipped (registry unreachable)`
    }
    prompts.outro(summary)
  },
})

export const PluginAddCommand = cmd({
  command: "add <name>",
  describe: "add a plugin",
  builder: (yargs) =>
    yargs.positional("name", {
      describe: "plugin package name (e.g., oh-my-opencode or oh-my-opencode@2.0.0)",
      type: "string",
      demandOption: true,
    }),
  async handler(args) {
    UI.empty()
    prompts.intro("Add Plugin")

    const { filePath, data: config } = await readGlobalConfig()
    const plugins = getPluginsArray(config)

    const inputName = Config.getPluginName(args.name)
    const inputVersion = extractVersionFromSpecifier(args.name)
    const isLocal = args.name.startsWith("file://")

    const existingIdx = plugins.findIndex((p) => Config.getPluginName(p) === inputName)

    if (existingIdx !== -1) {
      const existingVersion = extractVersionFromSpecifier(plugins[existingIdx])
      prompts.log.warn(`Plugin ${inputName} is already installed (${existingVersion ?? "unknown version"})`)

      const confirm = await prompts.confirm({ message: "Replace with new version?" })
      if (prompts.isCancel(confirm) || !confirm) {
        prompts.outro("Cancelled")
        return
      }
    }

    let finalSpecifier: string

    if (isLocal) {
      finalSpecifier = args.name
      prompts.log.info(`Adding local plugin: ${args.name}`)
    } else {
      const spinner = prompts.spinner()
      const targetVersion = inputVersion ?? "latest"
      spinner.start(`Installing ${inputName}@${targetVersion}...`)

      try {
        await BunProc.install(inputName, targetVersion)
        const installed = await getInstalledVersion(inputName)
        finalSpecifier = `${inputName}@${installed ?? targetVersion}`
        spinner.stop(`✓ Installed ${finalSpecifier}`)
      } catch (error) {
        spinner.stop(`✗ Failed to install ${inputName}`)
        prompts.log.error(error instanceof Error ? error.message : String(error))
        prompts.outro("Installation failed")
        return
      }
    }

    if (existingIdx !== -1) {
      plugins[existingIdx] = finalSpecifier
    } else {
      plugins.push(finalSpecifier)
    }

    config.plugin = plugins
    await writeGlobalConfig(filePath, config)

    prompts.outro("Plugin added successfully")
  },
})

export const PluginRemoveCommand = cmd({
  command: "remove <name>",
  aliases: ["rm"],
  describe: "remove a plugin",
  builder: (yargs) =>
    yargs.positional("name", {
      describe: "plugin package name to remove",
      type: "string",
      demandOption: true,
    }),
  async handler(args) {
    UI.empty()
    prompts.intro("Remove Plugin")

    const { filePath, data: config } = await readGlobalConfig()
    const plugins = getPluginsArray(config)

    const targetName = Config.getPluginName(args.name)
    const idx = plugins.findIndex((p) => Config.getPluginName(p) === targetName)

    if (idx === -1) {
      prompts.log.error(`Plugin not found: ${targetName}`)
      prompts.log.info("Installed plugins:")
      for (const p of plugins) {
        prompts.log.info(`  - ${Config.getPluginName(p)}`)
      }
      prompts.outro("Done")
      return
    }

    const name = Config.getPluginName(plugins[idx])

    const confirm = await prompts.confirm({ message: `Remove ${name}?` })
    if (prompts.isCancel(confirm) || !confirm) {
      prompts.outro("Cancelled")
      return
    }

    plugins.splice(idx, 1)
    config.plugin = plugins
    await writeGlobalConfig(filePath, config)

    prompts.log.success(`Removed ${name}`)
    prompts.outro("Plugin removed successfully")
  },
})
