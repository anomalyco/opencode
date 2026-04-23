import { Log } from "@/util/log"
import { Context } from "../util/context"
import path from "node:path"
import { Project } from "./project"
import { ProjectID } from "./schema"
import { State } from "./state"
import { iife } from "@/util/iife"
import { GlobalBus } from "@/bus/global"
import { Global } from "../global"
import { Filesystem } from "../util/filesystem"
import { localProject } from "./local-project"

type Info = Project.Info & { vcs?: "git" }

interface Ctx {
  project: Info
}

const context = Context.create<Ctx>("instance")
const cache = new Map<string, Promise<Ctx>>()

const disposal = {
  all: undefined as Promise<void> | undefined,
}

function emit(projectID: string) {
  GlobalBus.emit("event", {
    projectID,
    payload: {
      type: "server.instance.disposed",
      properties: {
        projectID,
      },
    },
  })
}

function boot(input: { project: Info; init?: () => Promise<any> }) {
  return iife(async () => {
    const ctx = { project: input.project }
    await context.provide(ctx, async () => {
      await input.init?.()
    })
    return ctx
  })
}

function track(projectID: string, next: Promise<Ctx>) {
  const task = next.catch((error) => {
    if (cache.get(projectID) === task) cache.delete(projectID)
    throw error
  })
  cache.set(projectID, task)
  return task
}

type ProvideGetInput =
  | { project: Info; init?: () => Promise<any> }
  | { directory: string; init?: () => Promise<any> }

function asBootInput(input: ProvideGetInput): { project: Info; init?: () => Promise<any> } {
  if ("project" in input) {
    return { project: input.project, init: input.init }
  }
  return { project: localProject(Filesystem.resolve(input.directory)), init: input.init }
}

export const Instance = {
  async provide<R>(input: ProvideGetInput & { fn: () => R }): Promise<R> {
    const { fn, ...getInput } = input
    const bootIn = asBootInput(getInput)
    const ctx = await Instance.get(bootIn)
    return context.provide(ctx, async () => {
      return fn()
    })
  },

  async get(input: ProvideGetInput): Promise<Ctx> {
    const { project, init } = asBootInput(input)
    const existing = cache.get(project.id)
    if (existing) return existing
    const next = track(project.id, boot({ project, init }))
    return next
  },
  
  get project() {
    return context.use().project
  },
  
  get projectID() {
    return context.use().project.id
  },

  get directory() {
    const p = this.project
    if (p.id === ProjectID.global) return Global.Path.home
    const id = p.id as string
    if (id.startsWith("/") || (process.platform === "win32" && /^[A-Za-z]:[\\/]/.test(id))) {
      return id
    }
    return `/projects/${id}`
  },

  /**
   * True when the resolved path is the project root or inside it (no `..` escape to a sibling of root).
   */
  containsPath(candidate: string) {
    const base = path.resolve(this.directory)
    const resolved = path.resolve(candidate)
    const rel = path.relative(base, resolved)
    if (rel === "") return true
    if (path.isAbsolute(rel) || rel.startsWith("..")) return false
    return true
  },
  
  state<S>(init: () => S, dispose?: (state: Awaited<S>) => Promise<void>): () => S {
    return State.create(() => Instance.projectID, init, dispose)
  },
  
  async reload(input: { project: Info; init?: () => Promise<any> }) {
    const projectID = input.project.id
    Log.Default.info("reloading instance", { projectID })
    await State.dispose(projectID)
    cache.delete(projectID)
    const next = track(projectID, boot(input))
    emit(projectID)
    return await next
  },
  
  async dispose() {
    const projectID = Instance.projectID
    Log.Default.info("disposing instance", { projectID })
    await State.dispose(projectID)
    cache.delete(projectID)
    emit(projectID)
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
