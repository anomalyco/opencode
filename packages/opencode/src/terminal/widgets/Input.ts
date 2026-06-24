import { ScreenBuffer } from "../core/ScreenBuffer"
import { getCodePointWidth, stringWidth } from "../utils/WidthUtils"
import { wordWrap } from "./Text"
import type { Widget } from "./Widget"
import type { InputEvent } from "../input/InputHandler"

export class Input implements Widget {
  dirty = true
  x = 0; y = 0; w = 0; h = 0
  private _value = ""
  cursorPos = 0
  cursorVisible = false
  onConfirm?: (value: string) => void

  get value(): string { return this._value }

  set value(val: string) {
    if (val === this._value) return
    this._value = val
    if (this.cursorPos > val.length) this.cursorPos = val.length
    this.dirty = true
  }

  setBounds(x: number, y: number, w: number, h: number): void {
    if (x === this.x && y === this.y && w === this.w && h === this.h) return
    this.x = x; this.y = y; this.w = w; this.h = h
    this.dirty = true
  }

  invalidate(): void { this.dirty = true }

  onFocus(): void {
    this.cursorVisible = true
    this.dirty = true
  }

  onBlur(): void {
    this.cursorVisible = false
    this.dirty = true
  }

  onKey(event: InputEvent): boolean {
    if (event.type === "CHAR") {
      const ch = event.char
      const cw = stringWidth(ch)
      const curLine = this.lineAndCol()
      const lineW = stringWidth(this._value.split("\n")[curLine.line] ?? "")
      if (lineW + cw > this.w) return true
      const before = this._value.slice(0, this.cursorPos)
      const after = this._value.slice(this.cursorPos)
      this._value = before + ch + after
      this.cursorPos += ch.length
      this.dirty = true
      return true
    }

    if (event.type !== "KEY") return false

    switch (event.key) {
      case "Backspace":
        if (this.cursorPos > 0) {
          const before = this._value.slice(0, this.cursorPos - 1)
          const after = this._value.slice(this.cursorPos)
          this._value = before + after
          this.cursorPos--
          this.dirty = true
        }
        return true

      case "Delete":
        if (this.cursorPos < this._value.length) {
          this._value = this._value.slice(0, this.cursorPos) + this._value.slice(this.cursorPos + 1)
          this.dirty = true
        }
        return true

      case "ArrowLeft":
        if (this.cursorPos > 0) {
          const prev = this._value.codePointAt(this.cursorPos - 1) ?? 0
          const w = getCodePointWidth(prev)
          this.cursorPos -= w === 2 ? 2 : 1
          this.cursorPos = Math.max(0, this.cursorPos)
          this.dirty = true
        }
        return true

      case "ArrowRight":
        if (this.cursorPos < this._value.length) {
          const cur = this._value.codePointAt(this.cursorPos) ?? 0
          const w = getCodePointWidth(cur)
          this.cursorPos += w === 2 ? 2 : 1
          this.cursorPos = Math.min(this._value.length, this.cursorPos)
          this.dirty = true
        }
        return true

      case "Home":
        this.cursorPos = 0
        this.dirty = true
        return true

      case "End":
        this.cursorPos = this._value.length
        this.dirty = true
        return true

      case "Enter":
        this.onConfirm?.(this._value)
        return true
    }

    return false
  }

  render(buffer: ScreenBuffer): void {
    this.dirty = false
    const lines = wordWrap(this._value, this.w)

    for (let i = 0; i < this.h && i < lines.length; i++) {
      const line = lines[i] ?? ""
      let col = 0
      for (const ch of line) {
        if (col >= this.w) break
        const cp = ch.codePointAt(0) ?? 32
        const cw = getCodePointWidth(cp)
        if (col + cw > this.w) break
        buffer.setCell(this.x + col, this.y + i, cp, 15, 0, 0)
        col += cw
      }
      for (let c = col; c < this.w; c++) {
        buffer.setCell(this.x + c, this.y + i, 32, 15, 0, 0)
      }
    }

    for (let i = lines.length; i < this.h; i++) {
      for (let c = 0; c < this.w; c++) {
        buffer.setCell(this.x + c, this.y + i, 32, 15, 0, 0)
      }
    }

    if (this.cursorVisible) {
      const { line, col } = this.lineAndCol()
      if (line >= 0 && line < this.h && col >= 0 && col < this.w) {
        const cp = this._value.codePointAt(this.cursorPos) ?? 32
        const cw = getCodePointWidth(cp)
        buffer.setCell(this.x + col, this.y + line, cp, 0, 15, 0)
        if (cw === 2 && this.x + col + 1 < buffer.width) {
          buffer.setCell(this.x + col + 1, this.y + line, 32, 0, 15, 0)
        }
      }
    }
  }

  private lineAndCol(): { line: number; col: number } {
    const before = this._value.slice(0, this.cursorPos)
    const lines = wordWrap(this._value, this.w)
    const beforeLines = wordWrap(before, this.w)
    const line = Math.min(beforeLines.length - 1, lines.length - 1)
    if (line < 0) return { line: 0, col: 0 }
    const col = stringWidth(beforeLines[line] ?? "")
    return { line, col }
  }
}
