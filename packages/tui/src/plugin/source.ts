import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { Hash } from "@opencode-ai/util/hash"
import { prepareSource } from "#plugin-source"

let generation = Date.now()

// Keep source identity and runtime module identity together. A new entrypoint
// alone is not a new plugin: its local imports must use the same generation.
export function createPluginSources(watch: (file: string) => Promise<void>) {
  const sources = new Map<string, Source>()
  const cleanups: Array<() => void> = []
  const watching = new Set<Promise<void>>()
  return {
    version: async (entrypoint: string) => {
      await Promise.all(watching)
      const previous = sources.get(entrypoint)
      if (previous && [...previous.files].every(([file, item]) => item.digest === digest(file, item.directory)))
        return previous.version

      const version = ++generation
      const files: Source["files"] = new Map()
      const track = (file: string, directory = false) => {
        if (files.has(file)) return
        files.set(file, { digest: digest(file, directory), directory })
        const pending = watch(file).finally(() => watching.delete(pending))
        watching.add(pending)
      }
      track(fileURLToPath(entrypoint))
      const prepared = await prepareSource(entrypoint, version, track)
      cleanups.push(prepared.dispose)
      sources.set(entrypoint, { version: prepared.version, files })
      await Promise.all(watching)
      return prepared.version
    },
    dispose: () => {
      for (const cleanup of cleanups.splice(0)) cleanup()
      sources.clear()
    },
  }
}

type Source = {
  version: string
  files: Map<string, { digest: string; directory: boolean }>
}

function digest(file: string, directory: boolean) {
  try {
    return Hash.sha256(directory ? JSON.stringify(readdirSync(file).sort()) : readFileSync(file))
  } catch {
    return "missing"
  }
}
