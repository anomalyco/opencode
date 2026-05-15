import { describe, expect, test } from "bun:test"
import { composeQuotedMarkdown, insertTextIntoPrompt } from "./chat-selection-quote"
import type { ContentPart } from "@/context/prompt"

describe("composeQuotedMarkdown", () => {
  test("empty selection + empty comment → empty string", () => {
    expect(composeQuotedMarkdown("", "")).toBe("")
    expect(composeQuotedMarkdown("   ", "  ")).toBe("")
  })

  test("only comment → just trimmed comment", () => {
    expect(composeQuotedMarkdown("", "what does this mean?")).toBe("what does this mean?")
    expect(composeQuotedMarkdown("  ", "  hi  ")).toBe("hi")
  })

  test("only selection → quoted block prefixing each line", () => {
    expect(composeQuotedMarkdown("hello world", "")).toBe("> hello world")
    expect(composeQuotedMarkdown("line1\nline2", "")).toBe("> line1\n> line2")
  })

  test("selection + comment → quoted block, blank line, comment", () => {
    expect(composeQuotedMarkdown("line1\nline2", "explain")).toBe("> line1\n> line2\n\nexplain")
  })

  test("normalizes CRLF and CR line endings", () => {
    expect(composeQuotedMarkdown("a\r\nb\rc", "")).toBe("> a\n> b\n> c")
  })

  test("trims surrounding whitespace from selection", () => {
    expect(composeQuotedMarkdown("\n\n  hello  \n\n", "")).toBe("> hello")
  })
})

describe("insertTextIntoPrompt", () => {
  const textPart = (content: string): ContentPart => ({ type: "text", content, start: 0, end: 0 })
  const imagePart = (id: string): ContentPart => ({
    type: "image",
    id,
    filename: "x.png",
    mime: "image/png",
    dataUrl: "data:image/png;base64,xx",
  })

  test("empty text → returns prompt unchanged (copy)", () => {
    const p = [textPart("hello"), imagePart("a")]
    const result = insertTextIntoPrompt(p, "")
    expect(result).toEqual(p)
    expect(result).not.toBe(p as any) // 新数组
  })

  test("appends to last text part with content (blank line separator)", () => {
    const p = [textPart("hello")]
    const result = insertTextIntoPrompt(p, "> quoted")
    expect(result).toEqual([textPart("hello\n\n> quoted")])
  })

  test("replaces last text part content when empty", () => {
    const p = [textPart("")]
    const result = insertTextIntoPrompt(p, "> quoted")
    expect(result).toEqual([textPart("> quoted")])
  })

  test("inserts at LAST text part position (preserves image/file before it)", () => {
    const p = [textPart("intro"), imagePart("a"), textPart("middle"), imagePart("b"), textPart("tail")]
    const result = insertTextIntoPrompt(p, "Q?")
    // 末尾 text 是 "tail",追加到它
    expect(result[4]).toEqual(textPart("tail\n\nQ?"))
    expect(result[0]).toEqual(textPart("intro")) // 前面 text 不动
    expect(result[2]).toEqual(textPart("middle")) // 中间 text 不动
  })

  test("appends new text part when no text part exists", () => {
    const p = [imagePart("a"), imagePart("b")]
    const result = insertTextIntoPrompt(p, "> quoted")
    expect(result).toHaveLength(3)
    expect(result[2]).toEqual(textPart("> quoted"))
  })

  test("does not mutate input prompt", () => {
    const p = [textPart("hello")]
    insertTextIntoPrompt(p, "added")
    expect(p[0]).toEqual(textPart("hello"))
  })
})
