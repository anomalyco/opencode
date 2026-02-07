import { createMemo } from "solid-js"
import { useKV } from "../../context/kv"
import { useSync } from "../../context/sync"

export function useVimEnabled() {
  const kv = useKV()
  const sync = useSync()

  return createMemo(() => {
    const stored = kv.get("input_vim_mode")
    if (stored !== undefined) return stored
    const tui = sync.data.config.tui as { vim?: boolean } | undefined
    return tui?.vim ?? false
  })
}
