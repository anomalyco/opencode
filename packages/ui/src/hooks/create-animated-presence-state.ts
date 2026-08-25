import { createMemo, type Accessor } from "solid-js"

export function createAnimatedPresenceState<T>(value: Accessor<T | undefined>) {
  return createMemo<{ show: boolean; animate: boolean; value: T | undefined }>((previous) => {
    const current = value()
    const show = current !== undefined
    return {
      show,
      animate: previous !== undefined && (previous.animate || previous.show !== show),
      value: current ?? previous?.value,
    }
  })
}
