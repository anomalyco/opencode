import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath, pathToFileURL } from "node:url"
import path from "node:path"
import { Hash } from "@opencode-ai/util/hash"

// Keep source fingerprints and import attempts together. Filesystem events
// should reload changed local graphs, not repeat unchanged evaluations.
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
      const prepared: { version: string; load: () => Promise<unknown>; dispose?: () => void } = await prepareSource(
        entrypoint,
        track,
      )
      if (prepared.dispose) cleanups.push(prepared.dispose)
      // Cache the attempt before evaluating it: unchanged failing modules must
      // not repeat import-time effects on every filesystem notification.
      const loaded = prepared.load().then((module) => ({ version: prepared.version, module }))
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

export function localSource(spec: string, directory: string) {
  if (spec.startsWith("file://")) return new URL(spec)
  if (spec.startsWith("./") || spec.startsWith("../") || path.isAbsolute(spec))
    return pathToFileURL(path.resolve(directory, spec))
  return undefined
}
