import { createMemo } from "solid-js"
import { useSync } from "@tui/context/sync"

type AccessibilityConfig = {
  tui?: {
    accessibility?: {
      numbered_menus?: boolean
    }
  }
}

export function useAccessibility() {
  const sync = useSync()
  return createMemo(() => {
    const config = sync.data.config as AccessibilityConfig
    return config.tui?.accessibility?.numbered_menus === true
  })
}
