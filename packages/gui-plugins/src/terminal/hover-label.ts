import type { Terminal } from "ghostty-web"
import { Option, Schema } from "effect"

const cell = Schema.Struct({ x: Schema.Int, y: Schema.Int })

const hovered = Schema.decodeUnknownOption(
  Schema.Struct({ currentHoveredLink: Schema.Struct({ range: Schema.Struct({ start: cell, end: cell }) }) }),
)

/** Ghostty's OSC 8 `text` is the URI. Read the visible glyphs at its inclusive range, otherwise require confirmation. */
export function terminalLinkLabel(terminal: Terminal) {
  const value = hovered(terminal)

  if (Option.isNone(value)) return
  const range = value.value.currentHoveredLink.range

  if (range.start.y !== range.end.y) return

  return terminal.buffer.active.getLine(range.start.y)?.translateToString(false, range.start.x, range.end.x + 1)
}
