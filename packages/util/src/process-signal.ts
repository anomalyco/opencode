export * as ProcessSignal from "./process-signal.js"

const handlers = new Map<NodeJS.Signals, Set<() => void>>()

/** Install once at process startup. Removing subscribers never restores the signal's default action. */
export function install(signal: NodeJS.Signals, unavailable: () => void) {
  if (handlers.has(signal)) return
  const listeners = new Set<() => void>()
  handlers.set(signal, listeners)
  process.on(signal, () => {
    if (!listeners.size) return unavailable()
    listeners.forEach((listener) => listener())
  })
}

/** Subscribe only to an installed signal. The returned cleanup removes this subscriber, not the process handler. */
export function subscribe(signal: NodeJS.Signals, listener: () => void) {
  const listeners = handlers.get(signal)
  listeners?.add(listener)
  return () => {
    listeners?.delete(listener)
  }
}
