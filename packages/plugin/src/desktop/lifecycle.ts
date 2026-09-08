import type { Lifecycle } from "./context.js"

export function createLifecycle(): Lifecycle & { dispose(): void } {
  const controller = new AbortController()
  const owned = new Set<() => void>()
  return {
    signal: controller.signal,
    own(dispose) {
      if (controller.signal.aborted) {
        dispose()
        return () => {}
      }
      const cleanup = () => {
        if (owned.delete(cleanup)) dispose()
      }
      owned.add(cleanup)
      return cleanup
    },
    dispose() {
      if (controller.signal.aborted) return
      controller.abort()
      const failures: unknown[] = []
      Array.from(owned)
        .reverse()
        .forEach((dispose) => {
          try {
            dispose()
          } catch (error) {
            failures.push(error)
          }
        })
      if (failures.length) throw new AggregateError(failures, "Extension cleanup failed")
    },
  }
}
