/** Coordinates focus restoration and actions that must run after menu content unmounts. */
export function createMenuDismissController(content: () => HTMLElement | undefined) {
  let restoreTrigger = true
  let pending: (() => void) | undefined

  const run = () => {
    const callback = pending
    pending = undefined
    callback?.()
  }

  return {
    /** Allows the menu primitive to restore focus to its trigger when closing. */
    allowTriggerRestore() {
      restoreTrigger = true
    },
    /** Keeps focus at its current or next destination instead of returning it to the trigger. */
    preventTriggerRestore() {
      restoreTrigger = false
    },
    /** Applies the current restoration policy during the menu primitive's close-focus event. */
    onCloseAutoFocus(event: Event) {
      if (restoreTrigger) return
      event.preventDefault()
      const focused = document.activeElement
      // Kobalte's dropdown focuses its trigger after this handler anyway, so undo that before the next paint.
      queueMicrotask(() => {
        const trigger = document.activeElement

        if (trigger !== focused && trigger instanceof HTMLElement) trigger.blur()
        run()
      })
    },
    /** Runs an action after the menu unmounts and its focus-close work has settled. */
    afterClose(callback: () => void) {
      pending = callback

      const complete = () => {
        if (!pending) return

        if (content()?.isConnected) {
          requestAnimationFrame(complete)

          return
        }

        requestAnimationFrame(() => requestAnimationFrame(run))
      }

      requestAnimationFrame(complete)
    },
  }
}
