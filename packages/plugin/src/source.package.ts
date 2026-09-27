import { existsSync } from "node:fs"
import path from "node:path"

export function missingPackageTarget(specifier: string, importer: string) {
  if (specifier.startsWith("#")) return undefined
  const parts = specifier.split("/")
  const name = specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]
  const start = path.dirname(importer)
  for (let directory = start; ; directory = path.dirname(directory)) {
    if (existsSync(path.join(directory, "package.json"))) return path.join(directory, "node_modules", name)
    if (path.dirname(directory) === directory) return path.join(start, "node_modules", name)
  }
}
