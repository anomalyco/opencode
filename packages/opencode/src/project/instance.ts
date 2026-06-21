import type { InstanceContext } from "./instance-context"
import {
  currentInstance,
  provideInstanceContext,
  requireInstanceContext,
  setCurrentInstance,
} from "./instance-current"
import { InstanceRuntime } from "./instance-runtime"

type LegacyProvideInput<T> = {
  directory: string
  worktree?: string
  project?: InstanceContext["project"]
  init?: (directory: string) => unknown | Promise<unknown>
  fn: (ctx: InstanceContext) => T
}

function provide<T>(ctx: InstanceContext, fn: () => T): T
function provide<T>(input: LegacyProvideInput<T>): Promise<Awaited<T>>
function provide<T>(ctxOrInput: InstanceContext | LegacyProvideInput<T>, fn?: () => T): T | Promise<Awaited<T>> {
  if (fn) return provideInstanceContext(ctxOrInput as InstanceContext, fn)
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
    return await provideInstanceContext(ctx, async () => {
      await input.init?.(ctx.directory)
      return input.fn(ctx)
    })
  } finally {
    await InstanceRuntime.disposeInstance(ctx)
  }
}

export const Instance = {
  set(ctx: InstanceContext) {
    setCurrentInstance(ctx)
  },
  current() {
    return currentInstance()
  },
  provide,
  get directory() {
    return requireInstanceContext().directory
  },
  get worktree() {
    return requireInstanceContext().worktree
  },
  get project() {
    return requireInstanceContext().project
  },
}
