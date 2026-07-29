import { readdir } from "node:fs/promises"
import path from "node:path"

const extensions = new Set([".cjs", ".cts", ".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"])

export async function discoverTuiPlugins(cwd: string) {
  const directory = path.join(cwd, ".opencode", "plugins", "tui")
  const entries = await readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
    if (error && typeof error === "object" && Reflect.get(error, "code") === "ENOENT") return []
    return Promise.reject(error)
  })
  return entries
    .filter((entry) => (entry.isFile() || entry.isSymbolicLink()) && extensions.has(path.extname(entry.name)))
    .map((entry) => path.join(directory, entry.name))
    .sort()
}
