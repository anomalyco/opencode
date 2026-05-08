const scheduleIdle =
  typeof requestIdleCallback === "function"
    ? (fn: () => void, opts?: { timeout?: number }) => {
        const id = requestIdleCallback(fn, opts)
        return () => cancelIdleCallback(id)
      }
    : (fn: () => void, opts?: { timeout?: number }) => {
        const id = setTimeout(fn, opts?.timeout ?? 1)
        return () => clearTimeout(id)
      }

export { scheduleIdle }
