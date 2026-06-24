import { ScreenBuffer } from "./ScreenBuffer"

export interface ParsedCell {
  x: number
  y: number
  codepoint: number
}

export class OutputParser {
  parse(bytes: Uint8Array, maxWidth: number, maxHeight: number): ParsedCell[] {
    const text = new TextDecoder().decode(bytes)
    const clean = text.replace(/\x1b\[[\d;]*[a-zA-Z]/g, "")
    const result: ParsedCell[] = []
    let x = 0
    let y = 0

    for (const ch of clean) {
      const cp = ch.codePointAt(0)!
      if (cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF)) continue

      if (cp === 0x0A) { y++; x = 0; continue }
      if (cp === 0x0D) { x = 0; continue }
      if (cp === 0x09) { x = (x + 4) & ~3; continue }

      if (x >= maxWidth) { y++; x = 0 }
      if (y >= maxHeight) break

      result.push({ x, y, codepoint: cp })
      x++
    }

    return result
  }

  write(buf: ScreenBuffer, cells: ParsedCell[]): void {
    for (const { x, y, codepoint } of cells)
      buf.setCell(x, y, codepoint, 15, 0, 0)
  }

  parseAndWrite(buf: ScreenBuffer, bytes: Uint8Array): void {
    const cells = this.parse(bytes, buf.width, buf.height)
    this.write(buf, cells)
  }
}

export function parseAI(output: Uint8Array, maxW: number, maxH: number): ParsedCell[] {
  return new OutputParser().parse(output, maxW, maxH)
}
