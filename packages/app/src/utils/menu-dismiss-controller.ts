export function createMenuDismissController(content: () => HTMLElement | undefined) {
  let restoreTrigger = true

  return {
    allowTriggerRestore() {
      restoreTrigger = true
    },
    preventTriggerRestore() {
      restoreTrigger = false
    },
    onCloseAutoFocus(event: Event) {
      if (!restoreTrigger) event.preventDefault()
    },
    afterClose(callback: () => void) {
      const complete = () => {
        if (content()?.isConnected) {
          requestAnimationFrame(complete)
          return
        }
        requestAnimationFrame(() => requestAnimationFrame(callback))
      }
      requestAnimationFrame(complete)
    },
  }
}
