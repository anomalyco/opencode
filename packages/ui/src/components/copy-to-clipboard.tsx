export const copyToClipboard = async (text: string) => {
  const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard
  const secure = typeof window === "undefined" ? true : window.isSecureContext
  if (clipboard?.writeText && secure) {
    return clipboard.writeText(text).then(
      () => true,
      () => fallbackCopy(text),
    )
  }

  return fallbackCopy(text)
}

const fallbackCopy = (text: string) => {
  if (typeof document === "undefined") return false
  const body = document.body
  if (!body) return false

  const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const activeInput =
    activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement
      ? activeElement
      : null
  const activeInputSelection =
    activeInput &&
    activeInput.selectionStart !== null &&
    activeInput.selectionEnd !== null
      ? {
          start: activeInput.selectionStart,
          end: activeInput.selectionEnd,
          direction: activeInput.selectionDirection,
        }
      : null
  const selection = typeof document.getSelection === "function" ? document.getSelection() : null
  const ranges =
    selection && selection.rangeCount > 0
      ? Array.from({ length: selection.rangeCount }, (_, index) =>
          selection.getRangeAt(index).cloneRange(),
        )
      : []

  const textarea = document.createElement("textarea")
  textarea.value = text
  textarea.setAttribute("readonly", "")
  textarea.style.position = "fixed"
  textarea.style.opacity = "0"
  textarea.style.pointerEvents = "none"
  body.appendChild(textarea)

  try {
    textarea.focus()
    textarea.select()
    return typeof document.execCommand === "function" && document.execCommand("copy")
  } finally {
    if (textarea.parentNode === body) body.removeChild(textarea)
    if (!activeElement?.isConnected) return

    activeElement.focus({ preventScroll: true })

    if (activeInputSelection && activeInput?.isConnected) {
      activeInput.setSelectionRange(
        activeInputSelection.start,
        activeInputSelection.end,
        activeInputSelection.direction ?? undefined,
      )
      return
    }

    if (!selection || ranges.length === 0) return
    selection.removeAllRanges()
    ranges.forEach((range) => selection.addRange(range))
  }
}
