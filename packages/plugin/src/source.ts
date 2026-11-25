import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath, pathToFileURL } from "node:url"
import path from "node:path"
import { Hash } from "@opencode/util/hash"

// Serialize process-global module invalidation and imports across entrypoints and locations so
// concurrent reloads never race on `require.cache` (including when different entrypoints import
// the same local helper), and reuse an unchanged load when the runtime loader has no per-instance
// hook to dispose.
let queue: Promise<void> | undefined
const shared = new Map<string, Shared>()

type Shared = {
  readonly loaded: { readonly version: string; readonly module: unknown }
  readonly files: Map<string, { readonly digest: string; readonly directory: boolean }>
}

function unchanged(files: ReadonlyMap<string, { readonly digest: string; readonly directory: boolean }>) {
  return [...files].every(([file, item]) => item.digest === digest(file, item.directory))
}

async function serialized<A>(work: () => Promise<A>): Promise<A> {
  const previous = queue
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const tail = (previous ?? Promise.resolve()).then(() => gate)
  queue = tail
  if (previous) await previous
  try {
    return await work()
  } finally {
    release()
    if (queue === tail) queue = undefined
  }
}

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
      if (previous && unchanged(previous.files)) return previous.loaded

      try {
        return await serialized(async () => {
          const cached = sources.get(entrypoint)
          if (cached && unchanged(cached.files)) return cached.loaded

          const files: Source["files"] = new Map()
          const track = (file: string, directory = false) => {
            if (files.has(file)) return
            files.set(file, { digest: digest(file, directory), directory })
            const pending = watch(file).finally(() => watching.delete(pending))
            watching.add(pending)
            // Watch setup can be interrupted while module evaluation is still pending.
            void pending.catch(() => {})
          }

          const existing = shared.get(entrypoint)
          if (existing && unchanged(existing.files)) {
            for (const [file, item] of existing.files) track(file, item.directory)
            const loaded = Promise.resolve(existing.loaded)
            sources.set(entrypoint, { loaded, files })
            return existing.loaded
          }
          if (existing) shared.delete(entrypoint)

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
          const resolved = await loaded
          if (!prepared.dispose) shared.set(entrypoint, { loaded: resolved, files: new Map(files) })
          return resolved
        })
      } finally {
        await Promise.all(watching)
      }
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
