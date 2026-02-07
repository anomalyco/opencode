import { Log } from "@/util/log"
import { Context } from "../util/context"
import { Project } from "./project"
import { State } from "./state"
import { iife } from "@/util/iife"
import { GlobalBus } from "@/bus/global"
import { Filesystem } from "@/util/filesystem"

interface Context {
  directory: string
  worktree: string
  project: Project.Info
}

interface Metadata {
  lastAccessed: number
  active: number
}

type DisposeReason = "explicit" | "dispose_all" | "evict_lru" | "evict_ttl"

const context = Context.create<Context>("instance")
const cache = new Map<string, Promise<Context>>()
const metadata = new Map<string, Metadata>()
const MAX_INSTANCES = 20
const IDLE_TTL_MS = 30 * 60 * 1000

const counters = {
  created: 0,
  evicted: 0,
  disposed: 0,
}

const disposal = {
  all: undefined as Promise<void> | undefined,
  eviction: Promise.resolve(),
}

function tracked(directory: string) {
  let result = metadata.get(directory)
  if (result) return result
  result = {
    lastAccessed: Date.now(),
    active: 0,
  }
  metadata.set(directory, result)
  return result
}

function touch(directory: string) {
  tracked(directory).lastAccessed = Date.now()
}

function markActive(directory: string) {
  const info = tracked(directory)
  info.active += 1
  info.lastAccessed = Date.now()
}

function markIdle(directory: string) {
  const info = metadata.get(directory)
  if (!info) return
  info.active = Math.max(0, info.active - 1)
  info.lastAccessed = Date.now()
}

function activeInstanceCount() {
  let count = 0
  for (const value of metadata.values()) {
    if (value.active > 0) count += 1
  }
  return count
}

function logCounts(message: string, properties: Record<string, unknown> = {}) {
  Log.Default.info(message, {
    ...properties,
    liveInstances: cache.size,
    activeInstances: activeInstanceCount(),
    createCount: counters.created,
    evictCount: counters.evicted,
    disposeCount: counters.disposed,
  })
}

async function disposeCurrent(reason: DisposeReason) {
  const directory = Instance.directory
  if (!cache.has(directory)) {
    metadata.delete(directory)
    return
  }

  await State.dispose(directory)
  cache.delete(directory)
  metadata.delete(directory)

  counters.disposed += 1
  if (reason === "evict_lru" || reason === "evict_ttl") {
    counters.evicted += 1
    logCounts("evicted instance", {
      directory,
      reason,
    })
  } else {
    logCounts("disposed instance", {
      directory,
      reason,
    })
  }

  GlobalBus.emit("event", {
    directory,
    payload: {
      type: "server.instance.disposed",
      properties: {
        directory,
      },
    },
  })
}

async function disposeDirectoryIfIdle(directory: string, reason: "evict_lru" | "evict_ttl") {
  const value = cache.get(directory)
  if (!value) {
    metadata.delete(directory)
    return false
  }

  if ((metadata.get(directory)?.active ?? 0) > 0) return false

  const ctx = await value.catch((error) => {
    Log.Default.warn("failed to resolve instance for eviction", {
      directory,
      error,
    })
    if (cache.get(directory) === value) {
      cache.delete(directory)
      metadata.delete(directory)
    }
    return undefined
  })

  if (!ctx) return false
  if (cache.get(directory) !== value) return false
  if ((metadata.get(directory)?.active ?? 0) > 0) return false

  await context.provide(ctx, async () => {
    if (cache.get(directory) !== value) return
    await disposeCurrent(reason)
  })

  return true
}

async function applyEviction(targetSize: number) {
  for (const key of [...metadata.keys()]) {
    if (!cache.has(key)) metadata.delete(key)
  }

  const now = Date.now()
  for (const [directory, info] of [...metadata.entries()]) {
    if (info.active > 0) continue
    if (now - info.lastAccessed < IDLE_TTL_MS) continue
    await disposeDirectoryIfIdle(directory, "evict_ttl")
  }

  let attempts = 0
  while (cache.size > targetSize) {
    attempts += 1
    if (attempts > cache.size * 2) {
      Log.Default.warn("stopping instance eviction after repeated attempts", {
        cacheSize: cache.size,
        targetSize,
      })
      return
    }

    let oldest: string | undefined
    let oldestTime = Infinity
    for (const [key, info] of metadata) {
      if (!cache.has(key)) continue
      if (info.active > 0) continue
      if (info.lastAccessed < oldestTime) {
        oldest = key
        oldestTime = info.lastAccessed
      }
    }

    if (!oldest) {
      Log.Default.warn("instance cache exceeded max with only active entries", {
        cacheSize: cache.size,
        targetSize,
        activeInstances: activeInstanceCount(),
      })
      return
    }

    const evicted = await disposeDirectoryIfIdle(oldest, "evict_lru")
    if (!evicted) {
      const info = metadata.get(oldest)
      if (info) info.lastAccessed = Date.now()
    }
  }
}

function enforceEviction(targetSize: number) {
  disposal.eviction = disposal.eviction
    .catch(() => undefined)
    .then(async () => {
      if (disposal.all) return
      await applyEviction(targetSize)
    })
    .catch((error) => {
      Log.Default.error("instance eviction failed", { error })
    })
  return disposal.eviction
}

function createContext(input: { directory: string; init?: () => Promise<any> }) {
  let created: Promise<Context>
  created = iife(async () => {
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
  }).catch((error) => {
    if (cache.get(input.directory) === created) {
      cache.delete(input.directory)
      metadata.delete(input.directory)
    }
    throw error
  })

  counters.created += 1
  logCounts("created instance", {
    directory: input.directory,
  })
  return created
}

function getOrCreate(input: { directory: string; init?: () => Promise<any> }) {
  const existing = cache.get(input.directory)
  if (existing) {
    touch(input.directory)
    return existing
  }

  const created = createContext(input)
  cache.set(input.directory, created)
  touch(input.directory)
  return created
}

export const Instance = {
  async provide<R>(input: { directory: string; init?: () => Promise<any>; fn: () => R }): Promise<R> {
    if (!cache.has(input.directory)) {
      await enforceEviction(MAX_INSTANCES - 1)
    }

    markActive(input.directory)
    try {
      const existing = getOrCreate(input)
      const ctx = await existing
      return await context.provide(ctx, async () => {
        return input.fn()
      })
    } finally {
      markIdle(input.directory)
      await enforceEviction(MAX_INSTANCES)
    }
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
  get cacheSize() {
    return cache.size
  },
  get lifecycleCounts() {
    return {
      created: counters.created,
      evicted: counters.evicted,
      disposed: counters.disposed,
    }
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
    await disposeCurrent("explicit")
  },
  async disposeAll() {
    if (disposal.all) return disposal.all

    disposal.all = iife(async () => {
      await disposal.eviction
      logCounts("disposing all instances")
      const entries = [...cache.entries()]
      for (const [key, value] of entries) {
        if (cache.get(key) !== value) continue

        const ctx = await value.catch((error) => {
          Log.Default.warn("instance dispose failed", { key, error })
          return undefined
        })

        if (!ctx) {
          if (cache.get(key) === value) cache.delete(key)
          metadata.delete(key)
          continue
        }

        if (cache.get(key) !== value) continue

        await context.provide(ctx, async () => {
          if (cache.get(key) !== value) return
          await disposeCurrent("dispose_all")
        })
      }
      metadata.clear()
    }).finally(() => {
      disposal.all = undefined
    })

    return disposal.all
  },
}
