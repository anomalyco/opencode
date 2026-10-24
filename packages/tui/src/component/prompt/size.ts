// Rows the prompt adds around its text area: the padding above it, the padding and the
// agent/model row below it, the bottom edge and the status row. The prompt measures its own
// once it is laid out, since the status row can wrap; this is the value until then.
export const CHROME_ROWS = 5

// A prompt size from tui.json: rows or columns, or a percentage from "1%" to "100%" of the space
// the prompt has once every other element has the room it always keeps.
export type Size = number | string

export function resolve(value: Size | undefined, space: number) {
  if (typeof value !== "string") return value
  return Math.max(1, Math.floor((space * Number(value.slice(0, -1))) / 100))
}

// The text area starts `min` rows tall (1 by default) and grows with its text up to `max` (by
// default a third of the terminal, at least 6), then scrolls. `space` is the rows the text area
// has on screen: neither bound exceeds it, so the prompt never grows past the screen, and a
// percentage is of it. It is unknown until the screen around the prompt has been laid out;
// until then a percentage is of the terminal height.
export function rows(input: { min?: Size; max?: Size; terminalHeight: number; space?: number }) {
  const space = input.space === undefined ? undefined : Math.max(1, input.space)
  const fallback = Math.max(6, Math.floor(input.terminalHeight / 3))
  const configured = resolve(input.max, space ?? input.terminalHeight) ?? fallback
  const max = Math.max(1, Math.min(configured, space ?? configured))
  return { min: Math.min(max, Math.max(1, resolve(input.min, space ?? input.terminalHeight) ?? 1)), max }
}

// The home prompt's width: columns, 'auto' to scale with the terminal, or a percentage of the home
// column's width inside its padding (`inner`).
export function homeMaxWidth(configured: Size | "auto" | undefined, terminalWidth: number, inner: number) {
  if (configured === "auto") return Math.max(75, Math.floor(terminalWidth * 0.7))
  return resolve(configured, inner) ?? 75
}
