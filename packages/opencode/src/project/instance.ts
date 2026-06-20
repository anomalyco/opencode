import { AsyncLocalStorage } from "node:async_hooks"
import type { InstanceContext } from "./instance-context"
import { ProjectV2 } from "@opencode-ai/core/project"
import { Hash } from "@opencode-ai/core/util/hash"

const storage = new AsyncLocalStorage<InstanceContext>()
let fallback: InstanceContext | undefined

type LegacyProvideInput<T> = {
  directory: string
  worktree?: string
  project?: Partial<InstanceContext["project"]>
  init?: (directory: string) => unknown | Promise<unknown>
  fn: () => T
}

function requireContext() {
  const ctx = storage.getStore() ?? fallback
  if (!ctx) throw new Error("Instance context is not available")
  return ctx
}

function provide<T>(ctx: InstanceContext, fn: () => T): T
function provide<T>(input: LegacyProvideInput<T>): T
function provide<T>(ctxOrInput: InstanceContext | LegacyProvideInput<T>, fn?: () => T): T {
  if (fn) return storage.run(ctxOrInput as InstanceContext, fn)
  const input = ctxOrInput as LegacyProvideInput<T>
  const worktree = input.worktree ?? input.directory
  const run = () => {
    const initialized = input.init?.(input.directory)
    if (initialized instanceof Promise) return initialized.then(input.fn) as T
    return input.fn()
  }
  return storage.run(
    {
      directory: input.directory,
      worktree,
      project: {
        id: ProjectV2.ID.make(Hash.fast(worktree)),
        worktree,
        time: { created: 0, updated: 0 },
        sandboxes: [],
        ...input.project,
      },
    },
    run,
  )
}

export const Instance = {
  set(ctx: InstanceContext) {
    fallback = ctx
  },
  current() {
    return storage.getStore() ?? fallback
  },
  provide,
  get directory() {
    return requireContext().directory
  },
  get worktree() {
    return requireContext().worktree
  },
  get project() {
    return requireContext().project
  },
}
