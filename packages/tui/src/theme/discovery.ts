import { readdir, readFile } from "node:fs/promises"
import path from "node:path"

export async function discoverThemes(directories: string[]) {
  const result: Record<string, unknown> = {}
  for (const directory of directories) {
    const themeDirectory = path.join(directory, "themes")
    const entries = await readdir(themeDirectory, { withFileTypes: true }).catch((error: unknown) => {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return []
      return Promise.reject(error)
    })
    const files = entries
      .filter((entry) => (entry.isFile() || entry.isSymbolicLink()) && path.extname(entry.name) === ".json")
      .map((entry) => path.join(themeDirectory, entry.name))
      .sort()
    for (const file of files) {
      // Keep the name present during an incomplete save so reconciliation can
      // retain its last valid theme, while absent files are removed.
      result[path.basename(file, ".json")] = await readFile(file, "utf8")
        .then((text): unknown => JSON.parse(text))
        .catch(() => undefined)
    }
  }
  return result
}
