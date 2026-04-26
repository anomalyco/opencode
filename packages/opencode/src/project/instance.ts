import { GlobalBus } from "@/bus/global"
import { disposeInstance } from "@/effect/instance-registry"
import { makeRuntime } from "@/effect/run-service"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { iife } from "@/util/iife"
import { Log } from "@/util"
import { LocalContext } from "../util"
import * as Project from "./project"
import { WorkspaceContext } from "@/control-plane/workspace-context"
import type { MultiRootWorkspaceID } from "@/workspace/schema"

export interface InstanceContext {
  directory: string
  worktree: string
  project: Project.Info
  /**
   * Full list of directories available to this instance.
   * Always includes `directory` as the first entry. For multi-root workspaces,
   * extra folders are appended. Tools use this via `containsPath` to determine
   * whether a path is internal (no permission prompt) or external.
   */
  roots: string[]
  /**
   * When the instance was created inside a multi-root workspace session, this
   * carries the workspace id that was resolved at middleware time. The set of
   * `roots` above is derived from this workspace's folder list at resolution
   * time; it is re-resolved on every request so folder add/remove is reflected
   * at the next request.
   */
  multiRootWorkspaceID?: MultiRootWorkspaceID
}

const context = LocalContext.create<InstanceContext>("instance")
const cache = new Map<string, Promise<InstanceContext>>()
const project = makeRuntime(Project.Service, Project.defaultLayer)

const disposal = {
  all: undefined as Promise<void> | undefined,
}

function normalizeRoots(directory: string, extra?: string[]) {
  const seen = new Set<string>()
  const out: string[] = []
  const push = (p: string) => {
    const resolved = AppFileSystem.resolve(p)
    if (seen.has(resolved)) return
    seen.add(resolved)
    out.push(resolved)
  }
  push(directory)
  for (const r of extra ?? []) push(r)
  return out
}

function boot(input: {
  directory: string
  init?: () => Promise<any>
  worktree?: string
  project?: Project.Info
  roots?: string[]
  multiRootWorkspaceID?: MultiRootWorkspaceID
}) {
  return iife(async () => {
    const roots = normalizeRoots(input.directory, input.roots)
    const base =
      input.project && input.worktree
        ? {
            directory: input.directory,
            worktree: input.worktree,
            project: input.project,
          }
        : await project
            .runPromise((svc) => svc.fromDirectory(input.directory))
            .then(({ project, sandbox }) => ({
              directory: input.directory,
              worktree: sandbox,
              project,
            }))
    const ctx: InstanceContext = {
      ...base,
      roots,
      multiRootWorkspaceID: input.multiRootWorkspaceID,
    }
    await context.provide(ctx, async () => {
      await input.init?.()
    })
    return ctx
  })
}

function track(key: string, next: Promise<InstanceContext>) {
  const task = next.catch((error) => {
    if (cache.get(key) === task) cache.delete(key)
    throw error
  })
  cache.set(key, task)
  return task
}

function cacheKey(directory: string, roots: string[], multiRootWorkspaceID?: MultiRootWorkspaceID) {
  const sortedRoots = [...roots].sort().join("\u0000")
  return `${directory}\u0000${multiRootWorkspaceID ?? ""}\u0000${sortedRoots}`
}

export const Instance = {
  async provide<R>(input: {
    directory: string
    init?: () => Promise<any>
    fn: () => R
    roots?: string[]
    multiRootWorkspaceID?: MultiRootWorkspaceID
  }): Promise<R> {
    const directory = AppFileSystem.resolve(input.directory)
    const normalizedRoots = normalizeRoots(directory, input.roots)
    const key = cacheKey(directory, normalizedRoots, input.multiRootWorkspaceID)
    let existing = cache.get(key)
    if (!existing) {
      Log.Default.info("creating instance", {
        directory,
        roots: normalizedRoots,
        multiRootWorkspaceID: input.multiRootWorkspaceID,
      })
      existing = track(
        key,
        boot({
          directory,
          init: input.init,
          roots: normalizedRoots,
          multiRootWorkspaceID: input.multiRootWorkspaceID,
        }),
      )
    }
    const ctx = await existing
    return context.provide(ctx, async () => {
      return input.fn()
    })
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
  get roots() {
    return context.use().roots
  },
  get multiRootWorkspaceID() {
    return context.use().multiRootWorkspaceID
  },

  /**
   * Check if a path is within the project boundary.
   * Returns true if path is inside any of `Instance.roots` OR `Instance.worktree`.
   * Paths within the worktree but outside the working directory should not trigger external_directory permission.
   */
  containsPath(filepath: string, ctx?: InstanceContext) {
    const instance = ctx ?? Instance
    for (const root of instance.roots) {
      if (AppFileSystem.contains(root, filepath)) return true
    }
    // Non-git projects set worktree to "/" which would match ANY absolute path.
    // Skip worktree check in this case to preserve external_directory permissions.
    if (instance.worktree === "/") return false
    return AppFileSystem.contains(instance.worktree, filepath)
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
  async reload(input: {
    directory: string
    init?: () => Promise<any>
    project?: Project.Info
    worktree?: string
    roots?: string[]
    multiRootWorkspaceID?: MultiRootWorkspaceID
  }) {
    const directory = AppFileSystem.resolve(input.directory)
    const roots = normalizeRoots(directory, input.roots)
    const key = cacheKey(directory, roots, input.multiRootWorkspaceID)
    Log.Default.info("reloading instance", { directory, multiRootWorkspaceID: input.multiRootWorkspaceID })
    await disposeInstance(directory)
    cache.delete(key)
    const next = track(key, boot({ ...input, directory, roots }))

    GlobalBus.emit("event", {
      directory,
      project: input.project?.id,
      workspace: WorkspaceContext.workspaceID,
      payload: {
        type: "server.instance.disposed",
        properties: {
          directory,
        },
      },
    })

    return await next
  },
  async dispose() {
    const ctx = context.use()
    const directory = ctx.directory
    const project = ctx.project
    const key = cacheKey(directory, ctx.roots, ctx.multiRootWorkspaceID)
    Log.Default.info("disposing instance", { directory, multiRootWorkspaceID: ctx.multiRootWorkspaceID })
    await disposeInstance(directory)
    cache.delete(key)

    GlobalBus.emit("event", {
      directory,
      project: project.id,
      workspace: WorkspaceContext.workspaceID,
      payload: {
        type: "server.instance.disposed",
        properties: {
          directory,
        },
      },
    })
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
