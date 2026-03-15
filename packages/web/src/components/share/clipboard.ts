function exec(text: string) {
  if (typeof document === "undefined") return false
  const el = document.createElement("textarea")
  el.value = text
  el.setAttribute("readonly", "")
  el.style.position = "fixed"
  el.style.opacity = "0"
  el.style.pointerEvents = "none"
  document.body.appendChild(el)
  el.select()
  const ok = document.execCommand("copy")
  document.body.removeChild(el)
  return ok
}

export function copy(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).then(
      () => true,
      () => exec(text),
    )
  }
  return Promise.resolve(exec(text))
}
