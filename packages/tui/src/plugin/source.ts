import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { Hash } from "@opencode-ai/util/hash"
import { Host } from "@opencode-ai/plugin/host"

// Keep source identity and runtime module identity together. A new entrypoint
// alone is not a new plugin: its local imports must use the same generation.
export function createPluginSources(watch: (file: string) => Promise<void>) {
  const sources = new Map<string, Source>()
  const cleanups: Array<() => void> = []
  const watching = new Set<Promise<void>>()
  return {
    read: async (entrypoint: string) => {
      await Promise.all(watching)
      const previous = sources.get(entrypoint)
      if (previous && [...previous.files].every(([file, item]) => item.digest === digest(file, item.directory)))
        return previous.loaded

      const files: Source["files"] = new Map()
      const track = (file: string, directory = false) => {
        if (files.has(file)) return
        files.set(file, { digest: digest(file, directory), directory })
        const pending = watch(file).finally(() => watching.delete(pending))
        watching.add(pending)
      }
      track(fileURLToPath(entrypoint))
      const { prepareSource } = await import("#plugin-source")
      const prepared = await prepareSource(entrypoint, track)
      cleanups.push(prepared.dispose)
      // Cache the attempt before evaluating it: unchanged failing modules must
      // not repeat import-time effects on every filesystem notification.
      const loaded = Host.load(prepared.version).then((module) => ({ version: prepared.version, module }))
      sources.set(entrypoint, { loaded, files })
      return loaded.finally(() => Promise.all(watching))
    },
    dispose: () => {
      for (const cleanup of cleanups.splice(0)) cleanup()
      sources.clear()
    },
  }
}

type Source = {
  loaded: Promise<{ version: string; module: unknown }>
  files: Map<string, { digest: string; directory: boolean }>
}

function digest(file: string, directory: boolean) {
  try {
    return Hash.sha256(directory ? JSON.stringify(readdirSync(file).sort()) : readFileSync(file))
  } catch {
    return "missing"
  }
}
