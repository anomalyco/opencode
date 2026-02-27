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
const context = Context.create<Context>("instance")
const cache = new Map<string, Promise<Context>>()
const lastAccess = new Map<string, number>()

/** How long an instance can be idle before it is eligible for eviction (ms). */
const IDLE_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes

/** How often the idle-eviction sweep runs (ms). */
const SWEEP_INTERVAL_MS = 60 * 1000 // 1 minute

const sweep = {
  timer: undefined as ReturnType<typeof setInterval> | undefined,
  start() {
    if (sweep.timer) return
    sweep.timer = setInterval(async () => {
      const now = Date.now()
      for (const [directory, timestamp] of lastAccess) {
        if (now - timestamp < IDLE_TIMEOUT_MS) continue
        if (!cache.has(directory)) {
          lastAccess.delete(directory)
          continue
        }

        Log.Default.info("evicting idle instance", {
          directory,
          idleMs: now - timestamp,
        })

        const entry = cache.get(directory)
        if (!entry) continue

        const ctx = await entry.catch(() => undefined)
        if (!ctx) {
          cache.delete(directory)
          lastAccess.delete(directory)
          continue
        }

        // re-check — may have been accessed while awaiting
        const current = lastAccess.get(directory)
        if (current && now - current < IDLE_TIMEOUT_MS) continue

        await context.provide(ctx, async () => {
          await Instance.dispose()
        })
        lastAccess.delete(directory)
      }
    }, SWEEP_INTERVAL_MS)
    sweep.timer.unref()
  },
  stop() {
    if (!sweep.timer) return
    clearInterval(sweep.timer)
    sweep.timer = undefined
  },
}

const disposal = {
  all: undefined as Promise<void> | undefined,
}

export const Instance = {
  async provide<R>(input: { directory: string; init?: () => Promise<any>; fn: () => R }): Promise<R> {
    lastAccess.set(input.directory, Date.now())
    sweep.start()

    let existing = cache.get(input.directory)
    if (!existing) {
      Log.Default.info("creating instance", { directory: input.directory })
      existing = iife(async () => {
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
      cache.set(input.directory, existing)
    }
    const ctx = await existing
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
    lastAccess.delete(Instance.directory)
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
      sweep.stop()
      const entries = [...cache.entries()]
      for (const [key, value] of entries) {
        if (cache.get(key) !== value) continue

        const ctx = await value.catch((error) => {
          Log.Default.warn("instance dispose failed", { key, error })
          return undefined
        })

        if (!ctx) {
          if (cache.get(key) === value) cache.delete(key)
          continue
        }

        if (cache.get(key) !== value) continue

        await context.provide(ctx, async () => {
          await Instance.dispose()
        })
      }
      lastAccess.clear()
    }).finally(() => {
      disposal.all = undefined
    })

    return disposal.all
  },
}
