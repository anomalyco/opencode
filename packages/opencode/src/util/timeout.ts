export function withTimeout<T>(promise: Promise<T>, ms: number, label?: string): Promise<T> {
  let timeout: NodeJS.Timeout
  return Promise.race([
    promise.finally(() => {
      clearTimeout(timeout)
    }),
    new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        reject(new Error(label ?? `Operation timed out after ${ms}ms`))
      }, ms)
    }),
  ])
}
