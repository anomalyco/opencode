export async function copyText(value: string) {
  const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard
  if (clipboard?.writeText) {
    const copied = await clipboard.writeText(value).then(
      () => true,
      () => false,
    )
    if (copied) return true
  }

  const body = typeof document === "undefined" ? undefined : document.body
  if (!body) return false

  const textarea = document.createElement("textarea")
  textarea.value = value
  textarea.setAttribute("readonly", "")
  textarea.style.position = "fixed"
  textarea.style.opacity = "0"
  textarea.style.pointerEvents = "none"
  body.appendChild(textarea)
  textarea.select()
  const copied = document.execCommand("copy")
  body.removeChild(textarea)
  return copied
}
