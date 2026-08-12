import { expect, test } from "bun:test"
import mathUnicode from "@fontsource/noto-sans-math/unicode.json"
import symbolsUnicode from "@fontsource/noto-sans-symbols/unicode.json"
import symbols2Unicode from "@fontsource/noto-sans-symbols-2/unicode.json"

const OpenCodeSymbols = [..."△⇆⊙⚙✱↳◌◈⟳▸▾■⬝⬥⬩⬪"]

test("the bundled fallback font declares coverage for OpenCode symbols", () => {
  const ranges = [symbolsUnicode.symbols, symbols2Unicode.symbols, mathUnicode.math]
    .flatMap((value) => value.split(","))
    .map((range) => {
    const [start, end = start] = range.slice(2).split("-")
    return [Number.parseInt(start!, 16), Number.parseInt(end!, 16)] as const
    })

  expect(OpenCodeSymbols.filter((symbol) => {
    const codePoint = symbol.codePointAt(0)!
    return !ranges.some(([start, end]) => codePoint >= start && codePoint <= end)
  })).toEqual([])
})
