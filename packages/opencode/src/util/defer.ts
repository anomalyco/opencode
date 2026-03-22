export function defer<T extends () => void | Promise<void>>(
  fn: T,
): T extends () => Promise<void> ? { [Symbol.asyncDispose]: () => Promise<void> } : { [Symbol.dispose]: () => void } {
  return {
    [Symbol.dispose]() {
      try {
        fn()
      } catch (e) {
        console.error("Error in dispose:", e)
        throw e
      }
    },
    [Symbol.asyncDispose]() {
      return Promise.resolve(fn()).catch((e) => {
        console.error("Error in asyncDispose:", e)
        throw e
      })
    },
  } as any
}
