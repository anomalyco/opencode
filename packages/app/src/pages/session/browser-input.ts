const KEY: Record<string, { text?: string; keyCode: number }> = {
  Enter: { text: "\r", keyCode: 13 },
  Tab: { text: "\t", keyCode: 9 },
  Backspace: { text: "\b", keyCode: 8 },
  Escape: { keyCode: 27 },
  ArrowLeft: { keyCode: 37 },
  ArrowUp: { keyCode: 38 },
  ArrowRight: { keyCode: 39 },
  ArrowDown: { keyCode: 40 },
  Delete: { keyCode: 46 },
  Home: { keyCode: 36 },
  End: { keyCode: 35 },
  PageUp: { keyCode: 33 },
  PageDown: { keyCode: 34 },
}

export const mods = (event: Pick<KeyboardEvent | MouseEvent | WheelEvent, "altKey" | "ctrlKey" | "metaKey" | "shiftKey">) =>
  (event.altKey ? 1 : 0) + (event.ctrlKey ? 2 : 0) + (event.metaKey ? 4 : 0) + (event.shiftKey ? 8 : 0)

export const mouseButton = (button: number) => {
  if (button === 0) return "left"
  if (button === 1) return "middle"
  if (button === 2) return "right"
  return "none"
}

export const keyData = (event: Pick<KeyboardEvent, "altKey" | "code" | "ctrlKey" | "key" | "metaKey" | "shiftKey">, type: "keyDown" | "keyUp") => {
  const info = KEY[event.key]
  const text = type === "keyDown" ? (info?.text ?? (event.key.length === 1 ? event.key : undefined)) : undefined
  const keyCode = info?.keyCode ?? (event.key.length === 1 ? event.key.charCodeAt(0) : 0)
  return {
    key: event.key,
    code: event.code,
    ...(text ? { text } : {}),
    windowsVirtualKeyCode: keyCode,
    modifiers: mods(event),
  }
}

export const pageUrl = (value: string) => {
  const next = value.trim()
  if (!next) return ""
  if (typeof URL !== "undefined" && URL.canParse(next)) return next
  if (next.startsWith("about:")) return next
  const url = `https://${next}`
  if (typeof URL !== "undefined" && URL.canParse(url)) return url
  return next
}

export const mapPoint = (
  node: Pick<HTMLElement, "getBoundingClientRect">,
  width: number,
  height: number,
  x: number,
  y: number,
) => {
  if (width <= 0 || height <= 0) return
  const rect = node.getBoundingClientRect()
  if (!rect.width || !rect.height) return
  return {
    x: Math.max(0, Math.min(width - 1, Math.round((x - rect.left) * (width / rect.width)))),
    y: Math.max(0, Math.min(height - 1, Math.round((y - rect.top) * (height / rect.height)))),
  }
}

export const bytes = (value: string) => {
  const bin = atob(value)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i)
  return out
}
