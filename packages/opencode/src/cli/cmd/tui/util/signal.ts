import { createSignal, type Accessor } from "solid-js"
import { debounce, type Scheduled } from "@solid-primitives/scheduled"

/**
 * Creates a Solid signal with debounced updates.
 *
 * Returns a tuple with a getter function and a debounced setter that delays
 * updates until the specified milliseconds have passed since the last call.
 *
 * @example
 * ```typescript
 * const [value, setValue] = createDebouncedSignal("", 300)
 * setValue("new value") // Will update after 300ms of inactivity
 * ```
 */
export function createDebouncedSignal<T>(value: T, ms: number): [Accessor<T>, Scheduled<[value: T]>] {
  const [get, set] = createSignal(value)
  return [get, debounce((v: T) => set(() => v), ms)]
}
