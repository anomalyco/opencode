export async function copyToClipboard(text: string): Promise<boolean> {
  const isSecure =
    typeof window !== "undefined" &&
    (window.isSecureContext ?? (location.protocol === "https:" || location.hostname === "localhost"))
  if (isSecure && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return true
  }
  const textarea = document.createElement("textarea")
  textarea.value = text
  textarea.style.position = "fixed"
  textarea.style.left = "-9999px"
  textarea.style.top = "-9999px"
  textarea.style.opacity = "0"
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  try {
    const ok = document.execCommand("copy")
    document.body.removeChild(textarea)
    return ok
  } catch {
    document.body.removeChild(textarea)
    return false
  }
}
