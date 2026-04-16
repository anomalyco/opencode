export function defer<T extends () => void | Promise<void>>(
  fn: T,
): T extends () => Promise<void> ? { [Symbol.asyncDispose]: () => Promise<void> } : { [Symbol.dispose]: () => void } {
  return {
    [Symbol.dispose]() {
      void fn()
    },
    [Symbol.asyncDispose]() {
      return Promise.resolve(fn())
    },
  } as any
}
