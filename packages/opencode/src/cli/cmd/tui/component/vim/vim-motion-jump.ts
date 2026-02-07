import type { VimEvent } from "./vim-handler"
import type { createVimState } from "./vim-state"

export type VimJump = "top" | "bottom"

export function vimJump(event: VimEvent, state: ReturnType<typeof createVimState>) {
  const key = event.name ?? ""
  const hasModifier = !!event.ctrl || !!event.meta || !!event.super

  if (hasModifier) {
    if (state.pending() === "g") state.clearPending()
    return { handled: false }
  }

  if (key === "G" || (key === "g" && event.shift)) {
    state.clearPending()
    return { action: "bottom" as VimJump, handled: true }
  }

  if (key !== "g") {
    if (state.pending() === "g") state.clearPending()
    return { handled: false }
  }

  if (state.pending() === "g") {
    state.clearPending()
    return { action: "top" as VimJump, handled: true }
  }

  state.setPending("g")
  return { handled: true }
}
