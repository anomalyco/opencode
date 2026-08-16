import { readdir, stat } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { isMissingPath, localProjectDirectory, projectConfigDirectories } from "../util/config-directories"

const extensions = new Set([".cjs", ".cts", ".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"])

export async function tuiPluginDirectories(cwd: string, configDirectory: string) {
  const projectDirectory = await localProjectDirectory(cwd)
  const projectConfig = path.join(projectDirectory, ".opencode")
  const directories = [configDirectory, ...projectConfigDirectories(projectDirectory, cwd)]
  const exists = await Promise.all(
    directories.map((directory) => {
      if (directory === configDirectory || directory === projectConfig) return true
      return stat(directory).then(
        (info) => info.isDirectory(),
        (error) => (isMissingPath(error) ? false : Promise.reject(error)),
      )
    }),
  )
  return directories.filter((_, index) => exists[index]).map((directory) => path.join(directory, "plugins", "tui"))
}

export async function discoverTuiPlugins(directories: string[]) {
  return (
    await Promise.all(
      directories.map(async (directory) => {
        const entries = await readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
          if (isMissingPath(error)) return []
          return Promise.reject(error)
        })
        return entries
          .filter((entry) => (entry.isFile() || entry.isSymbolicLink()) && extensions.has(path.extname(entry.name)))
          .map((entry) => path.join(directory, entry.name))
          .sort()
      }),
    )
  ).flat()
}

export function localSource(spec: string, directory: string) {
  if (spec.startsWith("file://")) return new URL(spec)
  if (spec.startsWith("./") || spec.startsWith("../") || path.isAbsolute(spec))
    return pathToFileURL(path.resolve(directory, spec))
  return undefined
}

// Key local plugin imports by mtime so edited sources re-import fresh instead
// of hitting the ESM cache. Bun ignores query params when caching file:// URL
// imports, so bust with a plain path there; Node keys its cache on the full
// URL. Mirrors the core plugin supervisor's loader.
// The mtime is truncated to whole milliseconds: a fractional mtimeMs puts a
// dot in the query, and Bun's compiled binaries then skip runtime plugin
// hooks for the import, breaking JSX/solid rewriting for external plugins.
export function freshSpecifier(entrypoint: string, mtime: number) {
  const version = Math.trunc(mtime)
  if (typeof Bun !== "undefined") return `${fileURLToPath(entrypoint).replaceAll("\\", "/")}?mtime=${version}`
  return `${entrypoint}?mtime=${version}`
}
