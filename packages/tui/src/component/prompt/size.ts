// Rows the prompt adds around its text area: the padding above it, the padding and the
// agent/model row below it, the bottom edge and the status row. The prompt measures its own
// once it is laid out, since the status row can wrap; this is the value until then.
export const CHROME_ROWS = 5

// The text area grows with its text up to `configured` rows (by default a third of the
// terminal, at least 6), then scrolls. `space` is the rows the text area has on screen; the
// limit never exceeds it, so the prompt never grows past the screen. It is unknown until the
// screen around the prompt has been laid out.
export function maxRows(input: { configured?: number; terminalHeight: number; space?: number }) {
  const configured = input.configured ?? Math.max(6, Math.floor(input.terminalHeight / 3))
  if (input.space === undefined) return configured
  return Math.max(1, Math.min(configured, input.space))
}
