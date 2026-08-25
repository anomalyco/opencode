import { createMemo, type Accessor } from "solid-js"
import createPresence from "solid-presence"

export function createAnimatedPresence<T>(value: Accessor<T | undefined>, element: Accessor<HTMLElement | null>) {
  const animation = createMemo<{ show: boolean; animate: boolean; value: T | undefined }>((previous) => {
    const current = value()
    const show = current !== undefined
    return {
      show,
      animate: previous !== undefined && (previous.animate || previous.show !== show),
      value: current ?? previous?.value,
    }
  })
  const presence = createPresence({ show: () => animation().show, element })
  return {
    ...presence,
    show: () => animation().show,
    animate: () => animation().animate,
    value: () => animation().value,
  }
}
