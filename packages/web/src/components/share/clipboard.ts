/**
 * Copy text to clipboard with fallback for non-HTTPS environments.
 * Uses document.execCommand('copy') as fallback when navigator.clipboard is unavailable.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false

  // Try navigator.clipboard.writeText first (modern API)
  const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard
  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(text)
      return true
    } catch {
      // Fall through to execCommand fallback
    }
  }

  // Fallback to document.execCommand('copy') for older browsers / non-HTTPS
  const body = typeof document === "undefined" ? undefined : document.body
  if (body) {
    const textarea = document.createElement("textarea")
    textarea.value = text
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

  return false
}
