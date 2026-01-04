import { AsyncLocalStorage } from "async_hooks"

export namespace ProcessCwd {
  type Store = {
    stack: string[]
  }

  const storage = new AsyncLocalStorage<Store>()
  let lock: Promise<void> = Promise.resolve()

  export async function run<T>(cwd: string, fn: () => Promise<T> | T): Promise<T> {
    const store = storage.getStore()
    if (store) {
      const previous = process.cwd()
      if (previous === cwd) return fn()

      store.stack.push(previous)
      try {
        process.chdir(cwd)
      } catch (error) {
        store.stack.pop()
        throw error
      }

      try {
        return await fn()
      } finally {
        const restore = store.stack.pop() ?? previous
        process.chdir(restore)
      }
    }

    const currentLock = lock
    let release: () => void = () => {}
    const nextLock = new Promise<void>((resolve) => {
      release = resolve
    })
    const chained = currentLock.then(() => nextLock)
    lock = chained

    await currentLock
    const previous = process.cwd()
    let changed = false

    try {
      if (previous !== cwd) {
        process.chdir(cwd)
        changed = true
      }
      return await storage.run({ stack: [] }, fn)
    } finally {
      if (changed) {
        process.chdir(previous)
      }
      release()
      if (lock === chained) lock = Promise.resolve()
    }
  }
}
