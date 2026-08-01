import { readdir } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const extensions = new Set([".cjs", ".cts", ".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"])

export function tuiPluginDirectory(cwd: string) {
  return path.join(cwd, ".opencode", "plugins", "tui")
}

export async function discoverTuiPlugins(cwd: string) {
  const directory = tuiPluginDirectory(cwd)
  const entries = await readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
    if (error && typeof error === "object" && Reflect.get(error, "code") === "ENOENT") return []
    return Promise.reject(error)
  })
  return entries
    .filter((entry) => (entry.isFile() || entry.isSymbolicLink()) && extensions.has(path.extname(entry.name)))
    .map((entry) => path.join(directory, entry.name))
    .sort()
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
