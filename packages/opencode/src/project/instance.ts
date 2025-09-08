import { Context } from "../util/context"
import { Project } from "./project"
import { State } from "./state"

const context = Context.create<{ directory: string; worktree: string; project: Project.Info }>("path")

export const Instance = {
  async provide<R>(directory: string, cb: () => R): Promise<R> {
    const project = await Project.fromDirectory(directory)
    return context.provide({ directory, worktree: project.worktree, project }, cb)
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
