import { createMemo, type Accessor } from "solid-js"
import type { createVimState } from "./vim-state"

export function useVimIndicator(input: {
  enabled: Accessor<boolean>
  active: Accessor<boolean>
  state: ReturnType<typeof createVimState>
}) {
  return createMemo(() => {
    if (!input.enabled() || !input.active()) return
    return input.state.isInsert() ? "INSERT" : "NORMAL"
  })
}
