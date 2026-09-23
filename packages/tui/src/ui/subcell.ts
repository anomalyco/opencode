// Masks use row-major bits in a 2x4 grid. Unicode reuses these older glyphs
// instead of duplicating them in the otherwise mask-ordered octant block.
const OCTANTS = new Map<number, string>([
  [0x00, " "],
  [0x01, "\u{1cea8}"],
  [0x02, "\u{1ceab}"],
  [0x03, "\u{1fb82}"],
  [0x05, "\u2598"],
  [0x0a, "\u259d"],
  [0x0f, "\u2580"],
  [0x14, "\u{1fbe6}"],
  [0x28, "\u{1fbe7}"],
  [0x3f, "\u{1fb85}"],
  [0x40, "\u{1cea3}"],
  [0x50, "\u2596"],
  [0x55, "\u258c"],
  [0x5a, "\u259e"],
  [0x5f, "\u259b"],
  [0x80, "\u{1cea0}"],
  [0xa0, "\u2597"],
  [0xa5, "\u259a"],
  [0xaa, "\u2590"],
  [0xaf, "\u259c"],
  [0xc0, "\u2582"],
  [0xf0, "\u2584"],
  [0xf5, "\u2599"],
  [0xfa, "\u259f"],
  [0xfc, "\u2586"],
  [0xff, "\u2588"],
])

export function octantGlyph(mask: number) {
  return (
    OCTANTS.get(mask) ??
    String.fromCodePoint(0x1cd00 + mask - [...OCTANTS.keys()].filter((value) => value < mask).length)
  )
}
