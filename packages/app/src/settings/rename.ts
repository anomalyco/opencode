import { createSignal, onCleanup, untrack } from "solid-js"
import {
  INITIAL_INLINE_RENAME_STATE,
  selectInlineRenameDraft,
  selectInlineRenameMenuOpen,
  selectInlineRenameOpen,
  selectInlineRenameSaving,
  transitionInlineRename,
  type InlineRenameBlurPolicy,
  type InlineRenameEffect,
  type InlineRenameEvent,
} from "./rename-machine"

/** Drives an inline rename field in Settings: its save, the save's timeout and where focus goes after. */
export function createInlineRename(options: {
  /** Opens the field with this value at once, for a field that only exists while renaming. */
  open?: string
  blurPolicy: InlineRenameBlurPolicy
  /** The name shown now; saving it unchanged closes the field. */
  current: () => string
  input: () => HTMLInputElement | undefined
  trigger?: () => HTMLElement | undefined
  onSave: (value: string) => Promise<boolean>
  onClose?: () => void
  onTimeout: () => void
}) {
  const [state, setState] = createSignal(INITIAL_INLINE_RENAME_STATE)
  const timers = new Map<number, ReturnType<typeof setTimeout>>()
  let frame: number | undefined

  const dispatch = (event: InlineRenameEvent) =>
    untrack(() => {
      const previous = state()
      const next = transitionInlineRename(previous, event)

      if (next.state !== previous) setState(next.state)
      next.effects.forEach(run)
    })

  const settle = (attempt: number, event: InlineRenameEvent) => {
    clearTimeout(timers.get(attempt))
    timers.delete(attempt)
    dispatch(event)
  }

  function run(effect: InlineRenameEffect) {
    if (effect.type === "closed.notify") return options.onClose?.()

    if (effect.type === "toast.timeout") return options.onTimeout()

    if (effect.type === "save.cancel") {
      timers.forEach((timer) => clearTimeout(timer))
      timers.clear()

      return
    }

    if (effect.type === "save.run") {
      const attempt = effect.attempt
      timers.set(
        attempt,
        setTimeout(() => settle(attempt, { type: "save.timed-out", attempt }), effect.timeoutMs),
      )
      void Promise.try(() => options.onSave(effect.value))
        .catch(() => false)
        .then((saved) => settle(attempt, { type: saved ? "save.succeeded" : "save.failed", attempt }))

      return
    }

    if (frame !== undefined) cancelAnimationFrame(frame)
    frame = undefined

    if (effect.type === "focus.cancel") return
    const active = document.activeElement

    if (effect.ifOwned && active !== document.body && active !== options.input() && active !== options.trigger?.())
      return
    // Waits a frame so a closing menu's focus restore cannot pull focus back, and the trigger has rendered again.
    frame = requestAnimationFrame(() => {
      frame = undefined

      if (effect.type === "focus.trigger") return options.trigger?.()?.focus()
      const input = options.input()
      input?.focus()

      if (effect.select) input?.select()
    })
  }

  if (options.open !== undefined) dispatch({ type: "started", value: options.open })
  onCleanup(() => dispatch({ type: "disposed" }))

  return {
    open: () => selectInlineRenameOpen(state()),
    draft: () => selectInlineRenameDraft(state()),
    saving: () => selectInlineRenameSaving(state()),
    menuOpen: () => selectInlineRenameMenuOpen(state()),
    start: (value: string) => dispatch({ type: "started", value }),
    setMenu: (open: boolean) => dispatch({ type: "menu.changed", open }),
    input: (draft: string) => dispatch({ type: "input", draft }),
    blur: () => dispatch({ type: "blurred", policy: options.blurPolicy, currentValue: options.current() }),
    keyDown: (event: KeyboardEvent) => {
      event.stopPropagation()

      if (event.isComposing || event.keyCode === 229) return

      if (event.key === "Enter") {
        event.preventDefault()
        dispatch({ type: "submitted", currentValue: options.current() })

        return
      }

      if (event.key !== "Escape") return
      event.preventDefault()
      dispatch({ type: "cancelled" })
    },
  }
}
