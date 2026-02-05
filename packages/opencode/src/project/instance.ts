import { Log } from "@/util/log"
import { Context } from "../util/context"
import { Project } from "./project"
import { State } from "./state"
import { iife } from "@/util/iife"
import { GlobalBus } from "@/bus/global"
import { Filesystem } from "@/util/filesystem"

const MAX_CACHED_INSTANCES = 10
const INSTANCE_IDLE_TTL_MS = 30 * 60 * 1000

interface Context {
  directory: string
  worktree: string
  project: Project.Info
}

interface CacheEntry {
  context: Promise<Context>
  lastAccess: number
}

const context = Context.create<Context>("instance")
const cache = new Map<string, CacheEntry>()

const disposal = {
  all: undefined as Promise<void> | undefined,
}

function evictIdleInstances() {
  const now = Date.now()
  const toEvict: string[] = []

  for (const [key, entry] of cache) {
    if (now - entry.lastAccess > INSTANCE_IDLE_TTL_MS) {
      toEvict.push(key)
    }
  }

  for (const key of toEvict) {
    const entry = cache.get(key)
    if (!entry) continue
    cache.delete(key)
    entry.context
      .then((ctx) => context.provide(ctx, () => State.dispose(key)))
      .catch(() => {})
  }

  if (cache.size > MAX_CACHED_INSTANCES) {
    const sorted = [...cache.entries()].sort((a, b) => a[1].lastAccess - b[1].lastAccess)
    const excess = sorted.slice(0, cache.size - MAX_CACHED_INSTANCES)
    for (const [key, entry] of excess) {
      cache.delete(key)
      entry.context
        .then((ctx) => context.provide(ctx, () => State.dispose(key)))
        .catch(() => {})
    }
  }
}

export const Instance = {
  async provide<R>(input: { directory: string; init?: () => Promise<any>; fn: () => R }): Promise<R> {
    let existing = cache.get(input.directory)
    if (!existing) {
      Log.Default.info("creating instance", { directory: input.directory })
      const contextPromise = iife(async () => {
        const { project, sandbox } = await Project.fromDirectory(input.directory)
        const ctx = {
          directory: input.directory,
          worktree: sandbox,
          project,
        }
        await context.provide(ctx, async () => {
          await input.init?.()
        })
        return ctx
      })
      existing = { context: contextPromise, lastAccess: Date.now() }
      cache.set(input.directory, existing)
      evictIdleInstances()
    } else {
      existing.lastAccess = Date.now()
    }
    const ctx = await existing.context
    return context.provide(ctx, async () => {
      return input.fn()
    })
  },
  get directory() {
    return context.use().directory
  },
  get worktree() {
    return context.use().worktree
  },
  get project() {
    return context.use().project
  },
  /**
   * Check if a path is within the project boundary.
   * Returns true if path is inside Instance.directory OR Instance.worktree.
   * Paths within the worktree but outside the working directory should not trigger external_directory permission.
   */
  containsPath(filepath: string) {
    if (Filesystem.contains(Instance.directory, filepath)) return true
    // Non-git projects set worktree to "/" which would match ANY absolute path.
    // Skip worktree check in this case to preserve external_directory permissions.
    if (Instance.worktree === "/") return false
    return Filesystem.contains(Instance.worktree, filepath)
  },
  state<S>(init: () => S, dispose?: (state: Awaited<S>) => Promise<void>): () => S {
    return State.create(() => Instance.directory, init, dispose)
  },
  async dispose() {
    Log.Default.info("disposing instance", { directory: Instance.directory })
    await State.dispose(Instance.directory)
    cache.delete(Instance.directory)
    GlobalBus.emit("event", {
      directory: Instance.directory,
      payload: {
        type: "server.instance.disposed",
        properties: {
          directory: Instance.directory,
        },
      },
    })
  },
  async disposeAll() {
    if (disposal.all) return disposal.all

    disposal.all = iife(async () => {
      Log.Default.info("disposing all instances")
      const entries = [...cache.entries()]
      for (const [key, entry] of entries) {
        if (cache.get(key)?.context !== entry.context) continue

        const ctx = await entry.context.catch((error) => {
          Log.Default.warn("instance dispose failed", { key, error })
          return undefined
        })

        if (!ctx) {
          if (cache.get(key)?.context === entry.context) cache.delete(key)
          continue
        }

        if (cache.get(key)?.context !== entry.context) continue

        await context.provide(ctx, async () => {
          await Instance.dispose()
        })
      }
    }).finally(() => {
      disposal.all = undefined
    })

    return disposal.all
  },
}
