import { AttrMask } from "./Cell"

const SGR_RE = /\x1b\[([\d;]*)m/g

const FLYW_ENTRIES = 256 * 256 * 64 // fg × bg × attr (6 bits mask)

export class SgrFlyweight {
  // Initially empty; populated lazily on first encode miss.
  // Slot value = strings.length + 1  (0 means not-yet-stored)
  private idx = new Uint32Array(FLYW_ENTRIES)
  private strings: string[] = []

  encode(fg: number, bg: number, attr: number): string {
    const slot = ((fg << 8) | bg) << 6 | attr
    const raw = this.idx[slot]
    if (raw !== 0) return this.strings[raw - 1]

    const sgr = this.build(fg, bg, attr)
    this.idx[slot] = this.strings.length + 1
    this.strings.push(sgr)
    return sgr
  }

  get size(): number {
    return this.strings.length
  }

  private build(fg: number, bg: number, attr: number): string {
    const fgCode = fg === 0 ? "39" : `38;5;${fg}`
    const bgCode = bg === 0 ? "49" : `48;5;${bg}`
    const codes: string[] = ["0", fgCode, bgCode]
    if (attr & AttrMask.BOLD)     codes.push("1")
    if (attr & AttrMask.ITALIC)   codes.push("3")
    if (attr & AttrMask.UNDERLINE) codes.push("4")
    if (attr & AttrMask.STRIKE)   codes.push("9")
    if (attr & AttrMask.INVERSE)  codes.push("7")
    return `\x1b[${codes.join(";")}m`
  }
}

export const globalFlyweight = new SgrFlyweight()

export class SgrDelta {
  private fg = 0
  private bg = 0
  private bold = false
  private italic = false
  private underline = false
  private strike = false
  private inverse = false

  resetState(): void {
    this.fg = 0
    this.bg = 0
    this.bold = false
    this.italic = false
    this.underline = false
    this.strike = false
    this.inverse = false
  }

  optimize(ansi: string): string {
    let lastIndex = 0
    const parts: string[] = []

    SGR_RE.lastIndex = 0

    for (;;) {
      const match = SGR_RE.exec(ansi)
      if (!match) break

      const before = ansi.slice(lastIndex, match.index)
      if (before) parts.push(before)

      const raw = match[0]
      const params = match[1] ? match[1].split(";").map(Number) : [0]
      const replacement = this.processSGR(raw, params)

      if (replacement) parts.push(replacement)
      lastIndex = match.index + raw.length
    }

    const remaining = ansi.slice(lastIndex)
    if (remaining) parts.push(remaining)

    return parts.join("")
  }

  private processSGR(raw: string, params: number[]): string | null {
    if (params.length === 0 || params[0] === 0) {
      const partial = params.slice(1)
      if (partial.length > 0) {
        return this.processPartialSGR(raw, partial)
      }
      return this.emitReset()
    }

    if (params[0] === 1) { this.bold = true; return this.maybeEmit("1") }
    if (params[0] === 3) { this.italic = true; return this.maybeEmit("3") }
    if (params[0] === 4) { this.underline = true; return this.maybeEmit("4") }
    if (params[0] === 7) { this.inverse = true; return this.maybeEmit("7") }
    if (params[0] === 9) { this.strike = true; return this.maybeEmit("9") }

    if (params[0] === 22) { this.bold = false; return this.maybeEmit("22") }
    if (params[0] === 23) { this.italic = false; return this.maybeEmit("23") }
    if (params[0] === 24) { this.underline = false; return this.maybeEmit("24") }
    if (params[0] === 27) { this.inverse = false; return this.maybeEmit("27") }
    if (params[0] === 29) { this.strike = false; return this.maybeEmit("29") }

    if (params[0] === 38 && params[1] === 5 && params[2] !== undefined) {
      const v = params[2]; if (v === this.fg) return null; this.fg = v; return `\x1b[38;5;${v}m`
    }

    if (params[0] === 48 && params[1] === 5 && params[2] !== undefined) {
      const v = params[2]; if (v === this.bg) return null; this.bg = v; return `\x1b[48;5;${v}m`
    }

    if (params[0] === 39) { if (this.fg === 0) return null; this.fg = 0; return "\x1b[39m" }
    if (params[0] === 49) { if (this.bg === 0) return null; this.bg = 0; return "\x1b[49m" }

    if (params[0] === 38 && params[2] === 2 && params[3] !== undefined) {
      const r = params[3]; const g = params[4]; const b = params[5]
      return `\x1b[38;2;${r};${g};${b}m`
    }

    if (params[0] === 48 && params[2] === 2 && params[3] !== undefined) {
      const r = params[3]; const g = params[4]; const b = params[5]
      return `\x1b[48;2;${r};${g};${b}m`
    }

    return raw
  }

  private processPartialSGR(raw: string, params: number[]): string | null {
    let changed = false
    let i = 0
    const codes: number[] = []

    while (i < params.length) {
      const code = params[i]
      if (code === 38 && params[i + 1] === 5) {
        const v = params[i + 2]; if (v !== this.fg) { this.fg = v; codes.push(38, 5, v); changed = true }
        i += 3; continue
      }
      if (code === 48 && params[i + 1] === 5) {
        const v = params[i + 2]; if (v !== this.bg) { this.bg = v; codes.push(48, 5, v); changed = true }
        i += 3; continue
      }
      if (code === 38 && params[i + 1] === 2) {
        codes.push(38, 2, params[i + 2], params[i + 3], params[i + 4]); changed = true
        i += 5; continue
      }
      if (code === 48 && params[i + 1] === 2) {
        codes.push(48, 2, params[i + 2], params[i + 3], params[i + 4]); changed = true
        i += 5; continue
      }
      if (code === 1) { if (!this.bold) { this.bold = true; codes.push(1); changed = true } i++; continue }
      if (code === 3) { if (!this.italic) { this.italic = true; codes.push(3); changed = true } i++; continue }
      if (code === 4) { if (!this.underline) { this.underline = true; codes.push(4); changed = true } i++; continue }
      if (code === 7) { if (!this.inverse) { this.inverse = true; codes.push(7); changed = true } i++; continue }
      if (code === 9) { if (!this.strike) { this.strike = true; codes.push(9); changed = true } i++; continue }
      if (code === 22) { if (this.bold) { this.bold = false; codes.push(22); changed = true } i++; continue }
      if (code === 23) { if (this.italic) { this.italic = false; codes.push(23); changed = true } i++; continue }
      if (code === 24) { if (this.underline) { this.underline = false; codes.push(24); changed = true } i++; continue }
      if (code === 27) { if (this.inverse) { this.inverse = false; codes.push(27); changed = true } i++; continue }
      if (code === 29) { if (this.strike) { this.strike = false; codes.push(29); changed = true } i++; continue }
      if (code === 39) { if (this.fg !== 0) { this.fg = 0; codes.push(39); changed = true } i++; continue }
      if (code === 49) { if (this.bg !== 0) { this.bg = 0; codes.push(49); changed = true } i++; continue }
      i++
    }

    if (!changed) return null
    return `\x1b[${codes.join(";")}m`
  }

  private emitReset(): string | null {
    if (this.fg === 0 && this.bg === 0 && !this.bold && !this.italic && !this.underline && !this.strike && !this.inverse) return null
    this.resetState()
    return "\x1b[0m"
  }

  private maybeEmit(code: string): string | null {
    return `\x1b[${code}m`
  }
}
