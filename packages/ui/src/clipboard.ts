const clipboardWrite = async (value: string): Promise<boolean> => {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value)
      return true
    } catch {
    }
  }

  if (typeof document !== "undefined") {
    const textarea = document.createElement("textarea")
    textarea.value = value
    textarea.setAttribute("readonly", "")
    textarea.style.position = "fixed"
    textarea.style.opacity = "0"
    textarea.style.pointerEvents = "none"
    document.body.appendChild(textarea)
    textarea.select()
    const copied = document.execCommand("copy")
    document.body.removeChild(textarea)
    if (copied) return true
  }

  return false
}

export { clipboardWrite }
