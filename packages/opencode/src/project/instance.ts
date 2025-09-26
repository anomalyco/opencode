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

export const Instance = {
  async provide<R>(input: { directory: string; init?: () => Promise<any>; fn: () => R }): Promise<R> {
    let existing = cache.get(input.directory)
    if (!existing) {
      const project = await Project.fromDirectory(input.directory)
      existing = {
        directory: input.directory,
        worktree: project.worktree,
        project,
      }
    }
    return context.provide(existing, async () => {
      if (!cache.has(input.directory)) {
        await input.init?.()
        cache.set(input.directory, existing)
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
  state<S>(init: () => S, dispose?: (state: Awaited<S>) => Promise<void>): () => S {
    return State.create(() => Instance.directory, init, dispose)
  },
  async dispose() {
    await State.dispose(Instance.directory)
  },
}
