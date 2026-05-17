import { AsyncLocalStorage } from "node:async_hooks"

const uid = new AsyncLocalStorage<string>()

export function runWithRequestUser<T>(userId: string, fn: () => T): T {
  return uid.run(userId, fn)
}

export async function runWithRequestUserAsync<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  return uid.run(userId, fn)
}

export function requireRequestUserId(): string {
  const v = uid.getStore()
  if (!v) throw new Error("missing request user")
  return v
}
