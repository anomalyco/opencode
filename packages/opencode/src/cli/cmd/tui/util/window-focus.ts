export function windowFocus(input: {
  renderer: {
    on: (event: string, fn: () => void) => void
    off?: (event: string, fn: () => void) => void
    removeListener?: (event: string, fn: () => void) => void
  }
  publish: (focused: boolean) => Promise<void> | void
}) {
  const handleFocus = () => {
    input.publish(true)
  }
  const handleBlur = () => {
    input.publish(false)
  }

  input.renderer.on("focus", handleFocus)
  input.renderer.on("blur", handleBlur)

  return () => {
    const off = input.renderer.off ?? input.renderer.removeListener
    if (!off) return
    off.call(input.renderer, "focus", handleFocus)
    off.call(input.renderer, "blur", handleBlur)
  }
}
