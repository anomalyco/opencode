/** @jsxImportSource @opentui/solid */
import { testRender, type JSX } from "@opentui/solid"
import { describe, expect, test } from "bun:test"
import { isThaiCombining, startsWithThaiMark, thai, thaiGraphemes, thaiOrthography } from "../../fixture/thai"

// Rendering-level Thai tests. These assert invariants instead of exact frame
// snapshots so they survive theme/layout churn, but they fail on the two real
// failure modes for Thai in a cell grid:
//   1. a wrap boundary splitting a grapheme cluster, stranding a combining
//      vowel/tone mark at the start of the next visual line
//   2. width miscounting (combining marks counted as one cell), which pushes
//      content past the box width

async function renderFrame(component: () => JSX.Element, options: { width: number; height: number }) {
  const setup = await testRender(component, options)
  try {
    await setup.renderOnce()
    await setup.renderOnce()
    return setup
      .captureCharFrame()
      .split("\n")
      .map((line) => line.trimEnd())
  } finally {
    setup.renderer.destroy()
  }
}

function firstNonSpace(line: string) {
  return line.trimStart()[0] ?? ""
}

function contentLines(frame: string[]) {
  return frame.map((line) => line.trim()).filter((line) => line.length > 0)
}

function isWholeClusterSlice(original: string, piece: string) {
  if (piece === "") return true
  const parts = thaiGraphemes(original)
  for (let start = 0; start < parts.length; start++) {
    let acc = ""
    for (let index = start; index < parts.length; index++) {
      acc += parts[index]
      if (acc === piece) return true
      if (acc.length > piece.length) break
    }
  }
  return false
}

function wrapsOnWords(lines: string[], words: string[]) {
  let rest = words.join("")
  for (const line of lines) {
    if (!rest.startsWith(line)) return false
    const eaten = line.length
    let covered = 0
    while (words.length > 0 && covered < eaten) {
      const word = words[0]
      if (!word || covered + word.length > eaten) return false
      covered += word.length
      words.shift()
    }
    if (covered !== eaten) return false
    rest = rest.slice(eaten)
  }
  return rest === "" && words.length === 0
}

describe("thai rendering", () => {
  test("renders thai text into the frame", async () => {
    const frame = await renderFrame(() => <text>{thai.greeting}</text>, { width: 40, height: 3 })
    const lines = contentLines(frame)
    expect(frame.join("\n")).toContain(thai.greeting)
    expect(lines).toHaveLength(1)
    console.log(`thai-greeting-line ${JSON.stringify(lines[0] ?? "")}`)
  })

  test("renders every orthographic sample intact", async () => {
    for (const sample of thaiOrthography) {
      const frame = await renderFrame(() => <text>{sample}</text>, { width: 40, height: 6 })
      expect(contentLines(frame).join("")).toBe(sample)
    }
  })

  test("wraps a no-space paragraph without stranding a mark", async () => {
    const width = 8
    const frame = await renderFrame(() => <text>{thai.noSpaces}</text>, { width, height: 8 })
    const lines = contentLines(frame)
    const words = [...new Intl.Segmenter("th", { granularity: "word" }).segment(thai.noSpaces)].map(
      (part) => part.segment,
    )
    console.log(`thai-wrap-width ${width}`)
    for (const line of lines) console.log(`thai-wrap-line ${JSON.stringify(line)}`)
    console.log(`thai-word-oracle ${words.map((word) => JSON.stringify(word)).join(" ")}`)
    console.log(`thai-word-boundary ${wrapsOnWords(lines, words)}`)

    expect(lines.join("")).toBe(thai.noSpaces)
    for (const line of lines) {
      expect(Bun.stringWidth(line)).toBeLessThanOrEqual(width)
      expect(startsWithThaiMark(line)).toBe(false)
      expect(isWholeClusterSlice(thai.noSpaces, line)).toBe(true)
    }
  })

  test("mixed thai, latin and CJK render on one line without clipping", async () => {
    const frame = await renderFrame(() => <text>{thai.mixed}</text>, { width: 60, height: 3 })
    const text = frame.join("\n")
    expect(text).toContain("ทดสอบ")
    expect(text).toContain("opencode")
    expect(text).toContain("中文")
  })

  test("wrapping never strands a combining mark at a line start", async () => {
    // thai.wrapSample has no spaces at all, so the wrapper has no word
    // boundary to lean on - it must still break only between clusters.
    const width = 10
    const frame = await renderFrame(() => <text>{thai.wrapSample}</text>, { width, height: 12 })

    for (const line of frame) {
      const head = firstNonSpace(line)
      if (!head) continue
      expect(isThaiCombining(head)).toBe(false)
    }
  })

  test("wrapped thai lines never exceed the terminal width", async () => {
    const width = 10
    const frame = await renderFrame(() => <text>{thai.wrapSample}</text>, { width, height: 12 })

    for (const line of frame) {
      expect(Bun.stringWidth(line)).toBeLessThanOrEqual(width)
    }
  })

  test("dangling combining mark does not corrupt the row", async () => {
    const frame = await renderFrame(() => <text>{thai.danglingMark}</text>, { width: 20, height: 3 })
    // A zero-width mark with no base has no cell to draw over, so the grid
    // omits it. The row must render cleanly without shifting or garbling
    // the visible text.
    expect(frame.join("\n").trimEnd()).toBe("ทดสอบ")
  })
})
