import { AsyncLocalStorage } from "async_hooks"

export namespace ProcessCwd {
  const storage = new AsyncLocalStorage<{}>()
  let queue: Promise<void> = Promise.resolve()

  export async function run<T>(cwd: string, fn: () => Promise<T> | T): Promise<T> {
    if (storage.getStore()) {
      const previous = process.cwd()
      if (previous === cwd) return fn()
      process.chdir(cwd)
      try {
        return await fn()
      } finally {
        process.chdir(previous)
      }
    }

    const task = queue.then(async () => {
      const previous = process.cwd()
      const changed = previous !== cwd
      if (changed) process.chdir(cwd)
      try {
        return await storage.run({}, fn)
      } finally {
        if (changed) process.chdir(previous)
      }
    })

    queue = task.then(
      () => {},
      () => {},
    )
    return task
  }
}
