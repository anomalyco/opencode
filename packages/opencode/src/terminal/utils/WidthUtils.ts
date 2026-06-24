export function getCodePointWidth(cp: number): 0 | 1 | 2 {
  if (cp < 32 || (cp >= 0x7f && cp < 0xa0)) return 0

  if (
    (cp >= 0x1100 && cp <= 0x115F) ||
    (cp >= 0x2E80 && cp <= 0x303F) ||
    (cp >= 0x3040 && cp <= 0x33FF) ||
    (cp >= 0x3400 && cp <= 0x4DBF) ||
    (cp >= 0x4E00 && cp <= 0x9FFF) ||
    (cp >= 0xA000 && cp <= 0xA4CF) ||
    (cp >= 0xAC00 && cp <= 0xD7AF) ||
    (cp >= 0xF900 && cp <= 0xFAFF) ||
    (cp >= 0xFE10 && cp <= 0xFE1F) ||
    (cp >= 0xFE30 && cp <= 0xFE4F) ||
    (cp >= 0xFF00 && cp <= 0xFF60) ||
    (cp >= 0xFFE0 && cp <= 0xFFE6) ||
    (cp >= 0x1F300 && cp <= 0x1F9FF) ||
    (cp >= 0x20000 && cp <= 0x2A6DF)
  ) {
    return 2
  }

  return 1
}

export function stringWidth(str: string): number {
  let width = 0
  for (const ch of str) {
    width += getCodePointWidth(ch.codePointAt(0) ?? 0)
  }
  return width
}
