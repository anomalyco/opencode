import { describe, expect, test } from "bun:test"
import { displayCharAt, displaySlice, mentionTriggerIndex, promptOffsetWidth } from "../../src/prompt/display"
import { thai, thaiGraphemes, thaiOrthography } from "../fixture/thai"

// Width ground truth: Thai spacing characters occupy one terminal cell and
// combining vowels/tone marks occupy zero cells. If Bun.stringWidth ever
// changes this (e.g. an ICU or Unicode data upgrade), Thai cursor math in the
// prompt desyncs, so pin it here.
describe("thai width ground truth", () => {
  test("spacing characters are one cell", () => {
    expect(Bun.stringWidth("ท")).toBe(1)
    expect(Bun.stringWidth("ะ")).toBe(1)
    expect(Bun.stringWidth("ำ")).toBe(1) // SARA AM is spacing, unlike other Thai marks
    expect(Bun.stringWidth(thai.greeting)).toBe(7)
  })

  test("combining vowels and tone marks are zero cells", () => {
    expect(Bun.stringWidth("ี")).toBe(0)
    expect(Bun.stringWidth("ั")).toBe(0)
    expect(Bun.stringWidth("่")).toBe(0)
    expect(Bun.stringWidth("ู")).toBe(0)
    expect(Bun.stringWidth(thai.clusterAbove)).toBe(1)
    expect(Bun.stringWidth(thai.clusterBelow)).toBe(1)
    expect(Bun.stringWidth(thai.thanthakhat)).toBe(1)
    // SARA AM clusters with its base as one grapheme but is a spacing
    // character: it occupies its own terminal cell, so "ทำ" spans two cells.
    expect(Bun.stringWidth(thai.saraAm)).toBe(2)
    expect(Bun.stringWidth(thai.saraAmTone)).toBe(2)
    // Leading vowel and the following consonant each take a cell.
    expect(Bun.stringWidth(thai.leadingVowel)).toBe(2)
  })
})

describe("thai grapheme segmentation", () => {
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" })
  const clusters = (value: string) => [...segmenter.segment(value)].map((part) => part.segment)

  test("round-trips every corpus sample", () => {
    for (const sample of Object.values(thai)) {
      expect(clusters(sample).join("")).toBe(sample)
    }
  })

  test("clusters combining marks with their base consonant", () => {
    expect(clusters(thai.clusterAbove)).toEqual(["ที่"])
    expect(clusters(thai.clusterBelow)).toEqual(["ผู้"])
    expect(clusters(thai.doubleStack)).toEqual(["ปี่"])
    expect(clusters(thai.saraAm)).toEqual(["ทำ"])
    expect(clusters(thai.saraAmTone)).toEqual(["น้ำ"])
    expect(clusters(thai.leadingVowel)).toEqual(["เ", "ก"])
    expect(clusters(thai.thanthakhat)).toEqual(["ก์"])
    expect(clusters(thai.greeting)).toEqual(["ส", "วั", "ส", "ดี", "ค", "รั", "บ"])
  })

  test("ICU segments Thai into dictionary words", () => {
    // Thai has no inter-word spaces. ICU's dictionary segmentation is the
    // building block for word-aware wrapping (see the render suite); pin that
    // the runtime actually ships the Thai dictionary.
    const words = new Intl.Segmenter("th", { granularity: "word" })
    expect([...words.segment(thai.noSpaces)].map((part) => part.segment)).toEqual([
      "ภาษา",
      "ไทย",
      "ไม่มี",
      "ช่อง",
      "ว่าง",
      "ระหว่าง",
      "คำ",
    ])
  })
})

