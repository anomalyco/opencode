import type { TerminalCore } from "@wterm/core"
import { GhosttyCore } from "@wterm/ghostty"
import type { CapturedFrame, CapturedSpan } from "./types.js"

const DefaultForeground = 0xd8d8d8
const DefaultBackground = 0x080808
const SyncStart = Buffer.from("\x1b[?2026h")
const SyncEnd = Buffer.from("\x1b[?2026l")

export interface TerminalParser {
  write(data: Uint8Array): void
  finish(): boolean
  resize(cols: number, rows: number): void
  snapshot(): CapturedFrame
}

export type TerminalParserFactory = (cols: number, rows: number) => Promise<TerminalParser>

function characterWidth(char: string) {
  return Math.max(1, Bun.stringWidth(char))
}

function capture(core: TerminalCore): CapturedFrame {
  const cols = core.getCols()
  const rows = core.getRows()
  const lines = Array.from({ length: rows }, (_, row) => {
    const spans: CapturedSpan[] = []
    for (let col = 0; col < cols; ) {
      const cell = core.getCell(row, col)
      const text = String.fromCodePoint(cell.char || 32)
      const width = Math.min(characterWidth(text), cols - col)
      const next = {
        text,
        width,
        fg: cell.fgRgb ?? DefaultForeground,
        bg: cell.bgRgb ?? DefaultBackground,
        attributes: cell.flags,
      }
      const previous = spans.at(-1)
      if (
        previous &&
        previous.fg === next.fg &&
        previous.bg === next.bg &&
        previous.attributes === next.attributes
      ) {
        previous.text += next.text
        previous.width += width
      } else {
        spans.push(next)
      }
      col += width
    }
    return { spans }
  })
  return { cols, rows, cursor: core.getCursor(), lines }
}

class GhosttyTerminal implements TerminalParser {
  private synchronized = false
  private stable?: CapturedFrame
  private pending = Buffer.alloc(0)

  constructor(private readonly core: TerminalCore) {}

  write(data: Uint8Array) {
    const input = this.pending.length ? Buffer.concat([this.pending, data]) : Buffer.from(data)
    this.pending = Buffer.alloc(0)
    let offset = 0
    while (offset < input.length) {
      const start = input.indexOf(SyncStart, offset)
      const end = input.indexOf(SyncEnd, offset)
      const marker = start === -1 ? end : end === -1 ? start : Math.min(start, end)
      if (marker === -1) {
        const keep = partialMarkerLength(input.subarray(offset))
        const boundary = input.length - keep
        if (boundary > offset) this.core.writeRaw(input.subarray(offset, boundary))
        if (keep) this.pending = input.subarray(boundary)
        return
      }
      if (marker > offset) this.core.writeRaw(input.subarray(offset, marker))
      if (marker === start) {
        if (!this.synchronized) this.stable = capture(this.core)
        this.synchronized = true
        this.core.writeRaw(SyncStart)
        offset = marker + SyncStart.length
      } else {
        this.core.writeRaw(SyncEnd)
        this.synchronized = false
        this.stable = undefined
        offset = marker + SyncEnd.length
      }
    }
  }

  finish() {
    if (!this.pending.length) return false
    this.core.writeRaw(this.pending)
    this.pending = Buffer.alloc(0)
    return true
  }

  resize(cols: number, rows: number) {
    this.core.resize(cols, rows)
    if (this.synchronized) this.stable = capture(this.core)
  }

  snapshot() {
    return this.synchronized && this.stable ? structuredClone(this.stable) : capture(this.core)
  }
}

function partialMarkerLength(input: Uint8Array) {
  const limit = Math.min(input.length, Math.max(SyncStart.length, SyncEnd.length) - 1)
  for (let length = limit; length > 0; length--) {
    const suffix = input.subarray(input.length - length)
    if (SyncStart.subarray(0, length).equals(suffix) || SyncEnd.subarray(0, length).equals(suffix)) return length
  }
  return 0
}

export const createTerminalParser: TerminalParserFactory = async (cols, rows) => {
  const core: TerminalCore = await GhosttyCore.load()
  core.init(cols, rows)
  return new GhosttyTerminal(core)
}
