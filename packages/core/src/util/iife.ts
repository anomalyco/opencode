export function iife<T>(fn: () => T) {
  return fn()
}
