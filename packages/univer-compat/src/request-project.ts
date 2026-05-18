import { AsyncLocalStorage } from "node:async_hooks"

const pid = new AsyncLocalStorage<string>()

export function runWithRequestProject<T>(projectId: string, fn: () => T): T {
  return pid.run(projectId, fn)
}

export async function runWithRequestProjectAsync<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
  return pid.run(projectId, fn)
}

export function requireRequestProjectId(): string {
  const v = pid.getStore()
  if (!v) throw new Error("missing request project")
  return v
}
