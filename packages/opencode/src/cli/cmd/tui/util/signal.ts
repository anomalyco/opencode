import { createSignal, type Accessor } from "solid-js"
import { debounce, type Scheduled } from "@solid-primitives/scheduled"

/**
 * Creates a debounced signal that delays updating the value until after the specified
 * wait time has elapsed since the last change.
 *
 * This is useful for reducing the frequency of updates in response to rapid changes,
 * such as user input in a text field.
 *
 * @param value - The initial value of the signal
 * @param ms - The debounce delay in milliseconds
 * @returns A tuple containing the signal accessor and the debounced setter
 * @example
 * ```typescript
 * const [text, setText] = createDebouncedSignal("", 300)
 * // setText is debounced - updates will be delayed by 300ms
 * setText("new value")
 * ```
 */
export function createDebouncedSignal<T>(value: T, ms: number): [Accessor<T>, Scheduled<[value: T]>] {
  const [get, set] = createSignal(value)
  return [get, debounce((v: T) => set(() => v), ms)]
}