// The prompt display helpers must treat a whole Thai cluster as one position.
// A cursor that lands between "ท" and "ี่" corrupts rendering, backspace, and
// mention offsets.
describe("thai prompt display offsets", () => {
  test("promptOffsetWidth counts clusters, not code points", () => {
    expect(promptOffsetWidth(thai.clusterAbove)).toBe(1)
    expect(promptOffsetWidth(thai.clusterBelow)).toBe(1)
    expect(promptOffsetWidth(thai.thanthakhat)).toBe(1)
    // One grapheme, two cells: the SARA AM spacing character takes a cell.
    expect(promptOffsetWidth(thai.saraAm)).toBe(2)
    expect(promptOffsetWidth(thai.saraAmTone)).toBe(2)
    expect(promptOffsetWidth(thai.leadingVowel)).toBe(2)
    expect(promptOffsetWidth(thai.greeting)).toBe(7)
    expect(promptOffsetWidth(thai.mixed)).toBe(Bun.stringWidth(thai.mixed))
    expect(promptOffsetWidth("สวัสดี\nทดสอบ")).toBe(10) // newline counts as one position
  })

  test("displayCharAt returns whole clusters", () => {
    expect(displayCharAt(thai.twoClusters, 0)).toBe(thai.clusterAbove)
    expect(displayCharAt(thai.twoClusters, 1)).toBe("ดี")
    expect(displayCharAt(thai.saraAmWord, 0)).toBe("กำ")
    for (const sample of thaiOrthography) {
      let width = 0
      for (const cluster of thaiGraphemes(sample)) {
        const next = width + promptOffsetWidth(cluster)
        for (let offset = width; offset < next; offset++) {
          expect(displayCharAt(sample, offset)).toBe(cluster)
        }
        expect(displaySlice(sample, width, next)).toBe(cluster)
        width = next
      }
    }
  })

  test("displaySlice never splits a cluster", () => {
    expect(displaySlice(thai.twoClusters, 0, 1)).toBe(thai.clusterAbove)
    expect(displaySlice(thai.twoClusters, 1, 2)).toBe("ดี")
    expect(displaySlice(thai.greeting, 4, 7)).toBe("ครับ")
    expect(displaySlice(thai.mixed, 0, promptOffsetWidth(thai.mixed))).toBe(thai.mixed)
    // Slicing at a cluster boundary must be lossless for every corpus sample.
    for (const sample of Object.values(thai)) {
      expect(displaySlice(sample, 0, promptOffsetWidth(sample))).toBe(sample)
    }
  })

  test("a slice ending inside sara am does not drop the mark off its base", () => {
    const sliced = displaySlice(thai.saraAmTone, 0, 1)
    const baseKeptWithoutSaraAm = sliced.includes("น") && !sliced.includes("ำ")
    expect(baseKeptWithoutSaraAm).toBe(false)
    console.log(`thai-slice-inside ${JSON.stringify(thai.saraAmTone)} -> ${JSON.stringify(sliced)}`)
  })

  test("per-column read of a dangling mark keeps the other characters", () => {
    const columns = promptOffsetWidth(thai.danglingMark)
    const reads = Array.from({ length: columns }, (_, offset) => displayCharAt(thai.danglingMark, offset) ?? "")
    console.log(`thai-dangling-columns ${JSON.stringify(reads)}`)
    const joined = reads.join("")
    for (const char of "ทดสอบ") {
      expect(joined.includes(char)).toBe(true)
    }
  })

  test("mentions resolve offsets in thai text like CJK text", () => {
    expect(mentionTriggerIndex("สวัสดี @")).toBe(5)
    expect(mentionTriggerIndex("ทดสอบ @src file", Bun.stringWidth("ทดสอบ @src"))).toBe(6)
    expect(displayCharAt("สวัสดี @src", Bun.stringWidth("สวัสดี @"))).toBe("s")
    expect(displaySlice("สวัสดี @src", 5, Bun.stringWidth("สวัสดี @src"))).toBe("@src")
    // No word boundary before the @, so no trigger.
    expect(mentionTriggerIndex("ที่@")).toBeUndefined()
    expect(mentionTriggerIndex("สวัสดี @src file")).toBeUndefined()
  })
})
