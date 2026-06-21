import { AsyncLocalStorage } from "node:async_hooks"
import type { InstanceContext } from "./instance-context"

const storage = new AsyncLocalStorage<InstanceContext>()
let fallback: InstanceContext | undefined

export function setCurrentInstance(ctx: InstanceContext) {
  fallback = ctx
}

export function currentInstance() {
  return storage.getStore() ?? fallback
}

export function requireInstanceContext() {
  const ctx = currentInstance()
  if (!ctx) throw new Error("Instance context is not available")
  return ctx
}

export function provideInstanceContext<T>(ctx: InstanceContext, fn: () => T): T {
  return storage.run(ctx, fn)
}
