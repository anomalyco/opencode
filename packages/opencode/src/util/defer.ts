export function defer(fn: () => void | Promise<void>): AsyncDisposable & Disposable {
  return {
    [Symbol.dispose]() {
      const result = fn()
      if (result && typeof result.then === "function") {
        result.catch(() => {})
      }
    },
    [Symbol.asyncDispose]() {
      return Promise.resolve(fn())
    },
  }
}
