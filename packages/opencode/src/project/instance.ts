import { AsyncLocalStorage } from "node:async_hooks"
import type { InstanceContext } from "./instance-context"
import { InstanceRuntime } from "./instance-runtime"

const storage = new AsyncLocalStorage<InstanceContext>()
let fallback: InstanceContext | undefined

type LegacyProvideInput<T> = {
  directory: string
  worktree?: string
  project?: InstanceContext["project"]
  init?: (directory: string) => unknown | Promise<unknown>
  fn: (ctx: InstanceContext) => T
}

function requireContext() {
  const ctx = storage.getStore() ?? fallback
  if (!ctx) throw new Error("Instance context is not available")
  return ctx
}

function provide<T>(ctx: InstanceContext, fn: () => T): T
function provide<T>(input: LegacyProvideInput<T>): Promise<Awaited<T>>
function provide<T>(ctxOrInput: InstanceContext | LegacyProvideInput<T>, fn?: () => T): T | Promise<Awaited<T>> {
  if (fn) return storage.run(ctxOrInput as InstanceContext, fn)
  const input = ctxOrInput as LegacyProvideInput<T>
  return provideLegacy(input)
}

async function provideLegacy<T>(input: LegacyProvideInput<T>): Promise<Awaited<T>> {
  const ctx = await InstanceRuntime.load({
    directory: input.directory,
    worktree: input.worktree,
    project: input.project,
  })
  try {
    return await storage.run(ctx, async () => {
      await input.init?.(ctx.directory)
      return input.fn(ctx)
    })
  } finally {
    await InstanceRuntime.disposeInstance(ctx)
  }
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
