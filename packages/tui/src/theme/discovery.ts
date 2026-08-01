import { readdir, readFile } from "node:fs/promises"
import path from "node:path"

export function themeDirectories(config: string, cwd: string) {
  const directories: string[] = []
  for (let current = cwd; ; current = path.dirname(current)) {
    directories.push(path.join(current, ".opencode"))
    if (path.dirname(current) === current) break
  }
  return [config, ...directories.reverse()]
}

export async function discoverThemes(directories: string[]) {
  const result: Record<string, unknown> = {}
  for (const directory of directories) {
    const themeDirectory = path.join(directory, "themes")
    const entries = await readdir(themeDirectory, { withFileTypes: true }).catch((error: unknown) => {
      if (error && typeof error === "object" && Reflect.get(error, "code") === "ENOENT") return []
      return Promise.reject(error)
    })
    const files = entries
      .filter((entry) => (entry.isFile() || entry.isSymbolicLink()) && path.extname(entry.name) === ".json")
      .map((entry) => path.join(themeDirectory, entry.name))
      .sort()
    for (const file of files) {
      result[path.basename(file, ".json")] = JSON.parse(await readFile(file, "utf8")) as unknown
    }
  }
  return result
}
