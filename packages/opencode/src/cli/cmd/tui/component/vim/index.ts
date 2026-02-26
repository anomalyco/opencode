import { createMemo } from "solid-js"
import { useKV } from "../../context/kv"
import { useTuiConfig } from "../../context/tui-config"

export function useVimEnabled() {
  const kv = useKV()
  const config = useTuiConfig()

  return createMemo(() => {
    const stored = kv.get("input_vim_mode")
    if (stored !== undefined) return stored
    return config.vim ?? false
  })
}
