const registry = new Set<() => Promise<void>>()

export function registerCleanup(fn: () => Promise<void>) {
  registry.add(fn)
  return () => {
    registry.delete(fn)
  }
}

export async function runCleanup(timeout = 2000) {
  if (registry.size === 0) return
  const fns = [...registry]
  registry.clear()
  await Promise.race([
    Promise.allSettled(fns.map((fn) => fn())),
    new Promise((resolve) => setTimeout(resolve, timeout)),
  ])
}
