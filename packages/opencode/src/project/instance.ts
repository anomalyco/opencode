import { Log } from "@/util/log"
import { Context } from "../util/context"
import { Project } from "./project"
import { State } from "./state"
import { iife } from "@/util/iife"
import { GlobalBus } from "@/bus/global"
import { BusEvent } from "@/bus/bus-event"
import fs from "fs/promises"
import path from "path"
import z from "zod"

interface Context {
  directory: string
  worktree: string
  project: Project.Info
}
const context = Context.create<Context>("instance")
const cache = new Map<string, Promise<Context>>()

export namespace InstanceEvent {
  export const DirectoryChanged = BusEvent.define(
    "instance.directory.changed",
    z.object({
      directory: z.string(),
      worktree: z.string(),
      projectID: z.string(),
      previousDirectory: z.string(),
    }),
  )
}

export const Instance = {
  async provide<R>(input: { directory: string; init?: () => Promise<any>; fn: () => R }): Promise<R> {
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
    Log.Default.info("disposing all instances")
    for (const [_key, value] of cache) {
      const awaited = await value.catch(() => {})
      if (awaited) {
        await context.provide(await value, async () => {
          await Instance.dispose()
        })
      }
    }
    cache.clear()
  },
  async setDirectory(targetPath: string) {
    const ctx = context.use()
    const oldDirectory = ctx.directory

    // Resolve path (relative to current directory or absolute)
    const resolved = path.isAbsolute(targetPath) ? targetPath : path.resolve(ctx.directory, targetPath)

    // Validate directory exists
    const stat = await fs.stat(resolved).catch(() => null)
    if (!stat?.isDirectory()) {
      throw new Error(`Directory not found: ${resolved}`)
    }

    // Get project info for the new directory
    const { project, sandbox } = await Project.fromDirectory(resolved)

    Log.Default.info("changing directory", {
      from: oldDirectory,
      to: resolved,
      worktree: sandbox,
      projectID: project.id,
    })

    // Dispose old state for the old directory to force re-initialization
    await State.dispose(oldDirectory)
    cache.delete(oldDirectory)

    // Update the context in place
    ctx.directory = resolved
    ctx.worktree = sandbox
    ctx.project = project

    // Cache the new context
    cache.set(resolved, Promise.resolve(ctx))

    // Emit event for UI/plugins
    GlobalBus.emit("event", {
      directory: resolved,
      payload: {
        type: InstanceEvent.DirectoryChanged.type,
        properties: {
          directory: resolved,
          worktree: sandbox,
          projectID: project.id,
          previousDirectory: oldDirectory,
        },
      },
    })

    return {
      directory: resolved,
      worktree: sandbox,
      project,
    }
  },
}
