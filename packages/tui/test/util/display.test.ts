import { describe, expect, test } from "bun:test"
import { mentionTriggerIndex, promptOffsetWidth } from "../../src/prompt/display"

function referenceMentionTriggerIndex(value: string, offset = promptOffsetWidth(value)) {
  const text = displaySliceReference(value, 0, offset)
  const index = text.lastIndexOf("@")
  if (index === -1) return

  const before = index === 0 ? undefined : text[index - 1]
  const query = text.slice(index)
  if ((before === undefined || /\s/.test(before)) && !/\s/.test(query)) {
    return promptOffsetWidth(text.slice(0, index))
  }
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" })

function displayOffsetIndexReference(value: string, offset: number) {
  if (offset <= 0) return 0

  let width = 0
  for (const part of graphemes.segment(value)) {
    const next = width + promptOffsetWidth(part.segment)
    if (next > offset) return part.index
    width = next
  }

  return value.length
}

function displaySliceReference(value: string, start = 0, end = promptOffsetWidth(value)) {
  return value.slice(displayOffsetIndexReference(value, start), displayOffsetIndexReference(value, end))
}

describe("mentionTriggerIndex", () => {
  test("returns undefined when the input contains no @", () => {
    expect(mentionTriggerIndex("hello world")).toBeUndefined()
    expect(mentionTriggerIndex("")).toBeUndefined()
    expect(mentionTriggerIndex("just some plain text without triggers")).toBeUndefined()
  })

  test("detects an @ at the start of the trailing word", () => {
    expect(mentionTriggerIndex("mention this @file")).toBe(13)
    expect(mentionTriggerIndex("@file")).toBe(0)
    expect(mentionTriggerIndex("Hey @al")).toBe(4)
  })

  test("@ in the middle of a word is not a trigger", () => {
    expect(mentionTriggerIndex("foo@bar")).toBeUndefined()
    expect(mentionTriggerIndex("a@ b")).toBeUndefined()
  })

  test("@ followed by whitespace before the cursor is not a trigger", () => {
    expect(mentionTriggerIndex("@file rest")).toBeUndefined()
    expect(mentionTriggerIndex("Hey @al dir /tmp")).toBeUndefined()
  })

  test("honors the cursor offset", () => {
    // @ is active only when the cursor is inside the mention word.
    expect(mentionTriggerIndex("a @file b", 3)).toBe(2)
    // Cursor past the whitespace kills the trigger.
    const value = "a @file b"
    expect(mentionTriggerIndex(value, promptOffsetWidth(value))).toBeUndefined()
  })

  test("large inputs do not change behavior", () => {
    const big = ("The quick brown fox jumps over the lazy dog. ").repeat(2000)
    expect(mentionTriggerIndex(big)).toBeUndefined()
    expect(mentionTriggerIndex(big + "@mention")).toBe(big.length)
  })

  test("fast path (cursor at end of ASCII buffer) matches the reference", () => {
    const word = "lazy dog jumps over the quick brown fox "
    for (const where of [
      word.repeat(100).slice(0, -1), // ends in a word, no @
      word.repeat(100), // ends in whitespace, no @
      `@mention ${word.repeat(100)}`, // @ at the start, buffer ends in whitespace
      `${word.repeat(100)}@mention`, // active @ in the trailing word
      `${word.repeat(50)}x@y${word.repeat(50)}`, // mid-word @ not in the trailing word
      `${word.repeat(50)} @file \n${word.repeat(50)}`, // @ mid-buffer, trailing newline
    ]) {
      const offset = where.length
      expect(mentionTriggerIndex(where, offset)).toBe(referenceMentionTriggerIndex(where, offset))
    }
  })

  test("matches the reference implementation on random inputs", () => {
    const pieces = [
      "a",
      "b",
      "word",
      "@",
      "@file",
      "x@y",
      " ",
      "\n",
      "\t",
      "@a",
      "b@c",
      "你",
      "好",
      "😀",
      "@文件",
      "e@mail.co",
    ]
    let seed = 42
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) & 0xffffffff
      return seed / 0xffffffff
    }

    for (let trial = 0; trial < 500; trial++) {
      let value = ""
      const length = Math.floor(rand() * 40)
      for (let k = 0; k < length; k++) {
        value += pieces[Math.floor(rand() * pieces.length)]
      }
      // Pick a cursor anywhere in the text, including beyond it.
      const offset = Math.floor(rand() * (promptOffsetWidth(value) + 3))

      const expected = referenceMentionTriggerIndex(value, offset)
      const actual = mentionTriggerIndex(value, offset)
      try {
        expect(actual).toBe(expected)
      } catch {
        console.error(`mismatch value=${JSON.stringify(value)} offset=${offset} expected=${expected} actual=${actual}`)
        throw new Error("mentionTriggerIndex diverged from the reference implementation")
      }
    }
  })
})