// Browser-compatible AsyncLocalStorage shim
// Uses a simple stack-based approach since browser is single-threaded
export class AsyncLocalStorage<T> {
  private _stack: Array<{ store: T }> = []

  private remove(entry: { store: T }): void {
    const index = this._stack.lastIndexOf(entry)
    if (index >= 0) {
      this._stack.splice(index, 1)
    }
  }

  getStore(): T | undefined {
    return this._stack[this._stack.length - 1]?.store
  }

  run<R>(store: T, fn: () => R): R {
    const entry = { store }
    this._stack.push(entry)

    try {
      const result = fn()

      if (
        result &&
        (typeof result === "object" || typeof result === "function") &&
        typeof (result as PromiseLike<unknown>).then === "function"
      ) {
        return Promise.resolve(result).finally(() => {
          this.remove(entry)
        }) as R
      }

      this.remove(entry)
      return result
    } catch (error) {
      this.remove(entry)
      throw error
    }
  }

  enterWith(store: T): void {
    this._stack.push({ store })
  }

  disable(): void {
    this._stack.length = 0
  }
}

export class AsyncResource {
  constructor(_type: string) {}
  runInAsyncScope<R>(fn: () => R): R { return fn() }
  emitDestroy(): this { return this }
  asyncId(): number { return 0 }
  triggerAsyncId(): number { return 0 }
}

export function executionAsyncId(): number { return 0 }
export function triggerAsyncId(): number { return 0 }
export function createHook(): { enable(): void; disable(): void } {
  return { enable() {}, disable() {} }
}
