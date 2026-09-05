import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { Host } from "@opencode-ai/plugin/host"
import { localSource } from "./discovery"

let generation = Date.now()

export async function prepareSource(entrypoint: string, track: (file: string, directory?: boolean) => void) {
  const files = new Set<string>()
  const visit = (file: string, search = "") => {
    if (file.split(path.sep).includes("node_modules")) return
    if (search) delete require.cache[file + search]
    if (files.has(file)) return
    files.add(file)
    // Bun exposes ESM here too. Delete known keys even when absent: rejected
    // evaluations are not enumerable, but deletion still invalidates them.
    delete require.cache[file]
    track(file)
    if (!/\.[cm]?[jt]sx?$/.test(file)) return
    // Scan dependencies only; the normal runtime loader still owns compilation,
    // package resolution, import attributes, and error reporting.
    const imports = (() => {
      try {
        return new Bun.Transpiler({
          loader: file.endsWith("tsx") ? "tsx" : file.endsWith("jsx") ? "jsx" : /\.[cm]?ts$/.test(file) ? "ts" : "js",
          target: "bun",
        }).scan(readFileSync(file, "utf8")).imports
      } catch {
        return []
      }
    })()
    for (const item of imports) {
      const local =
        item.path.startsWith("./") || item.path.startsWith("../")
          ? new URL(item.path, pathToFileURL(file))
          : localSource(item.path, path.dirname(file))
      if (!local) continue
      const requested = fileURLToPath(local)
      // Resolving a workspace symlink can erase its node_modules boundary.
      if (requested.split(path.sep).includes("node_modules")) continue
      try {
        visit(
          item.kind === "require-call"
            ? createRequire(file).resolve(requested)
            : Bun.resolveSync(requested, path.dirname(file)),
          local.search,
        )
      } catch {
        // A missing local dependency may appear on the next save. Leave its
        // actual failure (or optional fallback) to the native loader.
        track(path.dirname(requested), true)
      }
    }
  }
  visit(fileURLToPath(entrypoint))
  return { version: String(++generation), load: () => Host.load(entrypoint) }
}
