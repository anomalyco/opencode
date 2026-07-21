const prefixes: Record<number, string> = {
  0x2192: "->",
  0x2190: "<-",
  0x2731: "*",
  0x2699: "*",
  0x2716: "!",
  0x2717: "!",
  0x25c8: "*",
  0x25c9: "*",
  0x27f3: "*",
}

export function monoPrefix(value: string, mono: boolean): string {
  if (!mono) return value
  const point = value.codePointAt(0)
  if (point === undefined) return value
  const prefix = prefixes[point]
  if (!prefix) return value
  return prefix + value.slice(point > 0xffff ? 2 : 1)
}

export function monoToolText(value: string, mono: boolean): string {
  const result = monoPrefix(value, mono)
  if (!mono) return result
  const separator = ` ${String.fromCodePoint(0xb7)} `
  const index = result.lastIndexOf(separator)
  if (index === -1) return result
  const head = result.slice(0, index)
  if (!head.includes(" completed") && head !== "patch" && !/^\d+ questions$/.test(head)) return result
  return result.slice(0, index) + " - " + result.slice(index + separator.length)
}

export function monoShortcut(value: string, mono: boolean): string {
  if (!mono) return value
  return value
    .replaceAll(String.fromCodePoint(0x2192), "right")
    .replaceAll(String.fromCodePoint(0x2190), "left")
    .replaceAll(String.fromCodePoint(0x2191), "up")
    .replaceAll(String.fromCodePoint(0x2193), "down")
}

export function monoTruncate(value: string, width: number, mono: boolean): string {
  if (!mono || value.length <= width) return value
  if (width <= 3) return ".".repeat(Math.max(0, width))
  return value.slice(0, width - 3) + "..."
}

export function monoTruncateMiddle(value: string, width: number, mono: boolean): string {
  if (!mono || value.length <= width) return value
  if (width <= 3) return ".".repeat(Math.max(0, width))
  const available = width - 3
  const left = Math.ceil(available / 2)
  return value.slice(0, left) + "..." + value.slice(value.length - (available - left))
}
