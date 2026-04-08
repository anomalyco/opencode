import { GlobalBus } from "@/bus/global"
import { disposeInstance } from "@/effect/instance-registry"
import { Filesystem } from "@/util/filesystem"
import { iife } from "@/util/iife"
import { Log } from "@/util/log"
import { Context } from "../util/context"
import { Project } from "./project"
import { State } from "./state"

export interface InstanceContext {
  directory: string
  worktree: string
  project: Project.Info
}
const context = Context.create<InstanceContext>("instance")
const cache = new Map<string, Promise<InstanceContext>>()
const activity = new Map<string, number>()
const refs = new Map<string, number>()
const disposing = new Set<string>()
const IDLE_MS = 5 * 60 * 1000
const SWEEP_MS = 60 * 1000
let sweep: ReturnType<typeof setInterval> | undefined

const disposal = {
  all: undefined as Promise<void> | undefined,
}

function emit(directory: string) {
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

function touch(dir: string) {
  activity.set(dir, Date.now())
}

function acquire(dir: string) {
  refs.set(dir, (refs.get(dir) ?? 0) + 1)
}

function release(dir: string) {
  const n = (refs.get(dir) ?? 1) - 1
  if (n <= 0) refs.delete(dir)
  else refs.set(dir, n)
}

async function wait(dir: string) {
  while (disposing.has(dir)) {
    await new Promise<void>((resolve) => setTimeout(resolve, 10))
  }
}

async function reap() {
  const now = Date.now()
  for (const [dir, last] of activity) {
    if (now - last < IDLE_MS) continue
    if (refs.has(dir)) continue
    if (disposing.has(dir)) continue
    if (!cache.has(dir)) {
      activity.delete(dir)
      continue
    }
    const val = cache.get(dir)
    if (!val) continue
    disposing.add(dir)
    cache.delete(dir)
    try {
      Log.Default.info("disposing idle instance", { directory: dir, idle_ms: now - last })
      const ctx = await val.catch(() => undefined)
      if (!ctx) continue
      await context.provide(ctx, async () => {
        await Promise.all([State.dispose(dir), disposeInstance(dir)])
      })
      emit(dir)
    } catch (error) {
      Log.Default.warn("idle instance dispose failed", { directory: dir, error })
    } finally {
      disposing.delete(dir)
      activity.delete(dir)
    }
  }
}

function ensureSweep() {
  if (sweep) return
  sweep = setInterval(reap, SWEEP_MS)
  sweep.unref?.()
}

function boot(input: { directory: string; init?: () => Promise<any>; project?: Project.Info; worktree?: string }) {
  return iife(async () => {
    const ctx =
      input.project && input.worktree
        ? {
            directory: input.directory,
            worktree: input.worktree,
            project: input.project,
          }
        : await Project.fromDirectory(input.directory).then(({ project, sandbox }) => ({
            directory: input.directory,
            worktree: sandbox,
            project,
          }))
    await context.provide(ctx, async () => {
      await input.init?.()
    })
    return ctx
  })
}

function track(directory: string, next: Promise<InstanceContext>) {
  const task = next.catch((error) => {
    if (cache.get(directory) === task) cache.delete(directory)
    throw error
  })
  cache.set(directory, task)
  return task
}

export const Instance = {
  async provide<R>(input: { directory: string; init?: () => Promise<any>; fn: () => R }): Promise<R> {
    const directory = Filesystem.resolve(input.directory)
    while (true) {
      await wait(directory)
      let existing = cache.get(directory)
      if (!existing) {
        Log.Default.info("creating instance", { directory })
        existing = track(
          directory,
          boot({
            directory,
            init: input.init,
          }),
        )
      }
      touch(directory)
      ensureSweep()
      const ctx = await existing
      if (disposing.has(directory)) continue
      acquire(directory)
      try {
        return await context.provide(ctx, async () => {
          return input.fn()
        })
      } finally {
        release(directory)
        touch(directory)
      }
    }
  },
  get current() {
    return context.use()
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
  /**
   * Captures the current instance ALS context and returns a wrapper that
   * restores it when called. Use this for callbacks that fire outside the
   * instance async context (native addons, event emitters, timers, etc.).
   */
  bind<F extends (...args: any[]) => any>(fn: F): F {
    const ctx = context.use()
    return ((...args: any[]) => context.provide(ctx, () => fn(...args))) as F
  },
  /**
   * Run a synchronous function within the given instance context ALS.
   * Use this to bridge from Effect (where InstanceRef carries context)
   * back to sync code that reads Instance.directory from ALS.
   */
  restore<R>(ctx: InstanceContext, fn: () => R): R {
    return context.provide(ctx, fn)
  },
  state<S>(init: () => S, dispose?: (state: Awaited<S>) => Promise<void>): () => S {
    return State.create(() => Instance.directory, init, dispose)
  },
  async reload(input: { directory: string; init?: () => Promise<any>; project?: Project.Info; worktree?: string }) {
    const directory = Filesystem.resolve(input.directory)
    Log.Default.info("reloading instance", { directory })
    await Promise.all([State.dispose(directory), disposeInstance(directory)])
    cache.delete(directory)
    const next = track(directory, boot({ ...input, directory }))
    emit(directory)
    return await next
  },
  async dispose() {
    const directory = Instance.directory
    Log.Default.info("disposing instance", { directory })
    await Promise.all([State.dispose(directory), disposeInstance(directory)])
    cache.delete(directory)
    emit(directory)
  },
  async disposeAll() {
    if (disposal.all) return disposal.all

    disposal.all = iife(async () => {
      Log.Default.info("disposing all instances")
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
    }).finally(() => {
      disposal.all = undefined
    })

    return disposal.all
  },
}
