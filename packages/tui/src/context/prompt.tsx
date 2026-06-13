import { createSimpleContext } from "./helper"
import type { PromptRef } from "../component/prompt"

export function createPromptRefContextValue() {
  let current: PromptRef | undefined
  const changeSubscribers = new Set<() => void>()
  const cursorSubscribers = new Set<() => void>()

  const emit = (subs: Set<() => void>) => {
    if (emitting) return
    emitting = true
    try {
      for (const callback of subs) {
        try {
          callback()
        } catch {
          // a bad subscriber must not break the prompt or other subscribers
        }
      }
    } finally {
      emitting = false
    }
  }
  let emitting = false

  return {
    get current() {
      return current
    },
    set(ref: PromptRef | undefined) {
      current = ref
    },
    /** Subscribe to prompt content changes (fires per keystroke / programmatic
     *  edit). Survives prompt remounts (route changes) — the subscription
     *  lives on the context, not the component. Returns a disposer. */
    onChange(callback: () => void) {
      changeSubscribers.add(callback)
      return () => {
        changeSubscribers.delete(callback)
      }
    },
    /** Called by the prompt component's onContentChange. Reentrancy: nested
     *  emit calls from within a subscriber are dropped to prevent loops. */
    emitChange() {
      emit(changeSubscribers)
    },
    /** Subscribe to prompt cursor moves (arrows, click, drag, word-moves,
     *  paste, delete, undo/redo). Survives prompt remounts. Returns a
     *  disposer. */
    onCursorChange(callback: () => void) {
      cursorSubscribers.add(callback)
      return () => {
        cursorSubscribers.delete(callback)
      }
    },
    /** Called by the prompt component's onCursorChange. Reentrancy: nested
     *  emit calls from within a subscriber are dropped to prevent loops. */
    emitCursorChange() {
      emit(cursorSubscribers)
    },
  }
}

export const { use: usePromptRef, provider: PromptRefProvider } = createSimpleContext({
  name: "PromptRef",
  init: createPromptRefContextValue,
})
