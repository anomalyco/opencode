import { createMemo } from "solid-js"
import { useSync } from "@tui/context/sync"

type AccessibilityConfig = {
  tui?: {
    accessibility?: {
      numbered_menus?: boolean
      ascii?: boolean
    }
  }
}

export function useAccessibility() {
  const sync = useSync()
  return createMemo(() => {
    const config = sync.data.config as AccessibilityConfig
    return config.tui?.accessibility?.ascii === true
  })
}

export function useNumberedMenus() {
  const sync = useSync()
  return createMemo(() => {
    const config = sync.data.config as AccessibilityConfig
    return config.tui?.accessibility?.numbered_menus === true
  })
}
