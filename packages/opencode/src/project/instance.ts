import { Context } from "../util/context"
import { Project } from "./project"
import { State } from "./state"

interface Context {
  directory: string
  worktree: string
  project: Project.Info
}
const context = Context.create<Context>("instance")
const cache = new Map<string, Context>()
const pending: string[] = []

export const Instance = {
  async provide<R>(input: { directory: string; init?: () => Promise<any>; fn: () => R }): Promise<R> {
    const dir = input.directory
    const cached = cache.get(dir)
    const existing = cached ?? (await (async () => {
      pending.push(dir)
      const project = await Project.fromDirectory(dir).finally(() => {
        pending.pop()
      })
      return {
        directory: dir,
        worktree: project.worktree,
        project,
      }
    })())
    return context.provide(existing, async () => {
      if (!cache.has(dir)) {
        await input.init?.()
        cache.set(dir, existing)
      }
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
  get pending() {
    return pending[pending.length - 1]
  },
  state<S>(init: () => S, dispose?: (state: Awaited<S>) => Promise<void>): () => S {
    return State.create(() => Instance.directory, init, dispose)
  },
  async dispose() {
    await State.dispose(Instance.directory)
  },
}
