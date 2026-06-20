import { AsyncLocalStorage } from "node:async_hooks"
import type { InstanceContext } from "./instance-context"

const storage = new AsyncLocalStorage<InstanceContext>()
let fallback: InstanceContext | undefined

function requireContext() {
  const ctx = storage.getStore() ?? fallback
  if (!ctx) throw new Error("Instance context is not available")
  return ctx
}

export const Instance = {
  set(ctx: InstanceContext) {
    fallback = ctx
  },
  current() {
    return storage.getStore() ?? fallback
  },
  provide<T>(ctx: InstanceContext, fn: () => T): T {
    return storage.run(ctx, fn)
  },
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
