import path from "path"
import { pathToFileURL } from "url"
import fs from "fs/promises"
import { constants, existsSync } from "fs"
import { Log } from "../util/log"
import { Installation } from "@/installation"
import { BunProc } from "@/bun"
import { PackageRegistry } from "@/bun/registry"
import { proxied } from "@/util/proxied"

const log = Log.create({ service: "config" })

// --- Plugin file discovery ---

const PLUGIN_GLOB = new Bun.Glob("{plugin,plugins}/*.{ts,js}")

export async function loadPlugin(dir: string) {
  const plugins: string[] = []

  for await (const item of PLUGIN_GLOB.scan({
    absolute: true,
    followSymlinks: true,
    dot: true,
    cwd: dir,
  })) {
    plugins.push(pathToFileURL(item).href)
  }
  return plugins
}

// --- Plugin name resolution ---

/**
 * Extracts a canonical plugin name from a plugin specifier.
 * - For file:// URLs: extracts filename without extension
 * - For npm packages: extracts package name without version
 *
 * @example
 * getPluginName("file:///path/to/plugin/foo.js") // "foo"
 * getPluginName("oh-my-opencode@2.4.3") // "oh-my-opencode"
 * getPluginName("@scope/pkg@1.0.0") // "@scope/pkg"
 */
export function getPluginName(plugin: string): string {
  if (plugin.startsWith("file://")) {
    return path.parse(new URL(plugin).pathname).name
  }
  const lastAt = plugin.lastIndexOf("@")
  if (lastAt > 0) {
    return plugin.substring(0, lastAt)
  }
  return plugin
}

/**
 * Deduplicates plugins by name, with later entries (higher priority) winning.
 * Priority order (highest to lowest):
 * 1. Local plugin/ directory
 * 2. Local opencode.json
 * 3. Global plugin/ directory
 * 4. Global opencode.json
 *
 * Since plugins are added in low-to-high priority order,
 * we reverse, deduplicate (keeping first occurrence), then restore order.
 */
export function deduplicatePlugins(plugins: string[]): string[] {
  // seenNames: canonical plugin names for duplicate detection
  // e.g., "oh-my-opencode", "@scope/pkg"
  const seenNames = new Set<string>()

  // uniqueSpecifiers: full plugin specifiers to return
  // e.g., "oh-my-opencode@2.4.3", "file:///path/to/plugin.js"
  const uniqueSpecifiers: string[] = []

  for (const specifier of plugins.toReversed()) {
    const name = getPluginName(specifier)
    if (!seenNames.has(name)) {
      seenNames.add(name)
      uniqueSpecifiers.push(specifier)
    }
  }

  return uniqueSpecifiers.toReversed()
}

// --- Dependency installation ---

async function isWritable(dir: string) {
  try {
    await fs.access(dir, constants.W_OK)
    return true
  } catch {
    return false
  }
}

export async function needsInstall(dir: string) {
  // Some config dirs may be read-only.
  // Installing deps there will fail; skip installation in that case.
  const writable = await isWritable(dir)
  if (!writable) {
    log.debug("config dir is not writable, skipping dependency install", { dir })
    return false
  }

  const nodeModules = path.join(dir, "node_modules")
  if (!existsSync(nodeModules)) return true

  const pkg = path.join(dir, "package.json")
  const pkgFile = Bun.file(pkg)
  const pkgExists = await pkgFile.exists()
  if (!pkgExists) return true

  const parsed = await pkgFile.json().catch(() => null)
  const dependencies = parsed?.dependencies ?? {}
  const depVersion = dependencies["@opencode-ai/plugin"]
  if (!depVersion) return true

  const targetVersion = Installation.isLocal() ? "latest" : Installation.VERSION
  if (targetVersion === "latest") {
    const isOutdated = await PackageRegistry.isOutdated("@opencode-ai/plugin", depVersion, dir)
    if (!isOutdated) return false
    log.info("Cached version is outdated, proceeding with install", {
      pkg: "@opencode-ai/plugin",
      cachedVersion: depVersion,
    })
    return true
  }
  if (depVersion === targetVersion) return false
  return true
}

export async function installDependencies(dir: string) {
  const pkg = path.join(dir, "package.json")
  const targetVersion = Installation.isLocal() ? "latest" : Installation.VERSION

  if (!(await Bun.file(pkg).exists())) {
    await Bun.write(pkg, "{}")
  }

  const gitignore = path.join(dir, ".gitignore")
  const hasGitIgnore = await Bun.file(gitignore).exists()
  if (!hasGitIgnore) await Bun.write(gitignore, ["node_modules", "package.json", "bun.lock", ".gitignore"].join("\n"))

  await BunProc.run(
    [
      "add",
      `@opencode-ai/plugin@${targetVersion}`,
      "--exact",
      // TODO: get rid of this case (see: https://github.com/oven-sh/bun/issues/19936)
      ...(proxied() ? ["--no-cache"] : []),
    ],
    {
      cwd: dir,
    },
  ).catch((e) => { log.warn("Failed to add plugin package", { error: e }) })

  // Install any additional dependencies defined in the package.json
  // This allows local plugins and custom tools to use external packages
  await BunProc.run(
    [
      "install",
      // TODO: get rid of this case (see: https://github.com/oven-sh/bun/issues/19936)
      ...(proxied() ? ["--no-cache"] : []),
    ],
    { cwd: dir },
  ).catch((e) => { log.warn("Failed to install dependencies", { error: e }) })
}
