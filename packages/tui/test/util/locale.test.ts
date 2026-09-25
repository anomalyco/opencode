import { describe, expect, test } from "bun:test"
import { Locale } from "../../src/util/locale"
import { startsWithThaiMark, thai, thaiGraphemes, thaiOrthography } from "../fixture/thai"

const samples = [...thaiOrthography, thai.saraAmWord, thai.greeting, thai.twoClusters, thai.wrapSample, thai.mixed]

describe("locale truncation", () => {
  test("keeps the ASCII length unit", () => {
    const text = "abcdefghijklmnopqrstuvwxyz"
    for (let len = 0; len <= text.length + 1; len++) {
      expect(Locale.truncate(text, len)).toBe(asciiTruncate(text, len))
      expect(Locale.truncateLeft(text, len)).toBe(asciiTruncateLeft(text, len))
      expect(Locale.truncateMiddle(text, len)).toBe(asciiTruncateMiddle(text, len))
    }
    expect(Locale.truncateMiddle("hello")).toBe("hello")
  })

  test("does not split Thai clusters when the string does not fit", () => {
    for (const sample of samples) {
      for (let len = 1; len <= sample.length + 1; len++) {
        assertThaiSafe(sample, len, Locale.truncate(sample, len), "prefix")
        assertThaiSafe(sample, len, Locale.truncateLeft(sample, len), "suffix")
        assertThaiSafe(sample, len, Locale.truncateMiddle(sample, len), "middle")
      }
    }

    const above = Locale.truncate(thai.clusterAbove, 2)
    const aboveLeft = Locale.truncateLeft(thai.clusterAbove, 2)
    const aboveMiddle = Locale.truncateMiddle(thai.clusterAbove, 2)
    const tone = Locale.truncate(thai.saraAmTone, 2)
    const toneLeft = Locale.truncateLeft(thai.saraAmTone, 2)
    const toneMiddle = Locale.truncateMiddle(thai.saraAmTone, 2)
    const phrase = Locale.truncate(thai.noSpaces, 8)
    const phraseLeft = Locale.truncateLeft(thai.noSpaces, 4)
    const phraseMiddle = Locale.truncateMiddle(thai.noSpaces, 11)
    expect(above.includes("ท")).toBe(false)
    expect(startsWithThaiMark(aboveLeft.replace(/^…/, ""))).toBe(false)
    expect(tone.includes("น") && !tone.includes("ำ")).toBe(false)
    expect(startsWithThaiMark(toneLeft.replace(/^…/, ""))).toBe(false)
    console.log(
      [
        `thai-truncate ที่ end ${JSON.stringify(above)} left ${JSON.stringify(aboveLeft)} middle ${JSON.stringify(aboveMiddle)}`,
        `thai-truncate น้ำ end ${JSON.stringify(tone)} left ${JSON.stringify(toneLeft)} middle ${JSON.stringify(toneMiddle)}`,
        `thai-truncate no-space end ${JSON.stringify(phrase)} left ${JSON.stringify(phraseLeft)} middle ${JSON.stringify(phraseMiddle)}`,
      ].join("\n"),
    )
  })
})

function assertThaiSafe(original: string, len: number, result: string, side: "prefix" | "suffix" | "middle") {
  if (original.length <= len) {
    expect(result).toBe(original)
    return
  }

  expect(result.includes("…")).toBe(true)
  for (const piece of result.split("…")) {
    expect([original, result, piece, startsWithThaiMark(piece)]).toEqual([original, result, piece, false])
    expect(isWholeClusterSlice(original, piece)).toBe(true)
  }

  if (side === "prefix") {
    expect(result.endsWith("…")).toBe(true)
    expect(original.startsWith(result.slice(0, -1))).toBe(true)
    expect(result.length).toBeLessThanOrEqual(len)
    return
  }
  if (side === "suffix") {
    expect(result.startsWith("…")).toBe(true)
    expect(original.endsWith(result.slice(1))).toBe(true)
    if (len >= 2) expect(result.length).toBeLessThanOrEqual(len)
    return
  }

  const mark = result.indexOf("…")
  const start = result.slice(0, mark)
  const end = result.slice(mark + 1)
  expect(original.startsWith(start)).toBe(true)
  expect(original.endsWith(end)).toBe(true)
  if (len >= 3) expect(result.length).toBeLessThanOrEqual(len)
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

function asciiTruncate(str: string, len: number) {
  if (str.length <= len) return str
  return str.slice(0, len - 1) + "…"
}

function asciiTruncateLeft(str: string, len: number) {
  if (str.length <= len) return str
  return "…" + str.slice(-(len - 1))
}

function asciiTruncateMiddle(str: string, len: number) {
  if (str.length <= len) return str
  const ellipsis = "…"
  const keepStart = Math.ceil((len - ellipsis.length) / 2)
  const keepEnd = Math.floor((len - ellipsis.length) / 2)
  return str.slice(0, keepStart) + ellipsis + str.slice(-keepEnd)
}
