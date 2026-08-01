import { readdir, stat } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { configDirectories, localProjectDirectory } from "../util/config-directories"

const extensions = new Set([".cjs", ".cts", ".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"])

export async function tuiPluginDirectories(cwd: string, configDirectory: string) {
  const projectConfig = path.join(await localProjectDirectory(cwd), ".opencode")
  const directories = configDirectories(configDirectory, cwd)
  const exists = await Promise.all(
    directories.map((directory) => {
      if (directory === configDirectory || directory === projectConfig) return true
      return stat(directory).then(
        (info) => info.isDirectory(),
        () => false,
      )
    }),
  )
  return directories
    .filter((_, index) => exists[index])
    .map((directory) => path.join(directory, "plugins", "tui"))
}

export async function discoverTuiPlugins(directories: string[]) {
  return (
    await Promise.all(
      directories.map(async (directory) => {
        const entries = await readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
          if (isMissing(error)) return []
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

function isMissing(error: unknown) {
  if (!error || typeof error !== "object") return false
  const code = Reflect.get(error, "code")
  return code === "ENOENT" || code === "ENOTDIR"
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
export function freshSpecifier(entrypoint: string, mtime: number) {
  if (typeof Bun !== "undefined") return `${fileURLToPath(entrypoint).replaceAll("\\", "/")}?mtime=${mtime}`
  return `${entrypoint}?mtime=${mtime}`
}
