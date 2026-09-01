import { createMemo, type Accessor } from "solid-js"

export function createPaneMotion(key: Accessor<string | undefined>, opened: Accessor<boolean>) {
  const state = createMemo<{ key?: string; opened: boolean; animate: boolean }>((previous) => {
    const currentKey = key()
    const currentOpened = opened()
    return {
      key: currentKey,
      opened: currentOpened,
      animate: !!previous && previous.key === currentKey && previous.opened !== currentOpened,
    }
  })
  return {
    animate: () => state().animate,
    opened: () => state().opened,
  }
}
