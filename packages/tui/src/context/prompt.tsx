import { createSimpleContext } from "./helper"
import type { PromptRef } from "../component/prompt"

export function createPromptRefContextValue() {
  let current: PromptRef | undefined
  const changeSubscribers = new Set<() => void>()
  const cursorSubscribers = new Set<() => void>()

  let emittingChange = false
  let emittingCursor = false

  const fire = (subs: Set<() => void>) => {
    for (const callback of subs) {
      try {
        callback()
      } catch {
        // a bad subscriber must not break the prompt or other subscribers
      }
    }
  }

  return {
    get current() {
      return current
    },
    set(ref: PromptRef | undefined) {
      current = ref
    },
    /** Subscribe to prompt content changes (fires per keystroke / programmatic
     *  edit). Survives prompt remounts (route changes) — the subscription
     *  lives on the context, not the component. Returns a disposer. Note:
     *  per-channel reentrancy is guarded (a nested same-channel emit is
     *  dropped), but a subscriber that mutates the OTHER channel which in
     *  turn mutates this one can form a synchronous A→B→A loop. Plugins
     *  MUST NOT create circular cross-channel mutations. */
    onChange(callback: () => void) {
      changeSubscribers.add(callback)
      return () => {
        changeSubscribers.delete(callback)
      }
    },
    /** Called by the prompt component's onContentChange. Per-channel reentrancy:
     *  a nested emitChange from within a change subscriber is dropped; a cursor
     *  emit from within a change subscriber still fires (independent channel). */
    emitChange() {
      if (emittingChange) return
      emittingChange = true
      try {
        fire(changeSubscribers)
      } finally {
        emittingChange = false
      }
    },
    /** Subscribe to prompt cursor moves (arrows, click, drag, word-moves,
     *  paste, delete, undo/redo). Survives prompt remounts. Returns a
     *  disposer. Note: per-channel reentrancy is guarded (a nested
     *  same-channel emit is dropped), but a subscriber that mutates the
     *  OTHER channel which in turn mutates this one can form a synchronous
     *  A→B→A loop. Plugins MUST NOT create circular cross-channel
     *  mutations. */
    onCursorChange(callback: () => void) {
      cursorSubscribers.add(callback)
      return () => {
        cursorSubscribers.delete(callback)
      }
    },
    /** Called by the prompt component's onCursorChange. Per-channel reentrancy:
     *  a nested emitCursorChange from within a cursor subscriber is dropped. */
    emitCursorChange() {
      if (emittingCursor) return
      emittingCursor = true
      try {
        fire(cursorSubscribers)
      } finally {
        emittingCursor = false
      }
    },
  }
}

export const { use: usePromptRef, provider: PromptRefProvider } = createSimpleContext({
  name: "PromptRef",
  init: createPromptRefContextValue,
})
