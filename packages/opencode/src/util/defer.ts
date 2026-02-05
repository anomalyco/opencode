export function defer(fn: () => void): { [Symbol.dispose]: () => void }
export function defer(fn: () => Promise<void>): { [Symbol.asyncDispose]: () => Promise<void> }
export function defer(fn: () => void | Promise<void>) {
  return {
    [Symbol.dispose]() {
      fn()
    },
    [Symbol.asyncDispose]() {
      return Promise.resolve(fn())
    },
  }
}
