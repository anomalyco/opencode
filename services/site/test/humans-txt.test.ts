import { describe, expect, test } from "bun:test"

// Served at /humans.txt by src/middleware.ts, as text/plain; charset=utf-8.
const text = await Bun.file(new URL("../src/lib/humans.txt", import.meta.url)).text()
const lines = text.split("\n")

describe("humans.txt", () => {
  test("fits in 80 columns with no tabs or trailing spaces", () => {
    expect(lines.filter((line) => [...line].length > 80)).toEqual([])
    expect(lines.filter((line) => /\t|\s$/.test(line))).toEqual([])
    expect(text.endsWith("\n")).toBe(true)
  })

  // Box drawing, blocks and the middle dot render in every common monospace font.
  test("uses only ASCII, block elements, box drawing and the middle dot", () => {
    expect([...text].filter((char) => !/[\n -~\u2500-\u259f·]/.test(char))).toEqual([])
  })
})
