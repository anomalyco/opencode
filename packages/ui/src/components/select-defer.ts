export function deferSelect<T>(callback: ((value: T) => void) | undefined, value: T) {
  // Kobalte closes the popup after onChange returns. Controlled updates must wait
  // so they cannot rebuild the value or options during portal cleanup.
  queueMicrotask(() => callback?.(value))
}
