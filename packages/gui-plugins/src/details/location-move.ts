import { createStore } from "solid-js/store"

// The location card unmounts when it closes, so a move in flight must outlive the menu that started it.
export function createLocationMoves() {
  const [state, setState] = createStore<{ pending: Record<string, true | undefined> }>({ pending: {} })

  return {
    pending(sessionKey: string) {
      return !!state.pending[sessionKey]
    },
    begin(sessionKey: string) {
      if (state.pending[sessionKey]) return false
      setState("pending", sessionKey, true)

      return true
    },
    end(sessionKey: string) {
      setState("pending", sessionKey, undefined)
    },
  }
}

export type LocationMoves = ReturnType<typeof createLocationMoves>
