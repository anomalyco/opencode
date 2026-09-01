import { createMemo, type Accessor } from "solid-js"
import createPresence from "solid-presence"

export function createAnimatedPresence<T>(
  value: Accessor<T | undefined>,
  element: Accessor<HTMLElement | null>,
  identity?: Accessor<unknown>,
) {
  const animation = createMemo<{ identity?: unknown; show: boolean; animate: boolean; value: T | undefined }>(
    (previous) => {
      const currentIdentity = identity?.()
      const current = value()
      const show = current !== undefined
      const same = !identity || previous?.identity === currentIdentity
      return {
        identity: currentIdentity,
        show,
        animate: previous !== undefined && same && (previous.animate || previous.show !== show),
        value: current ?? (same ? previous?.value : undefined),
      }
    },
  )
  const presence = createPresence({ show: () => animation().show, element })
  return {
    ...presence,
    show: () => animation().show,
    animate: () => animation().animate,
    value: () => animation().value,
  }
}
